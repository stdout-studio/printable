'use client';

import { create } from 'zustand';
import type {
  ChatMessage,
  DrawingAnnotation,
  IntakeMode,
  MeshHandle,
  PointToken,
  SessionState,
} from '@printable/types';
import { rid } from '@/lib/utils';

interface SessionActions {
  addPoint: (point: Omit<PointToken, 'id' | 'label' | 'createdAt'>) => PointToken;
  removePoint: (id: string) => void;
  removePointsByIds: (ids: string[]) => void;
  clearPoints: () => void;
  addAnnotation: (
    annotation: Omit<DrawingAnnotation, 'id' | 'label' | 'createdAt'>,
  ) => DrawingAnnotation;
  addMesh: (mesh: Omit<MeshHandle, 'id' | 'uploadedAt'>) => MeshHandle;
  setWorkerMeshId: (webMeshId: string, workerMeshId: string) => void;
  setWorkerSessionId: (id: string | null) => void;
  appendMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => ChatMessage;
  appendTextToMessage: (messageId: string, text: string) => void;
  setIntake: (mode: IntakeMode) => void;
  setContextMesh: (id: string | null) => void;
  setActiveMesh: (id: string | null) => void;
  reset: () => void;
}

type SessionStore = SessionState & SessionActions;

function initialState(): SessionState {
  return {
    id: rid('s'),
    createdAt: new Date().toISOString(),
    intake: null,
    meshes: [],
    points: [],
    annotations: [],
    messages: [],
    contextMeshId: null,
    activeMeshId: null,
    workerSessionId: null,
  };
}

/**
 * Session store. NOT persisted — `BufferGeometry` in the runtime store and
 * the Blender worker session ids on disk both die on page reload, and
 * keeping the metadata around while the runtime is gone leaves the app in a
 * broken state where "From scratch" thinks it's already done. Every reload
 * starts fresh; the user picks an intake mode again. (See `feedback_printable_
 * keep_working.md` for the "no half-loaded zombie state" preference.)
 */
export const useSessionStore = create<SessionStore>()((set, get) => ({
  ...initialState(),
  addPoint: (p) => {
    const id = rid('pt');
    const label = `p${get().points.length + 1}`;
    const point: PointToken = { ...p, id, label, createdAt: new Date().toISOString() };
    set((s) => ({ points: [...s.points, point] }));
    return point;
  },
  removePoint: (id) => set((s) => ({ points: s.points.filter((p) => p.id !== id) })),
  removePointsByIds: (ids) => {
    const idSet = new Set(ids);
    set((s) => ({ points: s.points.filter((p) => !idSet.has(p.id)) }));
  },
  clearPoints: () => set({ points: [] }),
  addAnnotation: (a) => {
    const id = rid('an');
    const label = `d${get().annotations.length + 1}`;
    const annotation: DrawingAnnotation = {
      ...a,
      id,
      label,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ annotations: [...s.annotations, annotation] }));
    return annotation;
  },
  addMesh: (m) => {
    const id = rid('mh');
    const mesh: MeshHandle = { ...m, id, uploadedAt: new Date().toISOString() };
    set((s) => ({ meshes: [...s.meshes, mesh] }));
    return mesh;
  },
  setWorkerMeshId: (webMeshId, workerMeshId) =>
    set((s) => ({
      meshes: s.meshes.map((m) => (m.id === webMeshId ? { ...m, workerMeshId } : m)),
    })),
  setWorkerSessionId: (id) => set({ workerSessionId: id }),
  appendMessage: (msg) => {
    const id = rid('msg');
    const message: ChatMessage = { ...msg, id, createdAt: new Date().toISOString() };
    set((s) => ({ messages: [...s.messages, message] }));
    return message;
  },
  appendTextToMessage: (messageId, text) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const content = [...m.content];
        const last = content[content.length - 1];
        if (last && last.type === 'text') {
          content[content.length - 1] = { type: 'text', text: last.text + text };
        } else {
          content.push({ type: 'text', text });
        }
        return { ...m, content };
      }),
    })),
  setIntake: (mode) =>
    set({ intake: { mode, completedAt: new Date().toISOString() } }),
  setContextMesh: (id) => set({ contextMeshId: id }),
  setActiveMesh: (id) => set({ activeMeshId: id }),
  reset: () => set(initialState()),
}));
