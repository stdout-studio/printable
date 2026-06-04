// Downloads a small sample of Thingiverse-derived STLs + thumbnails from
// the Thingi10K dataset on HuggingFace.
//
// Why Thingi10K instead of SLICE-100K (the research doc's pick)?
// As of 2026-05-28 the SLICE-100K HF repo is empty (only README +
// .gitattributes) and the project README says "the dataset access link
// is broken — working on fixing it". Thingi10K is the same Thingiverse
// provenance with the same Creative Commons licenses, ships individual
// STL files (raw_meshes/<id>.stl), metadata CSVs (title/author/license/
// tags/category), AND pre-rendered PNG thumbnails (renderings/<id>.png).
// One thumbnail per model (not the 3-view ortho the research doc
// assumed) — we duplicate it across front/side/top/iso for now and
// will regenerate proper multi-view later when SLICE-100K comes back.
//
// Pipeline:
//   1. Download the 6 metadata CSVs (small — total ~6 MB)
//   2. Join them on Thing ID into in-memory rows
//   3. Filter for permissive licenses + valid title/category
//   4. Pick the first SAMPLE_SIZE rows (deterministic; sorted by ID)
//   5. Stream the renderings tar from HF — extract only the PNGs for
//      our chosen IDs (don't keep the 816 MB tar on disk)
//   6. Download each STL by direct HF URL (parallel, modest concurrency)
//   7. Write meta.json + manifest.json

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract as tarExtract } from 'tar-stream';
import { parse as parseCsv } from 'csv-parse/sync';

import {
  cacheDir,
  ensureDataDirs,
  modelDir,
} from './paths.js';
import { saveManifest, type Manifest, type ManifestEntry } from './manifest.js';
import type { PrintableLicense } from './types.js';

const HF_DATASET_BASE =
  'https://huggingface.co/datasets/Thingi10K/Thingi10K/resolve/main';

const META_FILES = {
  contextual: 'metadata/contextual_data.csv',
  tags: 'metadata/tag_data.csv',
  input_summary: 'metadata/input_summary.csv',
} as const;

const RENDERINGS_TAR = 'Thingi10K_renderings.tar.gz';

// How many models to ingest. Override with PRINTABLE_SAMPLE_SIZE env var.
// The research doc calls for 500-1000 for v0; we default to 100 so a
// fresh install completes in a few minutes (the bottleneck is STL
// download, ~1-5 MB each, and the renderings tar stream).
const SAMPLE_SIZE = Number(process.env['PRINTABLE_SAMPLE_SIZE'] ?? 100);

// Parallel STL downloads. HF allows ~50 req/s unauthenticated but we
// keep it modest to be polite and not hammer the user's network.
const STL_DOWNLOAD_CONCURRENCY = 6;

// -----------------------------------------------------------------------------
// HTTP helpers
// -----------------------------------------------------------------------------

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`GET ${url} -> empty body`);
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  // Stream the body straight to disk — STLs can be tens of MB.
  // The fetch response body is a Web ReadableStream; convert to Node.
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, fs.createWriteStream(dest));
}

async function downloadCachedCsv(name: string, url: string): Promise<string> {
  const cached = path.join(cacheDir, name);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
    return fs.readFileSync(cached, 'utf-8');
  }
  console.log(`  fetch ${name}`);
  const buf = await downloadToBuffer(url);
  await fsp.mkdir(path.dirname(cached), { recursive: true });
  await fsp.writeFile(cached, buf);
  return buf.toString('utf-8');
}

// -----------------------------------------------------------------------------
// License normalization
// -----------------------------------------------------------------------------

// The CSV uses verbose names like "Creative Commons - Attribution - Share Alike".
// We map them to the short canonical names in PrintableLicense.
const LICENSE_MAP: Record<string, PrintableLicense> = {
  'Creative Commons': 'CC-BY',
  'Creative Commons - Attribution': 'CC-BY',
  'Creative Commons - Attribution - Share Alike': 'CC-BY-SA',
  'Creative Commons - Attribution - Non-Commercial': 'CC-BY-NC',
  'Creative Commons - Attribution - Non-Commercial - Share Alike': 'CC-BY-NC-SA',
  'Creative Commons - Attribution - Non Commercial - Share Alike': 'CC-BY-NC-SA',
  'Creative Commons - Attribution - No Derivatives': 'CC-BY-ND',
  'Creative Commons - Attribution - Non-Commercial - No Derivatives': 'CC-BY-NC-ND',
  'Creative Commons - Attribution - Non Commercial - No Derivatives': 'CC-BY-NC-ND',
  'Creative Commons - Public Domain Dedication': 'CC0',
  'Public Domain': 'Public Domain',
  'GNU - GPL': 'GPL',
  'GNU - LGPL': 'LGPL',
  'BSD': 'BSD',
  'BSD License': 'BSD',
};

