// Produces one fused 768-dim SigLIP embedding per model and writes it
// to data/embeddings/<id>.json alongside its geometry summary. Stage 3
// (build-index) reads these JSON sidecars and persists them into LanceDB.
//
// Why a separate sidecar instead of writing straight to LanceDB?
// LanceDB schema enforcement is sticky once a table exists, so we
// decouple the slow embedding step from index construction. Re-running
// build-index against new embeddings is cheap; re-running embed against
// new STLs is what's slow (~1 s per model on M1).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ensureDataDirs, embeddingsDir, modelDir } from './paths.js';
import { loadManifest, saveManifest, type ManifestEntry } from './manifest.js';
import {
  buildCaptionText,
  encodeImage,
  encodeText,
  fuseEmbeddings,
  loadSiglip,
} from './siglip.js';
import { summarizeStl } from './stl.js';
import { SIGLIP_EMBEDDING_DIM, EMBEDDING_MODEL_NAME } from './types.js';

interface EmbeddingSidecar {
  id: string;
  vector: number[];
  embeddingModel: typeof EMBEDDING_MODEL_NAME;
  embeddedAt: string;
  // copied geometry so build-index doesn't have to re-parse STLs
  geometry: {
    bboxX: number;
    bboxY: number;
    bboxZ: number;
    volume: number;
    triCount: number;
    isWatertight: boolean;
  };
}

const FORCE = process.env['PRINTABLE_EMBED_FORCE'] === '1';

async function embedOne(entry: ManifestEntry): Promise<EmbeddingSidecar | null> {
  const dir = modelDir(entry.id);
  const stlPath = path.join(dir, entry.stl);
  if (!fs.existsSync(stlPath)) {
    console.warn(`  ! skip ${entry.id} — stl missing`);
    return null;
  }

  // 1. Geometry summary (also fills bbox we feed into the caption text)
  const geom = summarizeStl(stlPath);

  // 2. Text encoder input
  const captionText = buildCaptionText({
    title: entry.title,
    // we don't yet run an LLM caption; concatenate category as a stand-in
    llmCaption: entry.description ?? '',
    tags: entry.tags,
    bbox: geom.bbox,
  });
  const [textVec] = await encodeText([captionText]);
  if (!textVec) {
    console.warn(`  ! skip ${entry.id} — text encode failed`);
    return null;
  }

  // 3. Image encoder input (front view)
  let imageVec: Float32Array | null = null;
  const frontPath = path.join(dir, 'front.png');
  if (entry.thumbnails.front && fs.existsSync(frontPath)) {
    const png = await fsp.readFile(frontPath);
    try {
      imageVec = await encodeImage(png);
    } catch (err) {
      console.warn(
        `  ! image encode failed for ${entry.id}: ${(err as Error).message}`,
      );
    }
  }

  // 4. Fuse
  const fused = fuseEmbeddings(textVec, imageVec);
  if (fused.length !== SIGLIP_EMBEDDING_DIM) {
    throw new Error(`unexpected fused dim ${fused.length}`);
  }

  return {
    id: entry.id,
    vector: Array.from(fused),
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddedAt: new Date().toISOString(),
    geometry: {
      bboxX: geom.bbox.x,
      bboxY: geom.bbox.y,
      bboxZ: geom.bbox.z,
      volume: geom.volume,
      triCount: geom.triCount,
      isWatertight: geom.isWatertight,
    },
  };
}

async function main(): Promise<void> {
  ensureDataDirs();
  const manifest = loadManifest();
  console.log(`indexer/embed: ${manifest.entries.length} entries`);

  // Pre-warm SigLIP so the first embedding doesn't include 30s of
  // weight download in its timing.
  await loadSiglip();

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < manifest.entries.length; i++) {
    const entry = manifest.entries[i]!;
    const out = path.join(embeddingsDir, `${entry.id}.json`);
    if (!FORCE && fs.existsSync(out)) {
      // also make sure the manifest entry has geometry populated
      if (!entry.geometry) {
        const cached = JSON.parse(fs.readFileSync(out, 'utf-8')) as EmbeddingSidecar;
        entry.geometry = cached.geometry;
      }
      skipped++;
      continue;
    }
    try {
      const result = await embedOne(entry);
      if (!result) {
        failed++;
        continue;
      }
      await fsp.writeFile(out, JSON.stringify(result, null, 2));
      entry.geometry = result.geometry;
      updated++;
      if ((updated + skipped + failed) % 10 === 0 || i === manifest.entries.length - 1) {
        console.log(
          `  [${i + 1}/${manifest.entries.length}] ` +
          `updated=${updated} skipped=${skipped} failed=${failed}`,
        );
      }
    } catch (err) {
      failed++;
      console.warn(`  ! embed ${entry.id} failed: ${(err as Error).message}`);
    }
  }

  // Persist updated manifest (with geometry filled in).
  saveManifest(manifest);
  console.log(`done. updated=${updated} skipped=${skipped} failed=${failed}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
