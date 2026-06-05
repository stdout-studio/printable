'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/store/session';
import { useProjectsStore } from '@/lib/store/projects';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Viewer } from '@/components/viewer/Viewer';
import { IntakeWizard } from '@/components/intake/IntakeWizard';

export function Workspace() {
  const intake = useSessionStore((s) => s.intake);
  const showWizard = intake === null;

  // Wrap the initial live session as "Project 1" so the switcher has a project.
  useEffect(() => {
    useProjectsStore.getState().init();
  }, []);

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
