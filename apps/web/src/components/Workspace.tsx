'use client';

import { useEffect, useState } from 'react';
import { useSessionStore } from '@/lib/store/session';
import { useProjectsStore } from '@/lib/store/projects';
import { BrandMark } from '@/platform/BrandMark';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Viewer } from '@/components/viewer/Viewer';
import { IntakeWizard } from '@/components/intake/IntakeWizard';

export function Workspace() {
  const intake = useSessionStore((s) => s.intake);
  const showWizard = intake === null;
  const [hydrated, setHydrated] = useState(false);

  // Wait for the persisted projects to hydrate from IndexedDB, then either
  // restore the last project (across reloads) or wrap the fresh session as
  // Project 1. Fail-safe: if hydration yields nothing, init() runs.
  useEffect(() => {
    let done = false;
    const decide = () => {
      if (done) return;
      done = true;
      const s = useProjectsStore.getState();
      if (s.currentProjectId && s.projects[s.currentProjectId]) s.loadCurrent();
      else s.init();
      setHydrated(true);
    };
    const unsub = useProjectsStore.persist.onFinishHydration(decide);
    if (useProjectsStore.persist.hasHydrated()) decide();
    return unsub;
  }, []);

  // Persist the live session into the current project on tab close / unmount so
  // recent edits survive a reload (switch/create/delete already save).
  useEffect(() => {
    if (!hydrated) return;
    const save = () => useProjectsStore.getState().saveCurrent();
    window.addEventListener('beforeunload', save);
    return () => {
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [hydrated]);

  if (!hydrated) {
    return (
      <main className="h-screen w-screen grid place-items-center bg-[var(--bg-void)]">
        <span className="kerf-pulse">
          <BrandMark size={28} />
        </span>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen flex overflow-hidden">
      <aside className="w-[420px] flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <ChatPanel />
      </aside>
      <section className="flex-1 relative bg-[var(--color-bg)]">
        <Viewer />
      </section>
      {showWizard && <IntakeWizard />}
    </main>
  );
}
