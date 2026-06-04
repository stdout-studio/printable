'use client';

import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/lib/store/session';
import { useRuntimeStore } from '@/lib/store/runtime';
import { snapshotCanvasDownsampled } from '@/lib/mesh/snapshot';
import { base64ToArrayBuffer, loadMeshFromStlBytes } from '@/lib/mesh/loaders';
import type { ChatContent } from '@printable/types';

const POINT_TOKEN_REGEX = /@(p\d+)/g;
const DRAWING_TOKEN_REGEX = /@(d\d+)/g;

interface AgentEvent {
  type:
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_result'
    | 'mesh_updated'
    | 'session_recovered'
    | 'turn_end'
    | 'error';
  text?: string;
  toolName?: string;
  toolUseId?: string;
  input?: unknown;
  result?: unknown;
  isError?: boolean;
  stopReason?: string | null;
  message?: string;
  webMeshId?: string;
  stlBase64?: string;
  /** session_recovered payload */
  workerSessionId?: string;
  workerMeshIds?: Record<string, string>;
}

export function Composer() {
  const points = useSessionStore((s) => s.points);
  const annotations = useSessionStore((s) => s.annotations);
  const meshes = useSessionStore((s) => s.meshes);
  const messages = useSessionStore((s) => s.messages);
  const contextMeshId = useSessionStore((s) => s.contextMeshId);
  const activeMeshId = useSessionStore((s) => s.activeMeshId);
  const workerSessionId = useSessionStore((s) => s.workerSessionId);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const appendTextToMessage = useSessionStore((s) => s.appendTextToMessage);
  const clearPoints = useSessionStore((s) => s.clearPoints);

  function captureViewportSnapshot(): string | null {
    // Real WebGL canvas only. The Html-rendered point labels are DOM,
    // not in the canvas pixel data — Claude sees the sphere markers
    // (which ARE in the GL scene) plus the point coords in the snapshot text.
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    return snapshotCanvasDownsampled(canvas, 800) ?? null;
  }

  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  // Listen for drawing-save events from DrawingOverlay
  useEffect(() => {
    function onDrawingToken(ev: Event) {
      const e = ev as CustomEvent<{ label: string }>;
      const label = e.detail?.label;
      if (!label) return;
      setValue((v) => {
        const sep = v && !v.endsWith(' ') ? ' ' : '';
        return `${v}${sep}@${label} `;
      });
      textareaRef.current?.focus();
    }
    window.addEventListener('printable:insert-drawing-token', onDrawingToken);
    return () => window.removeEventListener('printable:insert-drawing-token', onDrawingToken);
  }, []);

  function parseContent(text: string): ChatContent[] {
    interface Match {
      start: number;
      end: number;
      kind: 'point' | 'drawing';
      label: string;
    }
    const matches: Match[] = [];
    for (const m of text.matchAll(POINT_TOKEN_REGEX)) {
      const start = m.index ?? 0;
      matches.push({ start, end: start + m[0].length, kind: 'point', label: m[1]! });
    }
    for (const m of text.matchAll(DRAWING_TOKEN_REGEX)) {
      const start = m.index ?? 0;
      matches.push({ start, end: start + m[0].length, kind: 'drawing', label: m[1]! });
    }
    matches.sort((a, b) => a.start - b.start);

    const out: ChatContent[] = [];
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        out.push({ type: 'text', text: text.slice(cursor, match.start) });
      }
      if (match.kind === 'point') {
        const pt = points.find((p) => p.label === match.label);
        if (pt) out.push({ type: 'point_ref', pointId: pt.id, label: pt.label });
        else out.push({ type: 'text', text: text.slice(match.start, match.end) });
      } else {
        const ann = annotations.find((a) => a.label === match.label);
        if (ann) out.push({ type: 'drawing_ref', annotationId: ann.id, label: ann.label });
        else out.push({ type: 'text', text: text.slice(match.start, match.end) });
      }
      cursor = match.end;
    }
    if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
    return out;
  }

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setValue('');
    setSending(true);

    const parsed = parseContent(trimmed);

    // Snapshot the viewport BEFORE rendering the user message so the captured
    // frame still shows the points as the user clicked them.
    const viewportSnapshot = captureViewportSnapshot();

    appendMessage({ role: 'user', content: parsed });
    const assistantMsg = appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
    });

    // Include the raw STL bytes for every imported mesh so the API route can
    // silently re-import if the Blender session got torn down. Without this,
    // a session expiry leaves the agent unable to act on a mesh the viewer
    // still shows.
    const meshBytesMap = useRuntimeStore.getState().meshBytes;
    const meshStlBase64s: Record<string, string> = {};
    for (const m of meshes) {
      const bytes = meshBytesMap.get(m.id);
      if (bytes) meshStlBase64s[m.id] = bytes;
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userMessage: trimmed,
          conversationHistory: messages,
          points,
          meshes,
          contextMeshId,
          activeMeshId,
          workerSessionId,
          viewportSnapshot,
          meshStlBase64s,
        }),
      });

      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        appendTextToMessage(
          assistantMsg.id,
          `\n\n[error: ${err?.message ?? `HTTP ${res.status}`}]`,
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const text = line.trim();
          if (!text) continue;
          let event: AgentEvent;
          try {
            event = JSON.parse(text) as AgentEvent;
          } catch {
            continue;
          }
          if (event.type === 'text_delta' && typeof event.text === 'string') {
            appendTextToMessage(assistantMsg.id, event.text);
          } else if (event.type === 'mesh_updated' && event.webMeshId && event.stlBase64) {
            // Worker just returned a new STL — re-parse and swap geometry in
            // the runtime store. The viewer is subscribed and re-renders.
            try {
              const bytes = base64ToArrayBuffer(event.stlBase64);
              const loaded = loadMeshFromStlBytes(bytes);
              useRuntimeStore.getState().setMeshGeometry(event.webMeshId, loaded.geometry);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              appendTextToMessage(assistantMsg.id, `\n\n[mesh refresh failed: ${m}]`);
            }
          } else if (event.type === 'turn_end') {
            // If we ran out of action budget or stopped for a non-`end_turn`
            // reason, tell the user — otherwise the bubble looks stuck.
            if (event.stopReason && event.stopReason !== 'end_turn') {
              const label =
                event.stopReason === 'max_turns'
                  ? "I hit my action budget mid-task. Ask me to continue and I'll pick up from where I stopped."
                  : `Stopped: ${event.stopReason}`;
              appendTextToMessage(assistantMsg.id, `\n\n_${label}_`);
            }
          } else if (event.type === 'session_recovered' && event.workerSessionId) {
            // API route re-imported our meshes against a fresh Blender
            // session. Update local state silently — no chat-visible note.
            useSessionStore.getState().setWorkerSessionId(event.workerSessionId);
            if (event.workerMeshIds) {
              for (const [webId, workerId] of Object.entries(event.workerMeshIds)) {
                useSessionStore.getState().setWorkerMeshId(webId, workerId);
              }
            }
          } else if (event.type === 'error') {
            appendTextToMessage(
              assistantMsg.id,
              `\n\n[error: ${event.message ?? 'unknown'}]`,
            );
          }
          // Tool dispatch events (tool_use_start, tool_result) stay
          // in the network log — they're build chatter, not chat content.
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendTextToMessage(assistantMsg.id, `\n\n[network error: ${msg}]`);
    } finally {
      setSending(false);
      // Points are one-prompt helpers — clear ALL of them after the agent
      // finishes the turn, even ones the user didn't explicitly @-reference.
      // They were part of the context for this turn either way, and leaving
      // them around clutters the geometry the user wants to inspect next.
      clearPoints();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  function insertToken(token: string) {
    setValue((v) => {
      const sep = v && !v.endsWith(' ') ? ' ' : '';
      return `${v}${sep}${token} `;
    });
    textareaRef.current?.focus();
  }

  const hasTokens = points.length > 0 || annotations.length > 0;

  return (
    <div className="border-t border-[var(--color-border)] px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe what to design. Reference points with @p1, sketches with @d1…"
          rows={1}
          disabled={sending}
          className="flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 disabled:opacity-60"
        />
        <button
          onClick={() => void submit()}
          disabled={!value.trim() || sending}
          aria-label="Send"
          className="rounded-xl bg-[var(--color-accent)] text-white p-2.5 disabled:opacity-30 hover:opacity-90 transition-opacity"
        >
          <Send size={16} />
        </button>
      </div>
      {hasTokens && (
        <div className="mt-2 flex flex-wrap gap-1">
          {points.map((p) => (
            <button
              key={p.id}
              onClick={() => insertToken(`@${p.label}`)}
              disabled={sending}
              className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-indigo-500/12 text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-300 disabled:opacity-50"
            >
              @{p.label}
            </button>
          ))}
          {annotations.map((a) => (
            <button
              key={a.id}
              onClick={() => insertToken(`@${a.label}`)}
              disabled={sending}
              className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-rose-500/12 text-rose-700 hover:bg-rose-500/25 dark:text-rose-300 disabled:opacity-50"
            >
              @{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
