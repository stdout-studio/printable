'use client';

import * as THREE from 'three';
import { create } from 'zustand';
import type { CameraState } from '@printable/types';

export interface DrawStroke {
  points: Array<[number, number]>;
  color: string;
  widthPx: number;
}

interface DrawingSession {
  active: boolean;
  cameraLock: CameraState | null;
  strokes: DrawStroke[];
}

interface RuntimeState {
  meshGeometries: Map<string, THREE.BufferGeometry>;
  /** Base64 STL bytes per web mesh id. Cached at upload so we can re-import
   *  silently if the Blender session goes away (worker restart, crash, etc).
   *  NOT persisted across page reloads — fresh upload required on reload. */
  meshBytes: Map<string, string>;
  drawing: DrawingSession;

  /** Set inside the Canvas by a useThree-based sync component; called by HUD
   *  buttons that need the current camera state from outside the Canvas. */
  captureCameraState: (() => CameraState) | null;
  /** Set inside the Canvas by a useThree-based sync component; returns a
   *  PNG data URL of the current WebGL framebuffer. */
  captureGlSnapshot: (() => string) | null;

  /** Bumped by the HUD "Frame" button — the CameraFitter watches this and
   *  re-fits when it changes. */
  fitNonce: number;
  requestFit: () => void;

  setMeshGeometry: (meshId: string, geometry: THREE.BufferGeometry) => void;
  removeMeshGeometry: (meshId: string) => void;
  /** Drop ALL cached geometry + bytes — used when switching projects so the
   *  outgoing project's meshes don't bleed into the incoming one. */
  resetMeshes: () => void;
  getMeshGeometry: (meshId: string) => THREE.BufferGeometry | undefined;
  setMeshBytes: (meshId: string, base64: string) => void;
  getMeshBytes: (meshId: string) => string | undefined;
  setCaptureFns: (
    cam: (() => CameraState) | null,
    gl: (() => string) | null,
  ) => void;

  startDrawing: (cameraLock: CameraState) => void;
  addStroke: (stroke: DrawStroke) => void;
  popStroke: () => void;
  clearStrokes: () => void;
  cancelDrawing: () => void;
  finishDrawing: () => { cameraLock: CameraState; strokes: DrawStroke[] } | null;
}

/**
 * Runtime store — non-serializable state that should NOT persist to
 * localStorage (BufferGeometry, drawing-in-progress, camera locks).
 *
 * Persistent session metadata (meshes, points, messages) lives in
 * useSessionStore in ./session.ts. The mesh geometry cache here is keyed
 * by the same id as MeshHandle in that store.
 */
export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  meshGeometries: new Map(),
  meshBytes: new Map(),
  drawing: { active: false, cameraLock: null, strokes: [] },
  captureCameraState: null,
  captureGlSnapshot: null,
  fitNonce: 0,
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),

  setCaptureFns: (cam, gl) => set({ captureCameraState: cam, captureGlSnapshot: gl }),

  setMeshGeometry: (id, g) =>
    set((s) => {
      const next = new Map(s.meshGeometries);
      next.set(id, g);
      return { meshGeometries: next };
    }),
  removeMeshGeometry: (id) =>
    set((s) => {
      const next = new Map(s.meshGeometries);
      next.delete(id);
      return { meshGeometries: next };
    }),
  resetMeshes: () => set({ meshGeometries: new Map(), meshBytes: new Map() }),
  getMeshGeometry: (id) => get().meshGeometries.get(id),

  setMeshBytes: (id, b64) =>
    set((s) => {
      const next = new Map(s.meshBytes);
      next.set(id, b64);
      return { meshBytes: next };
    }),
  getMeshBytes: (id) => get().meshBytes.get(id),

  startDrawing: (cameraLock) =>
    set({ drawing: { active: true, cameraLock, strokes: [] } }),
  addStroke: (stroke) =>
    set((s) => ({ drawing: { ...s.drawing, strokes: [...s.drawing.strokes, stroke] } })),
  popStroke: () =>
    set((s) => ({ drawing: { ...s.drawing, strokes: s.drawing.strokes.slice(0, -1) } })),
  clearStrokes: () => set((s) => ({ drawing: { ...s.drawing, strokes: [] } })),
  cancelDrawing: () =>
    set({ drawing: { active: false, cameraLock: null, strokes: [] } }),
  finishDrawing: () => {
    const { cameraLock, strokes } = get().drawing;
    set({ drawing: { active: false, cameraLock: null, strokes: [] } });
    if (!cameraLock || strokes.length === 0) return null;
    return { cameraLock, strokes };
  },
}));
