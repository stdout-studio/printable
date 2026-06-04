'use client';

import { useSessionStore } from '@/lib/store/session';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { Viewer } from '@/components/viewer/Viewer';
import { IntakeWizard } from '@/components/intake/IntakeWizard';

export function Workspace() {
  // Session store no longer persists, so we don't need a hydration gate.
  const intake = useSessionStore((s) => s.intake);
  const showWizard = intake === null;

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
