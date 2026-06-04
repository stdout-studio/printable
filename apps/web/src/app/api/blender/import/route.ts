import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  /** Existing worker session id, or null/undefined to create a new one. */
  workerSessionId: string | null;
  stlBase64: string;
  filename?: string;
  label?: string;
  setActive?: boolean;
}

/**
 * Bridge route: forwards an uploaded STL to the Blender worker.
 * Lazily creates a worker session if the client doesn't have one yet.
 * Returns the worker session id + the worker-side mesh id so the web app
 * can pin them onto MeshHandle.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody;
  if (!body.stlBase64) return json(400, { message: 'stlBase64 required' });

  const workerBase = process.env.BLENDER_WORKER_URL ?? 'http://localhost:8080';

  try {
    // 1. Ensure a worker session exists
    let workerSessionId = body.workerSessionId;
    if (!workerSessionId) {
      const sRes = await fetch(`${workerBase}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!sRes.ok) {
        return json(503, {
          message: `Worker session create failed (HTTP ${sRes.status}). Is the Blender worker running on ${workerBase}?`,
        });
      }
      const sBody = (await sRes.json()) as { sessionId: string };
      workerSessionId = sBody.sessionId;
    }

    // 2. Import the mesh
    const iRes = await fetch(`${workerBase}/sessions/${workerSessionId}/import_mesh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stlBase64: body.stlBase64,
        filename: body.filename,
        label: body.label,
        setActive: body.setActive ?? true,
      }),
    });
    if (!iRes.ok) {
      const detail = await iRes.text().catch(() => '');
      return json(iRes.status, {
        message: `Worker import_mesh failed (HTTP ${iRes.status})`,
        detail: detail.slice(0, 500),
      });
    }
    const iBody = (await iRes.json()) as {
      meshId: string;
      label: string;
      bbox: unknown;
      dimsMm: unknown;
      triCount: number;
      isWatertight: boolean;
    };

    return json(200, {
      workerSessionId,
      workerMeshId: iBody.meshId,
      triCount: iBody.triCount,
      isWatertight: iBody.isWatertight,
      bbox: iBody.bbox,
      dimsMm: iBody.dimsMm,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(503, {
      message: `Worker unreachable at ${workerBase}. Start it with \`pnpm worker\`.`,
      detail: message,
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
