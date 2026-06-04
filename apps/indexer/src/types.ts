// Shared types for the Printable retrieval index.
//
// Mirrors the "Embedded record schema" in docs/research-corpus.md
// with two deviations:
//   - source now includes "thingi10k" (SLICE-100K's HF dataset is empty
//     as of 2026-05-28; Thingi10K is the working substitute — same
//     Thingiverse provenance, same licenses).
//   - embeddingModel is "siglip-base-patch16-256" (local ONNX via
//     transformers.js) instead of voyage-multimodal-3.5 (the user
//     explicitly forbade Voyage API).
//
// The vector is 768-dim (SigLIP base) instead of 1024-dim (Voyage).

export type PrintableLicense =
  | 'CC0'
  | 'CC-BY'
  | 'CC-BY-SA'
  | 'CC-BY-4.0'
  | 'CC-BY-NC'
  | 'CC-BY-NC-SA'
  | 'CC-BY-NC-ND'
  | 'CC-BY-ND'
  | 'GPL'
  | 'LGPL'
  | 'BSD'
  | 'Public Domain'
  | 'Other';

export type PrintableSource =
  | 'objaverse-thingiverse'
  | 'slice-100k'
  | 'thingi10k'
  | 'printables';

export interface PrintableBoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface PrintableThumbnails {
  front: string;
  side: string;
  top: string;
  iso: string;
}

export interface PrintableModel {
  id: string;
  source: PrintableSource;
  sourceUrl: string;
  license: PrintableLicense;
  author: string;

  // text signal
  title: string;
  description: string;
  tags: string[];
  llmCaption: string;

  // geometry signal
  boundingBox: PrintableBoundingBox;
  volume: number;
  triCount: number;
  isWatertight: boolean;
  lvisCategory: string[];

  // render signal — file paths relative to apps/indexer/data/raw/<id>/
  thumbnails: PrintableThumbnails;

  // local file path to the STL (relative to apps/indexer/data/raw/<id>/)
  stlPath: string;

  // the embedding
  embedding: number[];
  embeddingModel: 'siglip-base-patch16-256';
  embeddedAt: string;
}

/**
 * Row shape we actually persist in LanceDB. Same fields as PrintableModel
 * but with object fields flattened into scalar columns and arrays kept as
 * lists, because LanceDB Arrow schema doesn't accept nested structs well
 * without explicit schema setup. The thumbnails and bounding box are
 * stored as separate columns and reassembled in search().
 */
export interface PrintableModelRow {
  id: string;
  source: string;
  sourceUrl: string;
  license: string;
  author: string;

  title: string;
  description: string;
  tags: string[];
  llmCaption: string;

  bboxX: number;
  bboxY: number;
  bboxZ: number;
  volume: number;
  triCount: number;
  isWatertight: boolean;
  lvisCategory: string[];

  thumbnailFront: string;
  thumbnailSide: string;
  thumbnailTop: string;
  thumbnailIso: string;

  stlPath: string;

  vector: number[];
  embeddingModel: string;
  embeddedAt: string;
}

export interface SearchQuery {
  text?: string;
  image?: Buffer;
  topK?: number;
}

export interface SearchResult extends PrintableModel {
  /** cosine distance from the query — lower is more similar */
  distance: number;
  /** convenience: 1 - distance, higher is more similar */
  score: number;
}

export const SIGLIP_MODEL_ID = 'Xenova/siglip-base-patch16-256' as const;
export const SIGLIP_EMBEDDING_DIM = 768 as const;
export const EMBEDDING_MODEL_NAME = 'siglip-base-patch16-256' as const;
