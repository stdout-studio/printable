'use client';

import { useSessionStore } from '@/lib/store/session';
import { Composer } from './Composer';
import { Message } from './Message';

export function ChatPanel() {
  const messages = useSessionStore((s) => s.messages);
  const points = useSessionStore((s) => s.points);
  const reset = useSessionStore((s) => s.reset);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Printable</h1>
          <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
            {points.length} point{points.length === 1 ? '' : 's'} marked
          </p>
        </div>
        <button
          onClick={reset}
          className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] underline-offset-2 hover:underline"
        >
          New session
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-sm text-[var(--color-fg-dim)] mt-8 px-2 leading-relaxed">
            <p>Double-click the 3D model on the right to mark a point.</p>
            <p className="mt-2">
              Then describe what to design. Reference points with{' '}
              <code className="font-mono text-xs bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-1 py-0.5 rounded">
                @p1
              </code>
              ,{' '}
              <code className="font-mono text-xs bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-1 py-0.5 rounded">
                @p2
              </code>
              , etc.
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
