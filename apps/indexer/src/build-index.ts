// Reads embedding sidecars + manifest and persists everything into a
// LanceDB table at apps/indexer/data/lance/printable_models.
//
// Schema is defined explicitly via apache-arrow so the FixedSizeList
// vector column matches SigLIP's 768-dim output. Without an explicit
// schema, LanceDB's first-row inference produces a variable-length list
// which the cosine search won't accept.

import fs from 'node:fs';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import {
  Schema,
  Field,
  Float32,
  FixedSizeList,
  Utf8,
  Bool,
  List,
  Float64,
} from 'apache-arrow';

import {
  ensureDataDirs,
  embeddingsDir,
  lanceDbDir,
  lanceTableName,
} from './paths.js';
import { loadManifest, type ManifestEntry } from './manifest.js';
import { EMBEDDING_MODEL_NAME, SIGLIP_EMBEDDING_DIM } from './types.js';
import type { PrintableModelRow } from './types.js';

function buildSchema(): Schema {
  // FixedSizeList<Float32, 768> — required for the vector column.
  // LanceDB looks for any FixedSizeList<Float...> column as the
  // searchable vector by default.
  const vectorField = new Field(
    'vector',
    new FixedSizeList(
      SIGLIP_EMBEDDING_DIM,
      new Field('item', new Float32(), /*nullable=*/ true),
    ),
    /*nullable=*/ false,
  );
  const utf8List = (name: string) =>
    new Field(name, new List(new Field('item', new Utf8(), true)), true);

  return new Schema([
    new Field('id', new Utf8(), false),
    new Field('source', new Utf8(), false),
    new Field('sourceUrl', new Utf8(), false),
    new Field('license', new Utf8(), false),
    new Field('author', new Utf8(), true),
    new Field('title', new Utf8(), false),
    new Field('description', new Utf8(), true),
    utf8List('tags'),
    new Field('llmCaption', new Utf8(), true),
    new Field('bboxX', new Float64(), false),
    new Field('bboxY', new Float64(), false),
    new Field('bboxZ', new Float64(), false),
    new Field('volume', new Float64(), false),
    new Field('triCount', new Float64(), false),
    new Field('isWatertight', new Bool(), false),
    utf8List('lvisCategory'),
    new Field('thumbnailFront', new Utf8(), true),
    new Field('thumbnailSide', new Utf8(), true),
    new Field('thumbnailTop', new Utf8(), true),
    new Field('thumbnailIso', new Utf8(), true),
    new Field('stlPath', new Utf8(), false),
    vectorField,
    new Field('embeddingModel', new Utf8(), false),
    new Field('embeddedAt', new Utf8(), false),
  ]);
}

function rowFromEntry(entry: ManifestEntry, vector: number[]): PrintableModelRow {
  if (!entry.geometry) {
    throw new Error(`entry ${entry.id} has no geometry — run embed first`);
  }
  return {
    id: entry.id,
    source: 'thingi10k',
    sourceUrl: entry.sourceUrl,
    license: entry.license,
    author: entry.author,
    title: entry.title,
    description: entry.description,
    tags: entry.tags,
    llmCaption: '',
    bboxX: entry.geometry.bboxX,
    bboxY: entry.geometry.bboxY,
    bboxZ: entry.geometry.bboxZ,
    volume: entry.geometry.volume,
    triCount: entry.geometry.triCount,
    isWatertight: entry.geometry.isWatertight,
    lvisCategory: entry.category ? [entry.category] : [],
    thumbnailFront: entry.thumbnails.front,
    thumbnailSide: entry.thumbnails.side,
    thumbnailTop: entry.thumbnails.top,
    thumbnailIso: entry.thumbnails.iso,
    stlPath: entry.stl,
    vector,
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddedAt: new Date().toISOString(),
  };
}

interface SidecarFile {
  id: string;
  vector: number[];
  embeddingModel: string;
  embeddedAt: string;
}

async function main(): Promise<void> {
  ensureDataDirs();
  const manifest = loadManifest();
  console.log(`indexer/build-index: ${manifest.entries.length} manifest entries`);

  const rows: PrintableModelRow[] = [];
  let missing = 0;
  for (const entry of manifest.entries) {
    const sidecarPath = path.join(embeddingsDir, `${entry.id}.json`);
    if (!fs.existsSync(sidecarPath)) {
      missing++;
      continue;
    }
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')) as SidecarFile;
    if (sidecar.vector.length !== SIGLIP_EMBEDDING_DIM) {
      console.warn(
        `  ! ${entry.id}: vector dim ${sidecar.vector.length} != ${SIGLIP_EMBEDDING_DIM}`,
      );
      missing++;
      continue;
    }
    rows.push(rowFromEntry(entry, sidecar.vector));
  }
  console.log(`  ${rows.length} rows ready (${missing} skipped)`);
  if (rows.length === 0) {
    throw new Error('no rows — run embed first');
  }

  // Open/create the LanceDB instance.
  fs.mkdirSync(lanceDbDir, { recursive: true });
  const db = await lancedb.connect(lanceDbDir);

  const schema = buildSchema();
  const tableNames = await db.tableNames();
  if (tableNames.includes(lanceTableName)) {
    await db.dropTable(lanceTableName);
  }
  // Cast through unknown because PrintableModelRow's typed shape is
  // narrower than Record<string, unknown> — LanceDB accepts arbitrary
  // records, but the TS overload requires an index signature.
  const table = await db.createTable(
    lanceTableName,
    rows as unknown as Record<string, unknown>[],
    { schema },
  );
  console.log(`  wrote table "${lanceTableName}" at ${lanceDbDir}`);
  const count = await table.countRows();
  console.log(`  row count: ${count}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
