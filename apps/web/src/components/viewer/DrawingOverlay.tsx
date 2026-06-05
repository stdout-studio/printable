'use client';

import { Check, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRuntimeStore } from '@/lib/store/runtime';
import { useSessionStore } from '@/lib/store/session';

// Violet = human-authored marks (Flux is reserved for machine/measurement).
const STROKE_COLOR = '#9a8cff';
const STROKE_WIDTH = 4;

/**
 * Full-viewport canvas overlay shown when drawing mode is active.
 * Captures freehand strokes, composites them onto a snapshot of the GL
 * canvas on save, persists the result as a DrawingAnnotation tied to the
 * locked camera state, and inserts a `@d{n}` token into the chat composer
 * via a window-level event the Composer listens for.
 */
export function DrawingOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingActive = useRuntimeStore((s) => s.drawing.active);
  const cameraLock = useRuntimeStore((s) => s.drawing.cameraLock);
  const strokes = useRuntimeStore((s) => s.drawing.strokes);
  const addStroke = useRuntimeStore((s) => s.addStroke);
  const popStroke = useRuntimeStore((s) => s.popStroke);
  const clearStrokes = useRuntimeStore((s) => s.clearStrokes);
  const cancelDrawing = useRuntimeStore((s) => s.cancelDrawing);
  const captureGlSnapshot = useRuntimeStore((s) => s.captureGlSnapshot);
  const addAnnotation = useSessionStore((s) => s.addAnnotation);

  const [currentStroke, setCurrentStroke] = useState<Array<[number, number]>>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track container size so canvas matches the viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Repaint strokes whenever they change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      const first = stroke.points[0]!;
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < stroke.points.length; i++) {
        const pt = stroke.points[i]!;
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
    }
    // Draw the in-progress stroke
    if (currentStroke.length >= 2) {
      ctx.beginPath();
      const first = currentStroke[0]!;
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < currentStroke.length; i++) {
        const pt = currentStroke[i]!;
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
    }
  }, [strokes, currentStroke, size]);

  if (!drawingActive) return null;

  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setCurrentStroke([pos(e)]);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (currentStroke.length === 0) return;
    setCurrentStroke((s) => [...s, pos(e)]);
  }

  function onPointerUp() {
    if (currentStroke.length >= 2) {
      addStroke({ points: currentStroke, color: STROKE_COLOR, widthPx: STROKE_WIDTH });
    }
    setCurrentStroke([]);
  }

  function commitAnnotation() {
    if (!cameraLock) return;
    if (strokes.length === 0 && currentStroke.length < 2) {
      cancelDrawing();
      return;
    }

    // Composite: GL snapshot (background) + our overlay strokes
    const overlayCanvas = canvasRef.current;
    if (!overlayCanvas) return;

    const composite = document.createElement('canvas');
    composite.width = overlayCanvas.width;
    composite.height = overlayCanvas.height;
    const ctx = composite.getContext('2d');
    if (!ctx) return;

    const glDataUrl = captureGlSnapshot?.();
    const finish = (bgImg: HTMLImageElement | null) => {
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, composite.width, composite.height);
      if (bgImg) {
        // bgImg dimensions are the GL canvas pixel size; cover-fit into composite
        ctx.drawImage(bgImg, 0, 0, composite.width, composite.height);
      }
      ctx.drawImage(overlayCanvas, 0, 0);
      const dataUrl = composite.toDataURL('image/png');
      const ann = addAnnotation({
        cameraState: cameraLock,
        imagePngDataUrl: dataUrl,
        width: composite.width,
        height: composite.height,
      });
      // Tell Composer to insert the new drawing token
      window.dispatchEvent(
        new CustomEvent('printable:insert-drawing-token', { detail: { label: ann.label } }),
      );
      cancelDrawing();
    };

    if (glDataUrl) {
      const img = new Image();
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = glDataUrl;
    } else {
      finish(null);
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-auto"
      style={{ zIndex: 30 }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
      />
      <div className="absolute top-4 right-4 flex gap-2 bg-[var(--bg-glass)] backdrop-blur-md border border-[var(--line)] rounded-xl p-1.5 shadow-md">
        <button
          onClick={popStroke}
          disabled={strokes.length === 0}
          className="p-2 rounded-lg hover:bg-[var(--bg-elev)] disabled:opacity-30"
          title="Undo last stroke"
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={clearStrokes}
          disabled={strokes.length === 0}
          className="p-2 rounded-lg hover:bg-[var(--bg-elev)] disabled:opacity-30"
          title="Clear"
          aria-label="Clear"
        >
          <Trash2 size={16} />
        </button>
        <div className="w-px self-stretch bg-[var(--line)] mx-1" />
        <button
          onClick={cancelDrawing}
          className="p-2 rounded-lg hover:bg-[var(--bg-elev)] text-[var(--fg-muted)]"
          title="Cancel"
          aria-label="Cancel"
        >
          <X size={16} />
        </button>
        <button
          onClick={commitAnnotation}
          disabled={strokes.length === 0}
          className="px-3 py-2 rounded-lg bg-[var(--flux)] text-[#0b0c0e] font-medium hover:bg-[var(--flux-deep)] disabled:opacity-30 flex items-center gap-1.5 text-sm transition-colors"
        >
          <Check size={14} />
          Save sketch
        </button>
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-[var(--bg-glass)] backdrop-blur-md rounded-full text-xs text-[var(--fg-muted)] border border-[var(--line)] shadow-sm">
        Draw on the view to annotate. Saved as a sketch tied to this camera angle.
      </div>
    </div>
  );
}
