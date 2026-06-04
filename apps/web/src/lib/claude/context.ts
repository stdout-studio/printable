import type Anthropic from '@anthropic-ai/sdk';
import type {
  ChatContent,
  ChatMessage,
  MeshHandle,
  PointToken,
} from '@printable/types';

export interface AgentContextInput {
  userMessage: string;
  conversationHistory: ChatMessage[];
  points: PointToken[];
  meshes: MeshHandle[];
  contextMeshId: string | null;
  activeMeshId: string | null;
  /** PNG (base64, no data: prefix) of the current viewer GL canvas at the
   *  moment of submit. Provides visual context to Opus 4.7 alongside the
   *  point coords + mesh stats text snapshot. */
  viewportSnapshot?: string | null;
}

/**
 * Build the message array sent to Claude. Layout follows
 * docs/research-claude-sdk.md §2 — stable context first (cacheable),
 * volatile content (the new user prompt) last.
 *
 * Structure per turn:
 *   1. Snapshot: point list + mesh summary as a single user text block
 *      (cache_control on it so subsequent turns hit cache).
 *   2. Prior conversation, replayed.
 *   3. The new user message.
 *
 * Renders (PNG previews) are added by the agent loop on tool_result turns,
 * not here — they change every turn and never cache.
 */
export function buildContextMessages(
  input: AgentContextInput,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  const snapshot = renderSessionSnapshot(input);
  if (snapshot) {
    // Interleave the snapshot text with per-point images: text says
    // "@p1 — pos ... normal ... (image attached)", followed by the
    // image content block. Claude correlates label → coords → image.
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: snapshot },
    ];
    for (const p of input.points) {
      if (!p.viewportSnapshot) continue;
      content.push({
        type: 'text',
        text: `(image below: view at the moment @${p.label} was dropped)`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: p.viewportSnapshot,
        },
      });
    }
    // Tag the LAST block in this user turn as the cache breakpoint so the
    // whole snapshot prefix (text + images) is cacheable across turns where
    // it doesn't change.
    const last = content[content.length - 1];
    if (last) (last as { cache_control?: unknown }).cache_control = { type: 'ephemeral' };

    messages.push({ role: 'user', content });
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'Context received. Ready to design.' }],
    });
  }

  for (const msg of input.conversationHistory) {
    messages.push({
      role: msg.role === 'system' ? 'user' : msg.role,
      content: serializeChatContent(msg.content, input.points),
    });
  }

  // Final user turn: the new prompt, plus the current viewer snapshot if we
  // have one. The snapshot is the GL canvas — it contains the sphere markers
  // for each clicked point (the @pN HTML labels are DOM, not pixel data, so
  // Claude correlates the spheres with the labels via the text snapshot above).
  if (input.viewportSnapshot) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: input.viewportSnapshot,
          },
        },
        { type: 'text', text: input.userMessage },
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: input.userMessage,
    });
  }

  return messages;
}

function renderSessionSnapshot(input: AgentContextInput): string | null {
  const lines: string[] = [];

  if (input.meshes.length > 0) {
    lines.push('## Meshes in session');
    for (const m of input.meshes) {
      const role = describeMeshRole(m.id, input);
      const bbox = m.boundingBox;
      const dx = (bbox.max[0] - bbox.min[0]).toFixed(1);
      const dy = (bbox.max[1] - bbox.min[1]).toFixed(1);
      const dz = (bbox.max[2] - bbox.min[2]).toFixed(1);
      lines.push(
        `- ${m.id} (${m.label}) — ${m.source}${role ? `, ${role}` : ''}, ${dx}×${dy}×${dz} mm, ${m.triangleCount.toLocaleString()} tris`,
      );
    }
  }

  if (input.points.length > 0) {
    lines.push('');
    lines.push('## User-marked points');
    lines.push('Use the `id` field when calling tools; the @label is for chat display only.');
    for (const p of input.points) {
      const [x, y, z] = p.worldPosition;
      const [nx, ny, nz] = p.surfaceNormal;
      const snap = p.viewportSnapshot ? ' (image attached)' : '';
      lines.push(
        `- @${p.label} id=${p.id} — pos (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) mm, normal (${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}), on mesh ${p.meshId}${snap}`,
      );
    }
  }

  if (lines.length === 0) return null;
  return ['# Session snapshot', ...lines].join('\n');
}

function describeMeshRole(
  meshId: string,
  input: AgentContextInput,
): string | null {
  if (meshId === input.contextMeshId) return 'context — the scanned thing we design around';
  if (meshId === input.activeMeshId) return 'active — the part being edited';
  return null;
}

function serializeChatContent(
  content: ChatContent[],
  _points: PointToken[],
): string {
  return content
    .map((c) => {
      if (c.type === 'text') return c.text;
      if (c.type === 'point_ref') return `@${c.label}`;
      if (c.type === 'drawing_ref') return `@${c.label}`;
      if (c.type === 'render_preview') return '[render preview attached]';
      return '';
    })
    .join('');
}
