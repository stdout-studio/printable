'use client';

import type { ChatMessage } from '@printable/types';
import { useSessionStore } from '@/lib/store/session';
import clsx from 'clsx';

export function Message({ message }: { message: ChatMessage }) {
  const annotations = useSessionStore((s) => s.annotations);
  const isUser = message.role === 'user';

  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed space-y-2',
          isUser
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg)]',
        )}
      >
        {message.content.map((c, i) => {
          if (c.type === 'text') return <span key={i}>{c.text}</span>;
          if (c.type === 'point_ref') {
            return (
              <span
                key={i}
                className={clsx(
                  'inline-block mx-0.5 px-1.5 py-0.5 rounded font-mono text-[11px]',
                  isUser
                    ? 'bg-white/20'
                    : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
                )}
              >
                @{c.label}
              </span>
            );
          }
          if (c.type === 'drawing_ref') {
            const ann = annotations.find((a) => a.id === c.annotationId);
            if (!ann) return null;
            return (
              <div key={i} className="block">
                <img
                  src={ann.imagePngDataUrl}
                  alt={`sketch @${ann.label}`}
                  className="rounded-lg border border-[var(--color-border)] max-w-full"
                />
                <span
                  className={clsx(
                    'inline-block mt-1 px-1.5 py-0.5 rounded font-mono text-[11px]',
                    isUser ? 'bg-white/20' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                  )}
                >
                  @{ann.label}
                </span>
              </div>
            );
          }
          if (c.type === 'render_preview') {
            return (
              <img
                key={i}
                src={c.pngDataUrl}
                alt={c.label ?? 'preview'}
                className="rounded-lg border border-[var(--color-border)] max-w-full"
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
