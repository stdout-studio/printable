import { describe, it, expect, beforeEach } from 'vitest';
import type { CameraState } from '@printable/types';
import { useProjectsStore } from './projects';
import { useSessionStore } from './session';
import { useRuntimeStore } from './runtime';

const CAM: CameraState = { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 50 };

beforeEach(() => {
  useProjectsStore.setState({ projects: {}, order: [], currentProjectId: null });
  useSessionStore.getState().reset();
  useRuntimeStore.getState().resetMeshes();
});

describe('projects store (multi-project switching)', () => {
  it('init wraps the current session as Project 1', () => {
    useProjectsStore.getState().init();
    const s = useProjectsStore.getState();
    expect(s.order).toHaveLength(1);
    expect(s.currentProjectId).toBe(s.order[0]);
    expect(s.projects[s.currentProjectId!]!.meta.name).toBe('Project 1');
  });

  it('preserves each project’s chat + points across switches', () => {
    useProjectsStore.getState().init();
    const a = useProjectsStore.getState().currentProjectId!;

    useSessionStore.getState().appendMessage({ role: 'user', content: [{ type: 'text', text: 'hi from A' }] });
    useSessionStore.getState().addPoint({
      worldPosition: [1, 2, 3],
      surfaceNormal: [0, 0, 1],
      meshId: 'mh',
      cameraState: { ...CAM },
    });

    // New project B → A is snapshotted, the live session resets clean.
    const b = useProjectsStore.getState().createProject('B');
    expect(useProjectsStore.getState().order).toHaveLength(2);
    expect(useProjectsStore.getState().currentProjectId).toBe(b);
    expect(useSessionStore.getState().messages).toHaveLength(0);
    expect(useSessionStore.getState().points).toHaveLength(0);

    // Switch back to A → its chat + point return.
    useProjectsStore.getState().switchProject(a);
    expect(useProjectsStore.getState().currentProjectId).toBe(a);
    const msgs = useSessionStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content[0]).toMatchObject({ type: 'text', text: 'hi from A' });
    expect(useSessionStore.getState().points).toHaveLength(1);

    // B is still empty.
    useProjectsStore.getState().switchProject(b);
    expect(useSessionStore.getState().messages).toHaveLength(0);
  });

  it('deleting the current project switches to a sibling and never leaves zero', () => {
    useProjectsStore.getState().init();
    const a = useProjectsStore.getState().currentProjectId!;
    const b = useProjectsStore.getState().createProject('B');

    useProjectsStore.getState().deleteProject(b);
    expect(useProjectsStore.getState().order).toEqual([a]);
    expect(useProjectsStore.getState().currentProjectId).toBe(a);

    // Deleting the last project replaces it with a fresh one (never zero).
    useProjectsStore.getState().deleteProject(a);
    expect(useProjectsStore.getState().order).toHaveLength(1);
    expect(useProjectsStore.getState().currentProjectId).not.toBeNull();
  });
});
