'use client';

import { useSessionStore } from '@/lib/store/session';
import { BrandMark } from '@/platform/BrandMark';
import { Composer } from './Composer';
import { Message } from './Message';
import { ProjectSwitcher } from './ProjectSwitcher';

export function ChatPanel() {
  const messages = useSessionStore((s) => s.messages);

  return (
    <div className="h-full flex flex-col">
      <header className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <BrandMark size={18} className="flex-shrink-0" />
        <ProjectSwitcher />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-[var(--color-fg-dim)] mt-8 px-2 leading-relaxed">
            <p>
              Double-click the model to drop a point, or hit{' '}
              <span className="text-[var(--fg-muted)]">Draw on this view</span> to sketch on it.
            </p>
            <p className="mt-2">
              Then describe what to make — reference points with{' '}
              <code className="mono text-xs bg-[var(--color-accent-soft)] text-[var(--flux)] px-1 py-0.5 rounded">
                @p1
              </code>{' '}
              and sketches with{' '}
              <code className="mono text-xs bg-[color-mix(in_oklab,var(--violet)_16%,transparent)] text-[var(--violet)] px-1 py-0.5 rounded">
                @d1
              </code>
              .
            </p>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
      </div>

      <Composer />
    </div>
  );
}
