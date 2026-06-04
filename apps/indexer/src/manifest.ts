// Manifest of downloaded models. Written by download-slice100k.ts and
// consumed by embed.ts / build-index.ts. Lets us re-run any stage
// without re-downloading.

import fs from 'node:fs';
import path from 'node:path';
import { manifestPath } from './paths.js';
import type { PrintableLicense } from './types.js';

export interface ManifestEntry {
  id: string;
  /** Thingiverse "Thing ID" — the upstream project ID. Multiple
   *  ManifestEntries may share this when a Thing has multiple STLs. */
  thingId: number;
  title: string;
  description: string;
  author: string;
  license: PrintableLicense;
  tags: string[];
  category: string | null;
  subCategory: string | null;
  sourceUrl: string;
  // file paths relative to apps/indexer/data/raw/<id>/
  stl: string;
  thumbnails: {
    front: string;
    side: string;
    top: string;
    iso: string;
  };
  // geometry, filled in by embed.ts when the STL is parsed
  geometry?: {
    bboxX: number;
    bboxY: number;
    bboxZ: number;
    volume: number;
    triCount: number;
    isWatertight: boolean;
  };
}

export interface Manifest {
  source: 'thingi10k';
  createdAt: string;
  entries: ManifestEntry[];
}

export function loadManifest(): Manifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `manifest not found at ${manifestPath} — run \`pnpm download\` first`,
    );
  }
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as Manifest;
}

export function saveManifest(manifest: Manifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
