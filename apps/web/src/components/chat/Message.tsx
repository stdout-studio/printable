'use client';

import { useState } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';
import type { ChatMessage, OpStep } from '@printable/types';
import { useSessionStore } from '@/lib/store/session';
import clsx from 'clsx';

export function Message({ message }: { message: ChatMessage }) {
  const annotations = useSessionStore((s) => s.annotations);
  const isUser = message.role === 'user';

  // While the agent is working but has no visible output yet (text or
  // op steps), show a "Thinking…" pulse so the assistant bubble isn't
  // staring at the user as a blank box during a long thinking turn.
  const hasText = message.content.some((c) => c.type !== 'text' || c.text.length > 0);
  const hasOps = (message.ops?.length ?? 0) > 0;
  const showThinking = !isUser && message.pending && !hasText && !hasOps;

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
        {message.ops && message.ops.length > 0 && (
          <div className="mt-1.5 space-y-1 border-l border-[var(--line)] pl-2.5">
            {message.ops.map((op) => (
              <OpRow key={op.toolUseId} op={op} />
            ))}
          </div>
        )}
        {showThinking && (
          <div className="flex items-center gap-2 text-[11px] mono text-[var(--fg-dim)]">
            <span className="kerf-pulse h-1.5 w-1.5 rounded-full bg-[var(--status-process)]" />
            Thinking…
          </div>
        )}
      </div>
    </div>
  );
}

/** One agent tool call, rendered as a compact mono step — the inline
 *  flight-recorder. Collapsed by default; expands to the raw input/result. */
function OpRow({ op }: { op: OpStep }) {
  const [open, setOpen] = useState(false);
  const hasRaw = op.input != null || op.result != null;
  return (
    <div className="mono text-[11px]">
      <button
        onClick={() => hasRaw && setOpen((o) => !o)}
        className={clsx(
          'flex items-center gap-1.5 w-full text-left',
          hasRaw ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <span className="flex-shrink-0 grid place-items-center w-3.5 h-3.5">
          {op.status === 'running' ? (
            <span className="kerf-pulse h-1.5 w-1.5 rounded-full bg-[var(--status-process)]" />
          ) : op.status === 'ok' ? (
            <Check size={12} className="text-[var(--flux)]" />
          ) : (
            <X size={12} className="text-[var(--status-danger)]" />
          )}
        </span>
        <span className="text-[var(--fg-muted)]">{op.name}</span>
        {op.detail && <span className="text-[var(--fg-dim)] truncate">· {op.detail}</span>}
        {hasRaw && (
          <ChevronRight
            size={11}
            className={clsx(
              'ml-auto flex-shrink-0 text-[var(--fg-dim)] transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </button>
      {open && hasRaw && (
        <pre className="mt-1 ml-5 p-2 rounded-md bg-[var(--bg-void)] border border-[var(--line)] text-[10px] text-[var(--fg-dim)] overflow-auto max-h-56 whitespace-pre-wrap break-words">
          {JSON.stringify({ input: op.input, result: op.result }, null, 2)}
        </pre>
      )}
    </div>
  );
}
