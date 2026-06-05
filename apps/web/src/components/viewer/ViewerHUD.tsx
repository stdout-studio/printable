'use client';

import { Download, Maximize2, MousePointerClick, Pencil } from 'lucide-react';
import { base64ToArrayBuffer } from '@/lib/mesh/loaders';
import { useRuntimeStore } from '@/lib/store/runtime';
import { useSessionStore } from '@/lib/store/session';

export function ViewerHUD() {
  const points = useSessionStore((s) => s.points);
  const meshes = useSessionStore((s) => s.meshes);
  const drawingActive = useRuntimeStore((s) => s.drawing.active);
  const captureCameraState = useRuntimeStore((s) => s.captureCameraState);
  const startDrawing = useRuntimeStore((s) => s.startDrawing);
  const requestFit = useRuntimeStore((s) => s.requestFit);

  function startDraw() {
    if (drawingActive) return;
    const cs = captureCameraState?.();
    if (!cs) return;
    startDrawing(cs);
  }

  // Download the active part's current STL. The cached bytes are kept in sync on
  // every agent edit, so this is the latest geometry — no worker round-trip.
  function exportStl() {
    const session = useSessionStore.getState();
    const id = session.activeMeshId ?? session.meshes[0]?.id;
    if (!id) return;
    const b64 = useRuntimeStore.getState().meshBytes.get(id);
    if (!b64) return;
    const mesh = session.meshes.find((m) => m.id === id);
    const safe =
      (mesh?.label ?? 'part').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'part';
    const blob = new Blob([base64ToArrayBuffer(b64)], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.stl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Top-left: instrument spec-strip — frost glass floating over the canvas */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-auto">
        <div className="rounded-lg bg-[var(--bg-glass)] backdrop-blur-md border border-[var(--line)] px-3 py-1.5 mono text-[10px] uppercase tracking-[0.12em] text-[var(--fg-muted)] flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-[1px] bg-[var(--flux)] shadow-[0_0_8px_var(--flux-glow)]" />
          KERF
          <span className="text-[var(--fg-dim)]">·</span>
          MM
          <span className="text-[var(--fg-dim)]">·</span>
          <span className="text-[var(--fg)]">{points.length}</span>&nbsp;PTS
        </div>
        {meshes.length === 0 && (
          <div className="rounded-lg bg-[var(--bg-glass)] backdrop-blur-md border border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-muted)] flex items-center gap-2 max-w-xs">
            <MousePointerClick size={14} className="text-[var(--flux)] flex-shrink-0" />
            <span>
              Double-click the model to drop a point — reference it in chat as{' '}
              <code className="mono text-[var(--flux)]">@p1</code>.
            </span>
          </div>
        )}
      </div>

      {/* Bottom-left actions */}
      {!drawingActive && (
        <div className="absolute bottom-4 left-4 pointer-events-auto flex gap-2">
          <button
            onClick={() => requestFit()}
            className="rounded-lg bg-[var(--bg-glass)] backdrop-blur-md border border-[var(--line)] px-3 py-2 text-sm text-[var(--fg)] hover:border-[var(--flux)] transition-colors flex items-center gap-2"
            title="Frame mesh"
          >
            <Maximize2 size={14} />
            Frame
          </button>
          <button
            onClick={startDraw}
            className="rounded-lg bg-[var(--bg-glass)] backdrop-blur-md border border-[var(--line)] px-3 py-2 text-sm text-[var(--fg)] hover:border-[var(--flux)] transition-colors flex items-center gap-2"
          >
            <Pencil size={14} />
            Draw on this view
          </button>
          {meshes.length > 0 && (
            <button
              onClick={exportStl}
              title="Download the current part as STL"
              className="rounded-lg bg-[var(--flux)] text-[#0b0c0e] font-medium px-3 py-2 text-sm hover:bg-[var(--flux-deep)] transition-colors flex items-center gap-2"
            >
              <Download size={14} />
              Export STL
            </button>
          )}
        </div>
      )}
    </div>
  );
}
