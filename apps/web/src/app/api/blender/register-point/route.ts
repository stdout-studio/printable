import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  workerSessionId: string;
  point: {
    id: string;
    label: string;
    worldPosition: [number, number, number];
    surfaceNormal: [number, number, number];
    meshId: string; // worker mesh id
  };
}

/**
 * Proxy that registers a clicked point with the Blender worker, so the
 * worker can resolve later apply_operation calls that reference it by id.
 * The web-side id is reused as the worker-side id — no translation needed.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody;
  if (!body.workerSessionId || !body.point?.id) {
    return json(400, { message: 'workerSessionId and point.id required' });
  }

  const workerBase = process.env.BLENDER_WORKER_URL ?? 'http://localhost:8080';
  try {
    const res = await fetch(
      `${workerBase}/sessions/${body.workerSessionId}/register_point`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.point),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json(res.status, {
        message: `Worker register_point failed (HTTP ${res.status})`,
        detail: detail.slice(0, 500),
      });
    }
    return json(200, await res.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(503, { message: `Worker unreachable: ${message}` });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
