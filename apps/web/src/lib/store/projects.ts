'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SessionState } from '@printable/types';
import { base64ToArrayBuffer, loadMeshFromStlBytes } from '@/lib/mesh/loaders';
import { rid } from '@/lib/utils';
import { idbStorage } from './idbStorage';
import { useRuntimeStore } from './runtime';
import { useSessionStore } from './session';

/**
 * Multi-project (Lovable-style) — one persistent chat that re-contexts per
 * project. The live working state stays in useSessionStore / useRuntimeStore;
 * this store holds a snapshot per project and orchestrates the swap. Geometry
 * is never stored here (it can't serialize); it's re-derived from the project's
 * cached STL bytes on switch / load.
 *
 * Persisted to IndexedDB (via `persist`) so projects survive reloads — IDB, not
 * localStorage, because the snapshots carry base64 mesh bytes. On mount the app
 * waits for hydration, then `loadCurrent()` rehydrates the live session.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectSnapshot {
  meta: ProjectMeta;
  session: SessionState;
  meshBytes: Record<string, string>;
}

interface ProjectsState {
  projects: Record<string, ProjectSnapshot>;
  order: string[];
  currentProjectId: string | null;
}

interface ProjectsActions {
  init: () => void;
  saveCurrent: () => void;
  /** Rehydrate the live session + geometry from the current project snapshot
   *  (used after persist hydration on mount). */
  loadCurrent: () => void;
  createProject: (name?: string) => string;
  switchProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
}

type ProjectsStore = ProjectsState & ProjectsActions;

function snapshotSession(): SessionState {
  const s = useSessionStore.getState();
  return {
    id: s.id,
    createdAt: s.createdAt,
    intake: s.intake,
    meshes: s.meshes,
    points: s.points,
    annotations: s.annotations,
    messages: s.messages,
    contextMeshId: s.contextMeshId,
    activeMeshId: s.activeMeshId,
    workerSessionId: s.workerSessionId,
  };
}

function gatherMeshBytes(meshes: SessionState['meshes']): Record<string, string> {
  const rt = useRuntimeStore.getState();
  const out: Record<string, string> = {};
  for (const m of meshes) {
    const b = rt.meshBytes.get(m.id);
    if (b) out[m.id] = b;
  }
  return out;
}

/** Replace the live session + runtime geometry with a project snapshot. */
function hydrateLiveFrom(snap: ProjectSnapshot): void {
  useRuntimeStore.getState().resetMeshes();
  useSessionStore.getState().hydrate(snap.session);
  const rt = useRuntimeStore.getState();
  for (const m of snap.session.meshes) {
    const b = snap.meshBytes[m.id];
    if (!b) continue;
    rt.setMeshBytes(m.id, b);
    try {
      rt.setMeshGeometry(m.id, loadMeshFromStlBytes(base64ToArrayBuffer(b)).geometry);
    } catch {
      // corrupt bytes — UploadedMeshes shows a re-upload hint for this mesh
    }
  }
}

/** Auto-name an unnamed project ("Project N") from its first user message. */
function deriveName(current: string, session: SessionState): string {
  if (!/^Project \d+$/.test(current)) return current;
  const firstUser = session.messages.find((m) => m.role === 'user');
  if (!firstUser) return current;
  const text = firstUser.content
    .map((c) =>
      c.type === 'text'
        ? c.text
        : c.type === 'point_ref' || c.type === 'drawing_ref'
          ? `@${c.label}`
          : '',
    )
    .join(' ')
    .trim();
  if (!text) return current;
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function emptySession(): SessionState {
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

function freshProject(name: string): ProjectSnapshot {
  const id = rid('proj');
  const now = new Date().toISOString();
  return { meta: { id, name, createdAt: now, updatedAt: now }, session: emptySession(), meshBytes: {} };
}

export const useProjectsStore = create<ProjectsStore>()(
  persist(
    (set, get) => ({
      projects: {},
      order: [],
      currentProjectId: null,

      init: () => {
        if (get().currentProjectId) return;
        const id = rid('proj');
        const now = new Date().toISOString();
        const session = snapshotSession();
        set({
          projects: {
            [id]: {
              meta: { id, name: 'Project 1', createdAt: now, updatedAt: now },
              session,
              meshBytes: gatherMeshBytes(session.meshes),
            },
          },
          order: [id],
          currentProjectId: id,
        });
      },

      saveCurrent: () => {
        const cur = get().currentProjectId;
        const existing = cur ? get().projects[cur] : null;
        if (!cur || !existing) return;
        const session = snapshotSession();
        set((state) => ({
          projects: {
            ...state.projects,
            [cur]: {
              meta: {
                ...existing.meta,
                name: deriveName(existing.meta.name, session),
                updatedAt: new Date().toISOString(),
              },
              session,
              meshBytes: gatherMeshBytes(session.meshes),
            },
          },
        }));
      },

      loadCurrent: () => {
        const cur = get().currentProjectId;
        const snap = cur ? get().projects[cur] : undefined;
        if (snap) hydrateLiveFrom(snap);
      },

      createProject: (name) => {
        get().saveCurrent();
        const proj = freshProject(name ?? `Project ${get().order.length + 1}`);
        set((state) => ({
          projects: { ...state.projects, [proj.meta.id]: proj },
          order: [...state.order, proj.meta.id],
          currentProjectId: proj.meta.id,
        }));
        useRuntimeStore.getState().resetMeshes();
        useSessionStore.getState().reset();
        return proj.meta.id;
      },

      switchProject: (id) => {
        if (id === get().currentProjectId) return;
        const target = get().projects[id];
        if (!target) return;
        get().saveCurrent();
        hydrateLiveFrom(target);
        set({ currentProjectId: id });
      },

      renameProject: (id, name) =>
        set((state) => {
          const p = state.projects[id];
          if (!p) return {};
          return { projects: { ...state.projects, [id]: { ...p, meta: { ...p.meta, name } } } };
        }),

      deleteProject: (id) => {
        const state = get();
        if (!state.projects[id]) return;
        const remaining = state.order.filter((x) => x !== id);

        if (remaining.length === 0) {
          const proj = freshProject('Project 1');
          set({ projects: { [proj.meta.id]: proj }, order: [proj.meta.id], currentProjectId: proj.meta.id });
          useRuntimeStore.getState().resetMeshes();
          useSessionStore.getState().reset();
          return;
        }

        const wasCurrent = state.currentProjectId === id;
        const nextProjects = { ...state.projects };
        delete nextProjects[id];
        set({
          projects: nextProjects,
          order: remaining,
          currentProjectId: wasCurrent ? null : state.currentProjectId,
        });
        if (wasCurrent) get().switchProject(remaining[0]!);
      },
    }),
    {
      name: 'kerf-projects',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // Persist only the data, not the action functions.
      partialize: (s) => ({
        projects: s.projects,
        order: s.order,
        currentProjectId: s.currentProjectId,
      }),
    },
  ),
);
