// Local SigLIP text+image encoder via @huggingface/transformers (ONNX).
//
// We expose two operations:
//   - encodeText(strings[]) -> Float32 vectors
//   - encodeImage(buf)      -> Float32 vector
//
// Each vector is L2-normalized so cosine-similarity reduces to a dot
// product. The two encoders share an embedding space and the model
// fuses them by averaging then re-normalizing.
//
// The model + tokenizer + processor are lazy-loaded singletons. First
// load downloads ~200 MB of ONNX weights to ~/.cache/huggingface/hub/
// (managed by transformers.js — we don't override).

import {
  env,
  AutoTokenizer,
  AutoProcessor,
  SiglipTextModel,
  SiglipVisionModel,
  RawImage,
  type PreTrainedTokenizer,
  type Processor,
} from '@huggingface/transformers';

import { SIGLIP_MODEL_ID, SIGLIP_EMBEDDING_DIM } from './types.js';

// In Node, transformers.js sometimes guesses "we're in browser, don't
// hit the remote" — explicitly opt in to remote model downloads.
env.allowRemoteModels = true;
// Belt-and-braces: also allow local model cache use (the default).
env.allowLocalModels = true;

// ONNX Runtime in Node honors Apple's CoreML/Metal automatically when
// available. We don't have to set executionProviders explicitly for the
// quantized SigLIP — the default CPU path is fast enough for the
// indexing batch sizes we use (~100 images one-shot).

interface SiglipCtx {
  tokenizer: PreTrainedTokenizer;
  processor: Processor;
  textModel: Awaited<ReturnType<typeof SiglipTextModel.from_pretrained>>;
  visionModel: Awaited<ReturnType<typeof SiglipVisionModel.from_pretrained>>;
}

let ctxPromise: Promise<SiglipCtx> | null = null;

async function getCtx(): Promise<SiglipCtx> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      console.log(`siglip: loading ${SIGLIP_MODEL_ID} (first run downloads ~200 MB)`);
      const [tokenizer, processor, textModel, visionModel] = await Promise.all([
        AutoTokenizer.from_pretrained(SIGLIP_MODEL_ID),
        AutoProcessor.from_pretrained(SIGLIP_MODEL_ID),
        SiglipTextModel.from_pretrained(SIGLIP_MODEL_ID),
        SiglipVisionModel.from_pretrained(SIGLIP_MODEL_ID),
      ]);
      console.log('siglip: ready');
      return { tokenizer, processor, textModel, visionModel };
    })();
  }
  return ctxPromise;
}

/** Pre-warm the model. Useful from CLI entry points so the first
 * embed log line isn't 30s late. */
export async function loadSiglip(): Promise<void> {
  await getCtx();
}

function l2Normalize(v: Float32Array | number[]): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i]! * v[i]!;
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  const inv = 1 / norm;
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * inv;
  return out;
}

/**
 * Encode an array of text strings. Returns one normalized 768-dim
 * Float32Array per input string.
 */
export async function encodeText(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const ctx = await getCtx();

  // SigLIP expects fixed max-length padding for the text encoder.
  const inputs = await ctx.tokenizer(texts, {
    padding: 'max_length',
    truncation: true,
  });
  const out = await ctx.textModel(inputs);
  const tensor = out.pooler_output;
  // tensor.dims = [batch, 768]
  const dims = tensor.dims as number[];
  const data = tensor.data as Float32Array;
  const batch = dims[0]!;
  const dim = dims[1]!;
  if (dim !== SIGLIP_EMBEDDING_DIM) {
    throw new Error(
      `siglip text dim mismatch: expected ${SIGLIP_EMBEDDING_DIM}, got ${dim}`,
    );
  }
  const result: Float32Array[] = [];
  for (let i = 0; i < batch; i++) {
    const slice = data.subarray(i * dim, (i + 1) * dim);
    result.push(l2Normalize(slice));
  }
  return result;
}

/**
 * Encode a single image (decoded from a Buffer of any common format).
 * Returns one normalized 768-dim Float32Array.
 */
export async function encodeImage(buf: Buffer): Promise<Float32Array> {
  const ctx = await getCtx();
  // RawImage.fromBlob is the documented entry point in Node; we wrap
  // the Buffer in a Blob. Slice the underlying ArrayBuffer to detach
  // it from a possibly-shared backing store before passing to Blob,
  // because lib.dom expects an ArrayBuffer (not SharedArrayBuffer)
  // BlobPart.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const blob = new Blob([ab]);
  const image = await RawImage.fromBlob(blob);
  const inputs = await ctx.processor(image);
  const out = await ctx.visionModel(inputs);
  const tensor = out.pooler_output;
  const dims = tensor.dims as number[];
  const data = tensor.data as Float32Array;
  const dim = dims[1]!;
  if (dim !== SIGLIP_EMBEDDING_DIM) {
    throw new Error(
      `siglip image dim mismatch: expected ${SIGLIP_EMBEDDING_DIM}, got ${dim}`,
    );
  }
  // batch size 1
  return l2Normalize(data.subarray(0, dim));
}

/**
 * Fuse a text and image embedding into a single normalized vector by
 * averaging then re-normalizing. Either input may be omitted.
 */
export function fuseEmbeddings(
  text: Float32Array | null,
  image: Float32Array | null,
): Float32Array {
  if (!text && !image) {
    throw new Error('fuseEmbeddings: need at least one of text or image');
  }
  if (text && !image) return l2Normalize(text);
  if (image && !text) return l2Normalize(image);
  // both present — element-wise average then renormalize
  const a = text!;
  const b = image!;
  if (a.length !== b.length) {
    throw new Error(
      `fuseEmbeddings: dim mismatch ${a.length} vs ${b.length}`,
    );
  }
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i]! + b[i]!) * 0.5;
  return l2Normalize(out);
}

/**
 * Build the descriptive text string we feed the text encoder for a
 * model card. Matches the prompt shape the search side will use so
 * descriptive queries and indexed records live in the same region of
 * the embedding space.
 */
export function buildCaptionText(args: {
  title: string;
  llmCaption: string;
  tags: string[];
  bbox: { x: number; y: number; z: number };
}): string {
  const dims = `${args.bbox.x.toFixed(1)} x ${args.bbox.y.toFixed(1)} x ${args.bbox.z.toFixed(1)} mm`;
  const parts = [
    args.title.trim(),
    args.llmCaption.trim(),
    args.tags.length ? `Tags: ${args.tags.join(', ')}` : '',
    `Dimensions: ${dims}`,
  ].filter((p) => p.length > 0);
  return parts.join('. ') + '.';
}
