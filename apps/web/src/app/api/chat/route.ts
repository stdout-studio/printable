import Anthropic from '@anthropic-ai/sdk';
import type { NextRequest } from 'next/server';
import type { AgentContextInput } from '@/lib/claude/context';
import { PrintableAgent } from '@/lib/claude/agent';
import { BlenderClient } from '@/lib/blender/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatRequestBody extends AgentContextInput {
  workerSessionId?: string | null;
  viewportSnapshot?: string | null;
  /** webMeshId -> base64 STL bytes, sent on every turn so we can silently
   *  re-import on a stale session. */
  meshStlBase64s?: Record<string, string>;
}

const WORKER_URL = process.env.BLENDER_WORKER_URL ?? 'http://localhost:8080';

/** Ping the worker session. Returns whether it's alive AND has our meshes
 *  registered. If anything is off we'll recover. */
async function sessionHasMesh(sessionId: string, workerMeshId: string): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/sessions/${sessionId}/inspect_object`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nameOrId: workerMeshId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createFreshSession(): Promise<string | null> {
  try {
    const res = await fetch(`${WORKER_URL}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sessionId: string };
    return body.sessionId;
  } catch {
    return null;
  }
}

async function importMeshIntoSession(
  sessionId: string,
  stlBase64: string,
  filename: string,
  setActive: boolean,
): Promise<string | null> {
  try {
    const res = await fetch(`${WORKER_URL}/sessions/${sessionId}/import_mesh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stlBase64, filename, setActive }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { meshId: string };
    return body.meshId;
  } catch {
    return null;
  }
}

/** Make sure the Blender session is alive and holds the user's meshes.
 *  If not, mint a fresh session and re-import. Returns the (possibly new)
 *  session id and the web→worker mesh id mapping. Null sessionId = engine
 *  unreachable; the agent will run with mocked responses. */
async function ensureSessionWithMeshes(
  body: ChatRequestBody,
): Promise<{
  sessionId: string | null;
  meshIdMap: Record<string, string>;
  recovered: boolean;
}> {
  const seedMap: Record<string, string> = {};
  for (const m of body.meshes) {
    if (m.workerMeshId) seedMap[m.id] = m.workerMeshId;
  }

  // Fast path: session is good if it has the active or first mesh registered.
  const probeMeshId = body.activeMeshId ?? body.meshes[0]?.id;
  const probeWorkerMeshId = probeMeshId ? seedMap[probeMeshId] : undefined;
  if (body.workerSessionId && probeWorkerMeshId) {
    if (await sessionHasMesh(body.workerSessionId, probeWorkerMeshId)) {
      return { sessionId: body.workerSessionId, meshIdMap: seedMap, recovered: false };
    }
  }

  // Recovery: create a new session and re-import every mesh we have bytes for.
  const bytesMap = body.meshStlBase64s ?? {};
  if (Object.keys(bytesMap).length === 0) {
    // No bytes to re-import; whatever id we have, we can't recover. Return
    // null so the agent runs in mock mode and tells the user to reload.
    return { sessionId: body.workerSessionId ?? null, meshIdMap: seedMap, recovered: false };
  }

  const newSessionId = await createFreshSession();
  if (!newSessionId) {
    return { sessionId: null, meshIdMap: seedMap, recovered: false };
  }

  const newMap: Record<string, string> = {};
  for (const m of body.meshes) {
    const stlBase64 = bytesMap[m.id];
    if (!stlBase64) continue;
    const workerId = await importMeshIntoSession(
      newSessionId,
      stlBase64,
      m.filename,
      m.id === body.activeMeshId,
    );
    if (workerId) newMap[m.id] = workerId;
  }
  return { sessionId: newSessionId, meshIdMap: newMap, recovered: true };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequestBody;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError(
      500,
      'ANTHROPIC_API_KEY is not set. Add it to apps/web/.env.local to enable the agent.',
    );
  }

  // Pre-flight: make sure the Blender session is alive and has our meshes.
  // If the session expired (worker restarted etc.) silently re-import from
  // the bytes the frontend cached at upload time, and tell the client to
  // pick up the new ids.
  const { sessionId, meshIdMap, recovered } = await ensureSessionWithMeshes(body);

  const anthropic = new Anthropic({ apiKey });
  const blender = new BlenderClient(WORKER_URL, sessionId, meshIdMap);
  const agent = new PrintableAgent(anthropic, blender);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (recovered && sessionId) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: 'session_recovered',
              workerSessionId: sessionId,
              workerMeshIds: meshIdMap,
            })}\n`,
          ),
        );
      }
      // Eagerly sync the current state of the active mesh from Blender to
      // the viewer at the START of each chat. Catches the case where a prior
      // mesh_updated event was dropped (e.g. webMeshId mismatch) or the
      // viewer is otherwise out of date. The viewer applies it idempotently.
      if (sessionId && body.activeMeshId && meshIdMap[body.activeMeshId]) {
        try {
          const exportRes = await fetch(
            `${WORKER_URL}/sessions/${sessionId}/export_stl`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ selection: [meshIdMap[body.activeMeshId]] }),
            },
          );
          if (exportRes.ok) {
            const exportJson = (await exportRes.json()) as { stlBase64?: string };
            if (exportJson.stlBase64) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    type: 'mesh_updated',
                    webMeshId: body.activeMeshId,
                    stlBase64: exportJson.stlBase64,
                  })}\n`,
                ),
              );
            }
          }
        } catch {
          // best-effort sync; if it fails the agent will still do its thing
        }
      }
      try {
        for await (const event of agent.run(body)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