// Licenses we want for retrieval. We exclude NC/ND because they restrict
// redistribution of derivatives. The research doc explicitly calls for
// CC0/CC-BY/CC-BY-SA only.
const ACCEPTED_LICENSES: ReadonlySet<PrintableLicense> = new Set([
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-4.0',
  'Public Domain',
]);

function normalizeLicense(raw: string): PrintableLicense {
  const trimmed = raw.trim();
  const mapped = LICENSE_MAP[trimmed];
  if (mapped) return mapped;
  // Fuzzy fallback
  if (/share[\s-]?alike/i.test(trimmed) && !/non[\s-]?commercial/i.test(trimmed)) {
    return 'CC-BY-SA';
  }
  if (/attribution/i.test(trimmed) && !/non[\s-]?commercial/i.test(trimmed)) {
    return 'CC-BY';
  }
  if (/public[\s-]?domain/i.test(trimmed)) return 'Public Domain';
  return 'Other';
}

// -----------------------------------------------------------------------------
// Metadata join
// -----------------------------------------------------------------------------

interface ContextualRow {
  thingId: number;
  date: string;
  category: string | null;
  subCategory: string | null;
  name: string;
  author: string;
  license: PrintableLicense;
}

interface CandidateRow extends ContextualRow {
  /** Thingi10K file ID (unique per STL file, key for raw_meshes/<id>.stl
   *  and renderings/<id>.png). Multiple file IDs can share a Thing ID. */
  fileId: number;
  /** S3 path the STL was originally fetched from (informational). */
  link: string;
  tags: string[];
}

function emptyToNull(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === 'None') return null;
  return t;
}

