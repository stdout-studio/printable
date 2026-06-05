'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { generateStarterCubeStl } from '@/lib/mesh/primitives';
import { seedMeshFromStl } from '@/lib/intake/seedMesh';
import { useSessionStore } from '@/lib/store/session';

interface Props {
  onComplete: () => void;
}

const DRAW_COLOR = '#1e293b';
const STROKE_WIDTH = 3;
const CANVAS_W = 1024;
const CANVAS_H = 768;

export function DrawingCanvasStep({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const addAnnotation = useSessionStore((s) => s.addAnnotation);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = DRAW_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return [x, y];
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasContent(true);
  }

  function end() {
    setIsDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
  }

  async function done() {
    const canvas = canvasRef.current;
    if (canvas && hasContent) {
      addAnnotation({
        cameraState: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 50 },
        imagePngDataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });
    }
    // Seed an editable starter body so the agent has something concrete to shape
    // toward the sketch. Generating arbitrary geometry from a 2D drawing isn't
    // reliable yet; starting from a block the agent carves/extrudes is — and the
    // sketch itself is now sent to the model as visual intent.
    setBusy(true);
    try {
      await seedMeshFromStl(generateStarterCubeStl(50), {
        label: hasContent ? 'Sketch base' : 'Starter block',
        source: 'generated',
        filename: 'sketch-base.stl',
        role: 'active',
      });
    } finally {
      setBusy(false);
      onComplete();
    }
  }

  return (
    <div className="max-w-3xl w-full">
      <h3 className="text-xl font-semibold tracking-tight mb-2">Sketch what you want</h3>
      <p className="text-sm text-[var(--color-fg-dim)] mb-4">
        Rough is fine — the agent uses this as a visual starting point alongside your description in
        chat.
      </p>

      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className="border border-[var(--color-border)] rounded-2xl w-full bg-white touch-none cursor-crosshair"
          style={{ aspectRatio: '4/3' }}
        />
        <button
          onClick={clear}
          disabled={!hasContent}
          className="absolute top-2 right-2 p-2 rounded-lg bg-white/90 border border-[var(--color-border)] disabled:opacity-30 hover:bg-white"
          title="Clear"
          aria-label="Clear canvas"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void done()}
          disabled={busy}
          className="flex-1 rounded-xl bg-[var(--flux)] text-[#0b0c0e] font-medium py-2.5 hover:bg-[var(--flux-deep)] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? 'Setting up…' : hasContent ? 'Continue with this sketch' : 'Skip and describe in chat'}
        </button>
      </div>
    </div>
  );
}
