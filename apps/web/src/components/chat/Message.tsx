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
          'max-w-[90%] text-sm leading-relaxed space-y-2',
          // User = a steel bubble with a violet edge (human voice); assistant =
          // no bubble, prose sits directly on the rail ("speaks into" the panel).
          isUser
            ? 'rounded-2xl rounded-tr-md border-l-2 border-[var(--violet)] bg-[var(--bg-elev)] px-3 py-2 text-[var(--fg)]'
            : 'px-0.5 text-[var(--fg)]',
        )}
      >
        {message.content.map((c, i) => {
          if (c.type === 'text') return <span key={i}>{c.text}</span>;
          if (c.type === 'point_ref') {
            return (
              <span
                key={i}
                className="inline-block mx-0.5 px-1.5 py-0.5 rounded mono text-[11px] bg-[var(--color-accent-soft)] text-[var(--flux)]"
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
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded mono text-[11px] bg-[color-mix(in_oklab,var(--violet)_18%,transparent)] text-[var(--violet)]">
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