async function loadCandidates(): Promise<CandidateRow[]> {
  console.log('downloading metadata CSVs...');
  const [contextualCsv, tagCsv, inputSummaryCsv] = await Promise.all([
    downloadCachedCsv('contextual_data.csv', `${HF_DATASET_BASE}/${META_FILES.contextual}`),
    downloadCachedCsv('tag_data.csv', `${HF_DATASET_BASE}/${META_FILES.tags}`),
    downloadCachedCsv('input_summary.csv', `${HF_DATASET_BASE}/${META_FILES.input_summary}`),
  ]);

  // contextual_data.csv: Thing ID, Date, Category, Sub-category, Name, Author, License
  // (one row per Thing, ~10000 rows)
  const contextualRecords = parseCsv(contextualCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // tag_data.csv: Thing ID, Tag (many tags per Thing)
  const tagRecords = parseCsv(tagCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // input_summary.csv: ID, Thing ID, License, Link, ... (one row per
  // STL file; multiple STL files can belong to one Thing). The "ID"
  // column is the Thingi10K file ID — that's what raw_meshes/<id>.stl
  // and renderings/<id>.png are keyed by.
  const inputSummaryRecords = parseCsv(inputSummaryCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  // Group tags by Thing ID.
  const tagsByThing = new Map<number, string[]>();
  for (const row of tagRecords) {
    const thingIdRaw = row['Thing ID'] ?? row['thing_id'];
    const tag = row['Tag'] ?? row['tag'];
    if (!thingIdRaw || !tag) continue;
    const thingId = Number(thingIdRaw);
    if (!Number.isFinite(thingId)) continue;
    const arr = tagsByThing.get(thingId);
    if (arr) arr.push(tag);
    else tagsByThing.set(thingId, [tag]);
  }

  // Index contextual rows by Thing ID for the join.
  const contextByThing = new Map<number, ContextualRow>();
  for (const row of contextualRecords) {
    const thingIdRaw = row['Thing ID'];
    const thingId = Number(thingIdRaw);
    if (!Number.isFinite(thingId)) continue;
    const name = (row['Name'] ?? '').trim();
    const author = (row['Author'] ?? '').trim();
    const license = normalizeLicense(row['License'] ?? '');
    if (!name) continue;
    contextByThing.set(thingId, {
      thingId,
      date: (row['Date'] ?? '').trim(),
      category: emptyToNull(row['Category']),
      subCategory: emptyToNull(row['Sub-category']),
      name,
      author,
      license,
    });
  }

  // Join: walk input_summary, look up contextual data + tags by Thing
  // ID, filter for accepted license, keep file IDs that pass.
  const candidates: CandidateRow[] = [];
  for (const row of inputSummaryRecords) {
    const fileId = Number(row['ID']);
    const thingId = Number(row['Thing ID']);
    if (!Number.isFinite(fileId) || !Number.isFinite(thingId)) continue;
    const ctx = contextByThing.get(thingId);
    if (!ctx) continue;
    if (!ACCEPTED_LICENSES.has(ctx.license)) continue;
    candidates.push({
      ...ctx,
      fileId,
      link: (row['Link'] ?? '').trim(),
      tags: tagsByThing.get(thingId) ?? [],
    });
  }

  // Sort by fileId for deterministic sampling.
  candidates.sort((a, b) => a.fileId - b.fileId);
  return candidates;
}

// -----------------------------------------------------------------------------
// Renderings tar streaming
// -----------------------------------------------------------------------------

/**
 * Stream the renderings tar from HF and extract PNGs for the requested
 * file IDs straight to disk. Files inside the tar are
 * `renderings/<file_id>.png` (where file_id is the Thingi10K key,
 * matching raw_meshes/<file_id>.stl). We stop early once we've
 * extracted every requested ID.
 *
 * Note: despite the .tar.gz extension the file is actually an
 * uncompressed POSIX tar (verified by `file(1)` against a Range-fetched
 * prefix). We pass it through tar-stream directly without gunzip.
 */
async function extractThumbnails(
  wantedIds: ReadonlyArray<number>,
  targetByFileId: ReadonlyMap<number, string>,
): Promise<Map<number, string>> {
  const wanted = new Set(wantedIds);
  const found = new Map<number, string>();

  // Cache the tar on disk so subsequent runs don't re-download.
  const cachedTar = path.join(cacheDir, RENDERINGS_TAR);
  if (!fs.existsSync(cachedTar) || fs.statSync(cachedTar).size < 1024 * 1024) {
    console.log('  fetching renderings tar (~816 MB, one-time, cached)...');
    await downloadToFile(`${HF_DATASET_BASE}/${RENDERINGS_TAR}`, cachedTar);
  }

  console.log(`  extracting ${wanted.size} thumbnail(s) from tar...`);
  let earlyExit = false;
  await new Promise<void>((resolve, reject) => {
    const extract = tarExtract();
    extract.on('entry', (header, stream, next) => {
      if (earlyExit) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      // header.name looks like "renderings/32770.png".
      const match = /^renderings\/(\d+)\.png$/.exec(header.name);
      if (!match) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      const fileId = Number(match[1]);
      if (!wanted.has(fileId)) {
        stream.resume();
        stream.on('end', next);
        return;
      }
      const dest = targetByFileId.get(fileId);
      if (!dest) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', async () => {
        try {
          const buf = Buffer.concat(chunks);
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          // Write the same PNG to front/side/top/iso for now —
          // Thingi10K ships one render per model.
          const dir = path.dirname(dest);
          for (const view of ['front.png', 'side.png', 'top.png', 'iso.png']) {
            await fsp.writeFile(path.join(dir, view), buf);
          }
          found.set(fileId, dest);
          if (found.size === wanted.size) {
            earlyExit = true;
            // Destroying the source stream propagates EOF to tar-stream
            // and triggers 'finish'.
            extract.destroy();
            resolve();
            return;
          }
          next();
        } catch (err) {
          next(err as Error);
        }
      });
      stream.on('error', next);
    });
    extract.on('finish', () => resolve());
    extract.on('error', (err: Error) => {
      // tar-stream emits a destroy-related error when we early-exit;
      // suppress in that case since we've already resolved.
      if (earlyExit) return;
      reject(err);
    });

    const src = fs.createReadStream(cachedTar);
    src.on('error', (err) => {
      if (earlyExit) return;
      reject(err);
    });
    src.pipe(extract);
  });

  return found;
}

// -----------------------------------------------------------------------------
// STL download
// -----------------------------------------------------------------------------

async function downloadStlIfMissing(fileId: number, dest: string): Promise<boolean> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
  const url = `${HF_DATASET_BASE}/raw_meshes/${fileId}.stl`;
  try {
    await downloadToFile(url, dest);
    return true;
  } catch (err) {
    console.warn(`  ! stl ${fileId} failed: ${(err as Error).message}`);
    if (fs.existsSync(dest)) {
      try {
        await fsp.unlink(dest);
      } catch {
        // ignore
      }
    }
    return false;
  }
}

