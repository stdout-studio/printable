'use client';

import { Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MeshSource } from '@printable/types';
import { loadMeshFromFile } from '@/lib/mesh/loaders';
import { useRuntimeStore } from '@/lib/store/runtime';
import { useSessionStore } from '@/lib/store/session';
import { cn } from '@/lib/utils';

interface Props {
  source: MeshSource;
  role: 'context' | 'active';
  title: string;
  hint: string;
  onComplete: () => void;
}

export function MeshUploadStep({ source, role, title, hint, onComplete }: Props) {
  const addMesh = useSessionStore((s) => s.addMesh);
  const setContextMesh = useSessionStore((s) => s.setContextMesh);
  const setActiveMesh = useSessionStore((s) => s.setActiveMesh);
  const setMeshGeometry = useRuntimeStore((s) => s.setMeshGeometry);
  const setMeshBytes = useRuntimeStore((s) => s.setMeshBytes);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      const loaded = await loadMeshFromFile(file);
      const mesh = addMesh({
        label: file.name.replace(/\.[^.]+$/, ''),
        source,
        filename: file.name,
        triangleCount: loaded.triangleCount,
        boundingBox: loaded.boundingBox,
      });
      setMeshGeometry(mesh.id, loaded.geometry);
      // Cache the raw STL bytes so we can silently re-import if the Blender
      // session expires (the in-memory subprocess dies on worker restart).
      const stlBase64 = arrayBufferToBase64(bytes);
      setMeshBytes(mesh.id, stlBase64);

      if (role === 'context') setContextMesh(mesh.id);
      if (role === 'active') setActiveMesh(mesh.id);

      // Fire-and-forget: push to Blender so the agent has the geometry when
      // chat starts. If the engine is offline, MeshHandle just lacks
      // workerMeshId and the agent operates in mock mode.
      void pushToWorker(mesh.id, stlBase64, file.name);

      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function pushToWorker(webMeshId: string, stlBase64: string, filename: string) {
    const currentSession = useSessionStore.getState().workerSessionId;
    try {
      const res = await fetch('/api/blender/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workerSessionId: currentSession,
          stlBase64,
          filename,
          setActive: role === 'active',
        }),
      });
      if (!res.ok) return; // engine offline; graceful degrade
      const body = (await res.json()) as {
        workerSessionId: string;
        workerMeshId: string;
      };
      useSessionStore.getState().setWorkerSessionId(body.workerSessionId);
      useSessionStore.getState().setWorkerMeshId(webMeshId, body.workerMeshId);
    } catch {
      // Engine unreachable — fine, agent runs in mock mode.
    }
  }

  // Avoids the 1MB stack-limit-per-arg of String.fromCharCode(...arr)
  function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    return btoa(binary);
  }

  return (
    <div className="max-w-xl w-full">
      <h3 className="text-xl font-semibold tracking-tight mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-fg-dim)] mb-6">{hint}</p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        className={cn(
          'block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          className="hidden"
        />
        {loading ? (
          <Loader2 size={32} className="mx-auto mb-3 animate-spin text-[var(--color-accent)]" />
        ) : (
          <Upload size={32} className="mx-auto mb-3 text-[var(--color-fg-dim)]" />
        )}
        <p className="font-medium">{loading ? 'Parsing mesh…' : 'Drop a file or click to upload'}</p>
        <p className="text-xs text-[var(--color-fg-dim)] mt-1">.stl, .obj</p>
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
