import type Anthropic from '@anthropic-ai/sdk';
import type { BlenderClient } from '@/lib/blender/client';
import { buildContextMessages, type AgentContextInput } from './context';
import { SYSTEM_PROMPT } from './prompt';
import { MESH_MUTATING_TOOLS, TOOLS } from './tools';

export type AgentEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolName: string; toolUseId: string; input: unknown }
  | {
      type: 'tool_result';
      toolName: string;
      toolUseId: string;
      result: unknown;
      isError: boolean;
    }
  /** Emitted after a successful apply_named_operation when the worker
   *  returns a new STL — the frontend re-parses and swaps geometry. */
  | { type: 'mesh_updated'; webMeshId: string; stlBase64: string }
  | { type: 'turn_end'; stopReason: string | null }
  | { type: 'error'; message: string };

interface AgentOptions {
  model?: string;
  maxTurns?: number;
}

function isMocked(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const r = result as { mocked?: boolean; session_expired?: boolean; worker_error?: boolean };
  // Treat session_expired and worker_error like "didn't happen" for purposes
  // of mesh re-export — there's nothing new to export.
  return r.mocked === true || r.session_expired === true || r.worker_error === true;
}

function extractStlBase64(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const r = result as Record<string, unknown>;
  const camel = typeof r.stlBase64 === 'string' ? r.stlBase64 : null;
  const snake = typeof r.stl_base64 === 'string' ? r.stl_base64 : null;
  return camel ?? snake ?? undefined;
}

/** Strip large base64 payloads from tool results before re-feeding them to
 *  the model. The agent only needs the metadata; the actual STL is streamed
 *  to the frontend out-of-band via mesh_updated. Leaving these in the
 *  message context bloats prompts to multi-million tokens fast. */
