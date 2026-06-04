// Runtime search API. Imported by both the CLI and the Next.js
// /api/retrieval route. Holds a process-wide LanceDB connection +
// SigLIP context so back-to-back queries are cheap.

import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';

import { lanceDbDir, lanceTableName, modelDir } from '../paths.js';
import {
  encodeImage,
  encodeText,
  fuseEmbeddings,
} from '../siglip.js';
import {
  EMBEDDING_MODEL_NAME,
  type PrintableModel,
  type SearchQuery,
  type SearchResult,
} from '../types.js';

/**
 * Shape that LanceDB hands back. Arrow's List<Utf8> and List<Float>
 * columns are returned as Vector instances (iterable, length, get(i))
 * rather than plain JS arrays — we normalize them in toArray helpers.
 */
interface LanceVectorLike<T> {
  length: number;
  get(i: number): T;
  toArray?(): T[];
}

interface LanceRow {
  id: string;
  source: string;
  sourceUrl: string;
  license: string;
  author: string;
  title: string;
  description: string;
  tags: string[] | LanceVectorLike<string>;
  llmCaption: string;
  bboxX: number;
  bboxY: number;
  bboxZ: number;
  volume: number;
  triCount: number;
  isWatertight: boolean;
  lvisCategory: string[] | LanceVectorLike<string>;
  thumbnailFront: string;
  thumbnailSide: string;
  thumbnailTop: string;
  thumbnailIso: string;
  stlPath: string;
  vector: number[] | LanceVectorLike<number> | Float32Array;
  embeddingModel: string;
  embeddedAt: string;
  // appended by the search query
  _distance?: number;
}

function toStringArray(v: string[] | LanceVectorLike<string> | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v.toArray === 'function') return v.toArray();
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const value = v.get(i);
    if (typeof value === 'string') out.push(value);
  }
  return out;
}

function toNumberArray(
  v: number[] | LanceVectorLike<number> | Float32Array | undefined,
): number[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (v instanceof Float32Array) return Array.from(v);
  if (typeof (v as LanceVectorLike<number>).toArray === 'function') {
    return (v as LanceVectorLike<number>).toArray!();
  }
  const out: number[] = [];
  const lv = v as LanceVectorLike<number>;
  for (let i = 0; i < lv.length; i++) out.push(lv.get(i));
  return out;
}

let tablePromise: Promise<lancedb.Table> | null = null;

async function openTable(): Promise<lancedb.Table> {
  if (!tablePromise) {
    tablePromise = (async () => {
      const db = await lancedb.connect(lanceDbDir);
      const names = await db.tableNames();
      if (!names.includes(lanceTableName)) {
        throw new Error(
          `LanceDB table "${lanceTableName}" not found at ${lanceDbDir} — ` +
          `run \`pnpm --filter @printable/indexer build-index\` first`,
        );
      }
      return db.openTable(lanceTableName);
    })();
  }
  return tablePromise;
}

function rowToModel(row: LanceRow): PrintableModel {
  // The persisted row stores file paths relative to the model's data
  // dir; we keep them relative because the web app may run elsewhere
  // and translate to URLs separately.
  return {
    id: row.id,
    source: row.source as PrintableModel['source'],
    sourceUrl: row.sourceUrl,
    license: row.license as PrintableModel['license'],
    author: row.author,
    title: row.title,
    description: row.description,
    tags: toStringArray(row.tags),
    llmCaption: row.llmCaption,
    boundingBox: { x: row.bboxX, y: row.bboxY, z: row.bboxZ },
    volume: row.volume,
    triCount: row.triCount,
    isWatertight: row.isWatertight,
    lvisCategory: toStringArray(row.lvisCategory),
    thumbnails: {
      front: row.thumbnailFront,
      side: row.thumbnailSide,
      top: row.thumbnailTop,
      iso: row.thumbnailIso,
    },
    stlPath: row.stlPath,
    embedding: toNumberArray(row.vector),
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddedAt: row.embeddedAt,
  };
}

/**
 * Build the absolute filesystem path to a model's STL or thumbnail.
 * Exposed for the web app to translate manifest-relative paths into
 * served URLs (or just open the file directly from a Node API route).
 */
export function resolveModelFile(modelId: string, file: string): string {
  return path.join(modelDir(modelId), file);
}

/**
 * Encode a text + optional image into a single 768-dim fused vector
 * in the SigLIP space.
 */
export async function encodeQuery(query: SearchQuery): Promise<Float32Array> {
  if (!query.text && !query.image) {
    throw new Error('search: provide at least one of text or image');
  }
  let textVec: Float32Array | null = null;
  let imageVec: Float32Array | null = null;
  if (query.text && query.text.trim()) {
    const [first] = await encodeText([query.text]);
    textVec = first ?? null;
  }
  if (query.image) {
    imageVec = await encodeImage(query.image);
  }
  return fuseEmbeddings(textVec ?? null, imageVec ?? null);
}

/**
 * Top-K cosine search. Returns the matching PrintableModel rows with
 * their distance/score attached.
 */
export async function search(query: SearchQuery): Promise<SearchResult[]> {
  const topK = query.topK ?? 10;
  const queryVec = await encodeQuery(query);
  const table = await openTable();

  // vectorSearch (vs the polymorphic .search()) always returns a
  // VectorQuery so we can chain distanceType.
  const rows = (await table
    .vectorSearch(Array.from(queryVec))
    .distanceType('cosine')
    .limit(topK)
    .toArray()) as LanceRow[];

  return rows.map((row) => {
    const distance = row._distance ?? 0;
    return {
      ...rowToModel(row),
      distance,
      score: 1 - distance,
    };
  });
}

export type { SearchQuery, SearchResult } from '../types.js';
