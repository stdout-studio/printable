'use client';

import { Maximize2, MousePointerClick, Pencil } from 'lucide-react';
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
        </div>
      )}
    </div>
  );
}