async function downloadStlsBatched(
  fileIds: ReadonlyArray<number>,
  destByFileId: ReadonlyMap<number, string>,
): Promise<Set<number>> {
  const ok = new Set<number>();
  let cursor = 0;
  let completed = 0;
  const workers: Promise<void>[] = [];
  const total = fileIds.length;
  for (let w = 0; w < STL_DOWNLOAD_CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= fileIds.length) return;
          const fileId = fileIds[idx]!;
          const dest = destByFileId.get(fileId)!;
          const success = await downloadStlIfMissing(fileId, dest);
          completed++;
          if (success) ok.add(fileId);
          if (completed % 10 === 0 || completed === total) {
            console.log(`  stl ${completed}/${total} (${ok.size} ok)`);
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  return ok;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  ensureDataDirs();
  console.log(`indexer/download: target sample size = ${SAMPLE_SIZE}`);

  const candidates = await loadCandidates();
  console.log(`  ${candidates.length} permissively-licensed candidate file rows`);

  // Pick the first SAMPLE_SIZE candidates. Oversample 2x so we can
  // tolerate some STL download failures.
  const oversample = Math.min(candidates.length, SAMPLE_SIZE * 2);
  const picks = candidates.slice(0, oversample);
  console.log(`  attempting ${picks.length} STL downloads (2x oversample)`);

  // Map fileId -> filesystem dest. The "id" we use in the manifest is
  // derived from the Thingi10K file ID (which is globally unique across
  // the dataset, even when multiple files share a Thing ID).
  const destStlByFileId = new Map<number, string>();
  for (const p of picks) {
    const id = `thingi10k-${p.fileId}`;
    const dir = modelDir(id);
    destStlByFileId.set(p.fileId, path.join(dir, 'model.stl'));
  }

  // 1. Download STLs (parallel)
  console.log('downloading STLs...');
  const stlOk = await downloadStlsBatched(
    picks.map((p) => p.fileId),
    destStlByFileId,
  );

  // Cap to SAMPLE_SIZE successful ones, preserving order.
  const successful = picks.filter((p) => stlOk.has(p.fileId)).slice(0, SAMPLE_SIZE);
  console.log(`  ${successful.length} STLs downloaded successfully`);

  if (successful.length === 0) {
    throw new Error('no STLs downloaded — aborting');
  }

  // 2. Extract thumbnails from the renderings tar
  console.log('extracting thumbnails...');
  const thumbDestByFileId = new Map<number, string>();
  for (const p of successful) {
    const id = `thingi10k-${p.fileId}`;
    thumbDestByFileId.set(p.fileId, path.join(modelDir(id), 'front.png'));
  }
  const thumbsFound = await extractThumbnails(
    successful.map((p) => p.fileId),
    thumbDestByFileId,
  );
  console.log(`  ${thumbsFound.size}/${successful.length} thumbnails extracted`);

  // 3. Build manifest entries
  const entries: ManifestEntry[] = [];
  for (const p of successful) {
    const id = `thingi10k-${p.fileId}`;
    const dir = modelDir(id);
    const stlOnDisk = path.join(dir, 'model.stl');
    if (!fs.existsSync(stlOnDisk)) continue;
    const haveThumb = thumbsFound.has(p.fileId);
    const description = [p.category, p.subCategory].filter(Boolean).join(' / ');
    const entry: ManifestEntry = {
      id,
      thingId: p.thingId,
      title: p.name,
      description,
      author: p.author,
      license: p.license,
      tags: p.tags,
      category: p.category,
      subCategory: p.subCategory,
      sourceUrl: `https://www.thingiverse.com/thing:${p.thingId}`,
      stl: 'model.stl',
      thumbnails: {
        front: haveThumb ? 'front.png' : '',
        side: haveThumb ? 'side.png' : '',
        top: haveThumb ? 'top.png' : '',
        iso: haveThumb ? 'iso.png' : '',
      },
    };

    await fsp.writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify(entry, null, 2),
    );
    entries.push(entry);
  }

  // 4. Save the master manifest
  const manifest: Manifest = {
    source: 'thingi10k',
    createdAt: new Date().toISOString(),
    entries,
  };
  saveManifest(manifest);
  console.log(`done. manifest has ${entries.length} entries.`);
  console.log(`  thumbnails available for ${entries.filter((e) => e.thumbnails.front).length} models`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
