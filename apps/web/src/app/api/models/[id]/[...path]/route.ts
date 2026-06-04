import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves files (thumbnails + STLs) out of the indexer's on-disk data
 * directory: apps/indexer/data/raw/<id>/<path>.
 *
 * The /api/retrieval route returns URLs in the form
 *   /api/models/<id>/<filename>
 * and this handler resolves them against the indexer's modelDir().
 *
 * Path-traversal defense: we resolve the requested file against the
 * model's directory and reject if the result escapes it.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: pathParts } = await context.params;

  let indexer: typeof import('@printable/indexer');
  try {
    indexer = await import('@printable/indexer');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return text(503, `indexer not loaded: ${message}`);
  }

  if (!id || !pathParts || pathParts.length === 0) {
    return text(400, 'bad request');
  }

  const baseDir = indexer.modelDir(id);
  const requested = path.resolve(baseDir, ...pathParts);
  const baseResolved = path.resolve(baseDir);
  // Ensure the requested path stays inside the model's dir.
  if (requested !== baseResolved && !requested.startsWith(baseResolved + path.sep)) {
    return text(400, 'path traversal');
  }
  if (!fs.existsSync(requested)) {
    return text(404, 'not found');
  }
  const stat = fs.statSync(requested);
  if (!stat.isFile()) {
    return text(404, 'not a file');
  }

  const contentType = guessContentType(requested);

  // Stream the file (STLs can be tens of MB).
  const stream = fs.createReadStream(requested);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(stat.size),
      // Cache aggressively — the indexed content is content-addressed
      // by model id and never mutates in place.
      'cache-control': 'public, max-age=3600, immutable',
    },
  });
}

function guessContentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.stl': return 'model/stl';
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
