'use client';

import type { ComponentType } from 'react';
import { useState } from 'react';
import type { IntakeMode } from '@printable/types';
import { ArrowLeft, Camera, FileBox, Loader2, Pencil, Scan, Sparkles } from 'lucide-react';
import { useSessionStore } from '@/lib/store/session';
import { useRuntimeStore } from '@/lib/store/runtime';
import { generateStarterCubeStl } from '@/lib/mesh/primitives';
import { loadMeshFromStlBytes } from '@/lib/mesh/loaders';
import { DrawingCanvasStep } from './DrawingCanvasStep';
import { MeshUploadStep } from './MeshUploadStep';
import { PictureUploadStep } from './PictureUploadStep';

interface Option {
  mode: IntakeMode;
  title: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
}

const options: Option[] = [
  {
    mode: 'attach_to_something',
    title: 'Attach to something I own',
    description: 'Upload a scan of the object first, then design a part that fits onto it.',
    icon: Scan,
  },
  {
    mode: 'edit_base_stl',
    title: 'Edit a base STL',
    description: 'Upload a 3D file and modify it.',
    icon: FileBox,
  },
  {
    mode: 'from_picture',
    title: 'From a picture',
    description: 'Show a photo or describe — we find a close match to start from.',
    icon: Camera,
  },
  {
    mode: 'from_drawing',
    title: 'Draw it',
    description: 'Sketch the rough shape.',
    icon: Pencil,
  },
  {
    mode: 'from_scratch',
    title: 'From scratch',
    description: 'Start from a 50 mm cube and edit from there.',
    icon: Sparkles,
  },
];

type Stage =
  | { kind: 'pick' }
  | { kind: 'attach_scan' }
  | { kind: 'edit_base' }
  | { kind: 'picture' }
  | { kind: 'drawing' };

export function IntakeWizard() {
  const setIntake = useSessionStore((s) => s.setIntake);
  const addMesh = useSessionStore((s) => s.addMesh);
  const setActiveMesh = useSessionStore((s) => s.setActiveMesh);
  const setWorkerSessionId = useSessionStore((s) => s.setWorkerSessionId);
  const setWorkerMeshId = useSessionStore((s) => s.setWorkerMeshId);
  const setMeshGeometry = useRuntimeStore((s) => s.setMeshGeometry);
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startFromScratch() {
    // Generate a starter cube STL, ship it to the worker, AND seed the
    // viewer with the same geometry. After this completes the user has
    // a real, editable mesh — operations on it will actually mutate
    // something the worker can export back.
    setBusy(true);
    setError(null);
    try {
      const stlBytes = generateStarterCubeStl(50);
      const loaded = loadMeshFromStlBytes(stlBytes);
      const mesh = addMesh({
        label: 'Starter cube',
        source: 'generated',
        filename: 'starter-cube.stl',
        triangleCount: loaded.triangleCount,
        boundingBox: loaded.boundingBox,
      });
      setMeshGeometry(mesh.id, loaded.geometry);
      setActiveMesh(mesh.id);

      // Push to worker
      const stlBase64 = arrayBufferToBase64(stlBytes);
      const res = await fetch('/api/blender/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workerSessionId: null,
          stlBase64,
          filename: 'starter-cube.stl',
          setActive: true,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { workerSessionId: string; workerMeshId: string };
        setWorkerSessionId(body.workerSessionId);
        setWorkerMeshId(mesh.id, body.workerMeshId);
      } else {
        // Worker offline is non-fatal — viewer still shows the cube,
        // agent will fall back to mock messaging.
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(
          body?.message ?? `Worker import failed (${res.status}). The cube is in the viewer but edits won't apply until the worker is up — run \`pnpm worker\`.`,
        );
      }
      setIntake('from_scratch');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function pickMode(mode: IntakeMode) {
    switch (mode) {
      case 'attach_to_something':
        setStage({ kind: 'attach_scan' });
        return;
      case 'edit_base_stl':
        setStage({ kind: 'edit_base' });
        return;
      case 'from_picture':
        setStage({ kind: 'picture' });
        return;
      case 'from_drawing':
        setStage({ kind: 'drawing' });
        return;
      case 'from_scratch':
        void startFromScratch();
        return;
    }
  }

  const backToPick = () => setStage({ kind: 'pick' });

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)]/85 backdrop-blur-sm flex items-center justify-center px-6 py-10 overflow-y-auto">
      {stage.kind === 'pick' && (
        <PickModeView onPick={pickMode} busy={busy} error={error} />
      )}

      {stage.kind === 'attach_scan' && (
        <FlowFrame onBack={backToPick}>
          <MeshUploadStep
            source="lidar_scan"
            role="context"
            title="Scan the object you want to attach to"
            hint="Upload a scan of the object (.stl or .obj — most iPhone LiDAR apps like 3D Scanner App and Polycam can export both). The agent will design a part that fits this geometry."
            onComplete={() => setIntake('attach_to_something')}
          />
        </FlowFrame>
      )}

      {stage.kind === 'edit_base' && (
        <FlowFrame onBack={backToPick}>
          <MeshUploadStep
            source="base_stl"
            role="active"
            title="Upload the STL you want to edit"
            hint="Drop your current 3D file. We'll load it as the active part."
            onComplete={() => setIntake('edit_base_stl')}
          />
        </FlowFrame>
      )}

      {stage.kind === 'picture' && (
        <FlowFrame onBack={backToPick}>
          <PictureUploadStep onComplete={() => setIntake('from_picture')} />
        </FlowFrame>
      )}

      {stage.kind === 'drawing' && (
        <FlowFrame onBack={backToPick}>
          <DrawingCanvasStep onComplete={() => setIntake('from_drawing')} />
        </FlowFrame>
      )}
    </div>
  );
}

function FlowFrame({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="w-full max-w-3xl flex flex-col items-stretch">
      <button
        onClick={onBack}
        className="self-start mb-4 flex items-center gap-1.5 text-sm text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <div className="flex justify-center">{children}</div>
    </div>
  );
}

function PickModeView({
  onPick,
  busy,
  error,
}: {
  onPick: (mode: IntakeMode) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="max-w-2xl w-full">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">What are you starting from?</h2>
        <p className="text-sm text-[var(--color-fg-dim)] mt-2">
          Pick a starting point — we&apos;ll guide you from there.
        </p>
      </div>
      <div className="grid gap-2">
        {options.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => onPick(opt.mode)}
            disabled={busy}
            className="text-left flex items-start gap-4 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="rounded-xl p-2.5 bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex-shrink-0">
              {busy && opt.mode === 'from_scratch' ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <opt.icon size={20} />
              )}
            </span>
            <span className="flex-1">
              <span className="block font-medium">{opt.title}</span>
              <span className="block text-sm text-[var(--color-fg-dim)] mt-0.5">
                {opt.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-amber-600">{error}</p>}
    </div>
  );
}

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
