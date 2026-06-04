// Centralized filesystem paths for the indexer pipeline.
//
// Everything anchored to apps/indexer/data/ so the data dir is portable
// and trivially gitignored. The web app's /api/retrieval/route.ts also
// imports from this module so the two stay in sync.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/indexer/src/paths.ts -> apps/indexer
export const indexerRoot = path.resolve(__dirname, '..');

export const dataDir = path.join(indexerRoot, 'data');
export const rawDir = path.join(dataDir, 'raw');
export const embeddingsDir = path.join(dataDir, 'embeddings');
export const cacheDir = path.join(dataDir, 'cache');
// LanceDB convention: a "database" is a directory containing one
// subdirectory per "table" (each table is a Lance dataset). We use
// data/index.lance/ as the database root and "models" as the only
// table, which yields the actual on-disk layout
// data/index.lance/models.lance/. The research-corpus.md spec calls
// this directory "data/index.lance/".
export const lanceDbDir = path.join(dataDir, 'index.lance');
export const lanceTableName = 'models' as const;

export const manifestPath = path.join(dataDir, 'manifest.json');

export function modelDir(id: string): string {
  return path.join(rawDir, id);
}

export function ensureDataDirs(): void {
  for (const dir of [dataDir, rawDir, embeddingsDir, cacheDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
