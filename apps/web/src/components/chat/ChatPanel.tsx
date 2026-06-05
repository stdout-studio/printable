'use client';

import { useSessionStore } from '@/lib/store/session';
import { appConfig } from '@/platform/app-config';
import { Composer } from './Composer';
import { Message } from './Message';

export function ChatPanel() {
  const messages = useSessionStore((s) => s.messages);
  const reset = useSessionStore((s) => s.reset);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[1px] bg-[var(--flux)] shadow-[0_0_8px_var(--flux-glow)]" />
          <h1 className="text-base font-semibold tracking-tight lowercase">{appConfig.name}</h1>
        </div>
        <button
          onClick={reset}
          className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-dim)] hover:text-[var(--flux)] transition-colors"
        >
          New
        </button>
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
