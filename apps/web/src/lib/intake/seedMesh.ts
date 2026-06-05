'use client';

import type { MeshSource } from '@printable/types';
import { loadMeshFromStlBytes } from '@/lib/mesh/loaders';
import { useRuntimeStore } from '@/lib/store/runtime';
import { useSessionStore } from '@/lib/store/session';

export interface SeedMeshOptions {
  label: string;
  source: MeshSource;
  filename: string;
  /** 'active' = the editable part; 'context' = the thing we design around. */
  role?: 'active' | 'context';
}

export interface SeedMeshResult {
  meshId: string;
  workerOnline: boolean;
  warning?: string;
}

/**
 * Load STL bytes into the viewer AND push them to the Blender worker, wiring up
 * every store the rest of the app expects: the geometry cache, the cached bytes
 * used for silent re-import on worker restart, the active/context selection, and
 * the worker session id + web→worker mesh-id map.
 *
 * Shared by every intake path so "From scratch", "Draw it", and "From a picture"
 * all leave the session in the same fully-wired, editable state instead of each
 * re-implementing the dance (and drifting). Worker-offline is non-fatal: the
 * viewer still shows the mesh and the agent degrades to honest mock messaging.
 */
export async function seedMeshFromStl(
  stlBytes: ArrayBuffer,
  opts: SeedMeshOptions,
): Promise<SeedMeshResult> {
  const session = useSessionStore.getState();
  const runtime = useRuntimeStore.getState();

  const loaded = loadMeshFromStlBytes(stlBytes);
  const mesh = session.addMesh({
    label: opts.label,
    source: opts.source,
    filename: opts.filename,
    triangleCount: loaded.triangleCount,
    boundingBox: loaded.boundingBox,
  });
  runtime.setMeshGeometry(mesh.id, loaded.geometry);

  const stlBase64 = arrayBufferToBase64(stlBytes);
  runtime.setMeshBytes(mesh.id, stlBase64);

  const role = opts.role ?? 'active';
  if (role === 'active') session.setActiveMesh(mesh.id);
  else session.setContextMesh(mesh.id);

  try {
    const res = await fetch('/api/blender/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerSessionId: useSessionStore.getState().workerSessionId,
        stlBase64,
        filename: opts.filename,
        setActive: role === 'active',
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { workerSessionId: string; workerMeshId: string };
      useSessionStore.getState().setWorkerSessionId(body.workerSessionId);
      useSessionStore.getState().setWorkerMeshId(mesh.id, body.workerMeshId);
      return { meshId: mesh.id, workerOnline: true };
    }
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      meshId: mesh.id,
      workerOnline: false,
      warning:
        body?.message ??
        `Couldn't reach the edit engine (${res.status}). The part is in the viewer, but edits won't apply until it's running.`,
    };
  } catch {
    return { meshId: mesh.id, workerOnline: false };
  }
}

// Chunked to avoid the ~1MB arg-count limit of String.fromCharCode(...arr).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}
