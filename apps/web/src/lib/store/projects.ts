'use client';

import { create } from 'zustand';
import type { SessionState } from '@printable/types';
import { base64ToArrayBuffer, loadMeshFromStlBytes } from '@/lib/mesh/loaders';
import { rid } from '@/lib/utils';
import { useRuntimeStore } from './runtime';
import { useSessionStore } from './session';

/**
 * Multi-project (Lovable-style) — one persistent chat that re-contexts per
 * project. The live working state stays in useSessionStore / useRuntimeStore;
 * this store holds a snapshot per project and orchestrates the swap. Geometry
 * is never stored here (it can't serialize); on switch we re-derive it from the
 * project's cached STL bytes.
 *
 * v1 is in-memory (switching within a session). Cross-reload persistence
 * (IndexedDB, to survive the mesh-byte volume) is the next step — see BUILD-PLAN.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectSnapshot {
  meta: ProjectMeta;
  /** Full serializable session state (no live geometry). */
  session: SessionState;
  /** webMeshId -> base64 STL, so geometry can be re-derived on switch. */
  meshBytes: Record<string, string>;
}

interface ProjectsState {
  projects: Record<string, ProjectSnapshot>;
  order: string[];
  currentProjectId: string | null;
}

interface ProjectsActions {
  /** Wrap the current live session as the first project (once, on mount). */
  init: () => void;
  /** Snapshot the live session + mesh bytes into the current project. */
  saveCurrent: () => void;
  /** Create a fresh empty project and switch to it (shows the intake wizard). */
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

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
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

  createProject: (name) => {
    get().saveCurrent();
    const proj = freshProject(name ?? `Project ${get().order.length + 1}`);
    set((state) => ({
      projects: { ...state.projects, [proj.meta.id]: proj },
      order: [...state.order, proj.meta.id],
      currentProjectId: proj.meta.id,
    }));
    // Reset the live stores so the new project starts clean (intake wizard shows).
    useRuntimeStore.getState().resetMeshes();
    useSessionStore.getState().reset();
    return proj.meta.id;
  },

  switchProject: (id) => {
    if (id === get().currentProjectId) return;
    const target = get().projects[id];
    if (!target) return;
    get().saveCurrent();

    useRuntimeStore.getState().resetMeshes();
    useSessionStore.getState().hydrate(target.session);
    const rt = useRuntimeStore.getState();
    for (const m of target.session.meshes) {
      const b = target.meshBytes[m.id];
      if (!b) continue;
      rt.setMeshBytes(m.id, b);
      try {
        const loaded = loadMeshFromStlBytes(base64ToArrayBuffer(b));
        rt.setMeshGeometry(m.id, loaded.geometry);
      } catch {
        // Corrupt bytes — UploadedMeshes shows a re-upload hint for this mesh.
      }
    }
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
      // Never leave zero projects.
      const proj = freshProject('Project 1');
      set({ projects: { [proj.meta.id]: proj }, order: [proj.meta.id], currentProjectId: proj.meta.id });
      useRuntimeStore.getState().resetMeshes();
      useSessionStore.getState().reset();
      return;
    }

    const wasCurrent = state.currentProjectId === id;
    const nextProjects = { ...state.projects };
    delete nextProjects[id];
    set({ projects: nextProjects, order: remaining, currentProjectId: wasCurrent ? null : state.currentProjectId });
    if (wasCurrent) get().switchProject(remaining[0]!);
  },
}));
