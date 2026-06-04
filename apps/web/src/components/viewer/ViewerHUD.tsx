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
      {/* Top-left status */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-auto">
        {meshes.length === 0 && (
          <div className="rounded-xl bg-white/85 backdrop-blur-sm border border-slate-200 px-3 py-2 text-xs text-slate-700 shadow-sm flex items-center gap-2 max-w-xs">
            <MousePointerClick size={14} className="text-indigo-600" />
            <span>
              Double-click the model to drop a point. Reference it in chat as{' '}
              <code className="font-mono">@p1</code>.
            </span>
          </div>
        )}
        {points.length > 0 && (
          <div className="rounded-xl bg-white/85 backdrop-blur-sm border border-slate-200 px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            {points.length} point{points.length === 1 ? '' : 's'} marked
          </div>
        )}
      </div>

      {/* Bottom-left action */}
      {!drawingActive && (
        <div className="absolute bottom-4 left-4 pointer-events-auto flex gap-2">
          <button
            onClick={() => requestFit()}
            className="rounded-xl bg-white/90 backdrop-blur-sm border border-slate-200 px-3 py-2 text-sm shadow-sm hover:bg-white flex items-center gap-2"
            title="Frame mesh"
          >
            <Maximize2 size={14} />
            Frame
          </button>
          <button
            onClick={startDraw}
            className="rounded-xl bg-white/90 backdrop-blur-sm border border-slate-200 px-3 py-2 text-sm shadow-sm hover:bg-white flex items-center gap-2"
          >
            <Pencil size={14} />
            Draw on this view
          </button>
        </div>
      )}
    </div>
  );
}