function stripHeavyPayloads(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  if (Array.isArray(result)) return result.map(stripHeavyPayloads);
  const HEAVY = new Set([
    'png_base64',
    'pngBase64',
    'stl_base64',
    'stlBase64',
    'gltf_base64',
    'gltfBase64',
    'preview_image',
    'previewImage',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (HEAVY.has(k) && typeof v === 'string' && v.length > 1024) {
      out[k] = `<${v.length} bytes base64 — stripped from context>`;
    } else if (typeof v === 'object' && v !== null) {
      out[k] = stripHeavyPayloads(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Orchestration loop. Streams text deltas while accumulating tool calls,
 * then dispatches each tool call to the Blender worker (or mocks it), feeds
 * the results back, and continues until end_turn or maxTurns.
 *
 * Architecture: docs/research-claude-sdk.md §1.
 */
export class PrintableAgent {
  private readonly model: string;
  private readonly maxTurns: number;

  constructor(
    private readonly anthropic: Anthropic,
    private readonly blender: BlenderClient,
    options: AgentOptions = {},
  ) {
    // Sonnet 4.6: harness/tooling is the bottleneck right now, not raw model
    // intelligence — and Opus 4.7 burns 5x the tokens for the same agentic
    // loop. Bump back to Opus once the tools are reliable.
    this.model = options.model ?? 'claude-sonnet-4-6';
    // The agent should run until it decides it's done (end_turn). max_turns
    // is a runaway-safety net, not a budget — 100 is large enough that real
    // work never hits it.
    this.maxTurns = options.maxTurns ?? 100;
  }

  async *run(input: AgentContextInput): AsyncGenerator<AgentEvent> {
    const messages = buildContextMessages(input);

    for (let turn = 0; turn < this.maxTurns; turn++) {
      // effort='xhigh' is Opus-4.7-only. For Sonnet drop to 'high'.
      const effort = this.model.startsWith('claude-opus-4-7') ? 'xhigh' : 'high';
      const stream = this.anthropic.messages.stream({
        model: this.model,
        max_tokens: 100000,
        thinking: { type: 'adaptive' },
        output_config: { effort },
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: TOOLS,
        messages,
      });

      // Tell the UI we're working *before* a single token comes back, so the
      // assistant bubble shows a "Thinking…" pulse instead of sitting empty
      // through a long extended-thinking pass.
      yield { type: 'turn_start' };

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          // Surface tool calls the instant the model commits to one — not
          // after the entire stream finalizes. Input here is still empty
          // (the SDK fills it via input_json_delta); the dispatch loop
          // below re-emits with the full input and the client merges by id.
          const block = event.content_block;
          if (block.type === 'tool_use') {
            yield {
              type: 'tool_use_start',
              toolName: block.name,
              toolUseId: block.id,
              input: block.input,
            };
          }
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      messages.push({ role: 'assistant', content: finalMessage.content });

      const toolUseBlocks = finalMessage.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        yield { type: 'turn_end', stopReason: finalMessage.stop_reason };
        return;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        yield {
          type: 'tool_use_start',
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          input: toolUse.input,
        };
        try {
          const result = await this.dispatch(toolUse.name, toolUse.input);
          yield {
            type: 'tool_result',
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            result,
            isError: false,
          };
          // Strip large base64 payloads before re-feeding to the model. Without
          // this a render_preview call drops ~500KB of PNG bytes back into the
          // context, and 3-5 of those blow the 1M token window.
          const slimmed = stripHeavyPayloads(result);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(slimmed),
          });

          // If this was a mesh-mutating op and the worker actually applied it,
          // pull the new STL and stream it to the frontend so the viewer
          // re-renders with the cut/extrusion the user just asked for.
          if (MESH_MUTATING_TOOLS.has(toolUse.name) && !isMocked(result)) {
            const opInput = toolUse.input as { meshId?: string } | undefined;
            const targetMeshId = opInput?.meshId;
            if (targetMeshId) {
              try {
                const exported = await this.blender.exportStl(targetMeshId);
                const stlBase64 = extractStlBase64(exported);
                if (stlBase64) {
                  // The agent may have passed the worker id (e.g. "mesh_0"
                  // after an inspect_scene) instead of the web id. Map it
                  // back so the runtime store's geometry cache key matches
                  // what the viewer actually renders.
                  const webMeshId = this.blender.reverseTranslateMeshId(targetMeshId);
                  yield {
                    type: 'mesh_updated',
                    webMeshId,
                    stlBase64,
                  };
                }
              } catch {
                // Export failure shouldn't kill the turn.
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          yield {
            type: 'tool_result',
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            result: message,
            isError: true,
          };
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: message,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });

      if (finalMessage.stop_reason === 'end_turn') {
        yield { type: 'turn_end', stopReason: 'end_turn' };
        return;
      }
    }

    // Hit max_turns before the model said it was done. The user-visible chat
    // shows whatever partial text the model produced; this signals the
    // frontend to append a "[stopped — too many steps]" note so the user
    // isn't left wondering whether the agent's still working.
    yield { type: 'turn_end', stopReason: 'max_turns' };
  }

  private async dispatch(name: string, input: unknown): Promise<unknown> {
    if (MESH_MUTATING_TOOLS.has(name)) {
      // Forward the input verbatim, prefixed with `type: <tool name>` so the
      // worker can route it to the right Pydantic Operation variant.
      const op = {
        type: name,
        ...(input as Record<string, unknown>),
      } as Parameters<typeof this.blender.applyOperation>[0];
      return this.blender.applyOperation(op);
    }
    switch (name) {
      case 'render_preview':
        return this.blender.renderPreview(
          input as Parameters<typeof this.blender.renderPreview>[0],
        );
      case 'measure':
        return this.blender.measure(
          input as Parameters<typeof this.blender.measure>[0],
        );
      case 'verify':
        // Verify is also routed through apply_operation on the worker.
        return this.blender.applyOperation({
          type: 'verify',
          ...(input as Record<string, unknown>),
        } as Parameters<typeof this.blender.applyOperation>[0]);
      case 'inspect_scene':
        return this.blender.inspectScene();
      case 'inspect_object':
        return this.blender.inspectObject(
          input as Parameters<typeof this.blender.inspectObject>[0],
        );
      case 'raycast':
        return this.blender.raycast(
          input as Parameters<typeof this.blender.raycast>[0],
        );
      case 'commit_state':
        return { committed: true, timestamp: new Date().toISOString() };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
