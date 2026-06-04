import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dev-only helper: load a host file as base64 so a browser test (Chrome
// automation) can hand it off to the existing MeshUploadStep file input
// without needing the OS file picker. Only allowed for files inside the
// user's Desktop/Projects/ tree — refuse anything else.
const ALLOWED_ROOT = '/Users/johannesmichalke/Desktop/Projects';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return json(403, { message: 'dev route disabled in production' });
  }
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');
  if (!requested) return json(400, { message: 'path query param required' });
  const resolved = path.resolve(requested);
  if (!resolved.startsWith(ALLOWED_ROOT)) {
    return json(403, { message: `path must be under ${ALLOWED_ROOT}` });
  }
  try {
    const st = await stat(resolved);
    if (!st.isFile()) return json(400, { message: 'not a file' });
    const buf = await readFile(resolved);
    return json(200, {
      filename: path.basename(resolved),
      sizeBytes: buf.byteLength,
      base64: buf.toString('base64'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(404, { message });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
