import { describe, it, expect } from 'vitest';
import type { CameraState } from '@printable/types';
import type { AgentContextInput } from './context';
import { buildContextMessages } from './context';

const CAM: CameraState = { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], fov: 50 };

function base(overrides: Partial<AgentContextInput> = {}): AgentContextInput {
  return {
    userMessage: 'do the thing',
    conversationHistory: [],
    points: [],
    annotations: [],
    meshes: [],
    contextMeshId: null,
    activeMeshId: null,
    ...overrides,
  };
}

// Loosely-typed block accessor — the Anthropic content-block union is awkward to
// narrow in a test; we just assert on the runtime shape.
function block(content: unknown, type: string): any {
  const arr = content as Array<{ type: string }>;
  const b = arr.find((x) => x.type === type);
  if (!b) throw new Error(`no ${type} block found`);
  return b;
}

describe('buildContextMessages', () => {
  it('with no context, sends a single plain user message', () => {
    const msgs = buildContextMessages(base());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toBe('do the thing');
  });

  it('attaches a per-point screenshot image and lists the point by id', () => {
    const msgs = buildContextMessages(
      base({
        points: [
          {
            id: 'pt_a',
            label: 'p1',
            worldPosition: [1, 2, 3],
            surfaceNormal: [0, 0, 1],
            meshId: 'mh_0',
            cameraState: { ...CAM },
            viewportSnapshot: 'AAAA',
            createdAt: 'now',
          },
        ],
      }),
    );
    expect(block(msgs[0]!.content, 'text').text).toContain('@p1');
    expect(block(msgs[0]!.content, 'text').text).toContain('pt_a'); // id, not label
    const img = block(msgs[0]!.content, 'image');
    expect(img.source.data).toBe('AAAA');
    expect(img.source.media_type).toBe('image/png');
  });

  it('sends drawings/sketches to the model as images (the Phase A fix)', () => {
    const msgs = buildContextMessages(
      base({
        annotations: [
          {
            id: 'an_1',
            label: 'd1',
            cameraState: { ...CAM },
            imagePngDataUrl: 'data:image/png;base64,SKETCHBYTES',
            width: 100,
            height: 80,
            createdAt: 'now',
          },
        ],
      }),
    );
    expect(block(msgs[0]!.content, 'text').text).toContain('User sketches');
    expect(block(msgs[0]!.content, 'text').text).toContain('@d1');
    const img = block(msgs[0]!.content, 'image');
    expect(img.source.data).toBe('SKETCHBYTES'); // data: prefix stripped
    expect(img.source.media_type).toBe('image/png');
  });

  it('attaches the live viewport snapshot to the final user message', () => {
    const msgs = buildContextMessages(base({ viewportSnapshot: 'LIVE' }));
    const last = msgs[msgs.length - 1]!;
    expect(last.role).toBe('user');
    expect(block(last.content, 'image').source.data).toBe('LIVE');
    expect(block(last.content, 'text').text).toBe('do the thing');
  });

  it('marks the snapshot block cacheable (cache_control on its last block)', () => {
    const msgs = buildContextMessages(
      base({
        points: [
          {
            id: 'pt_a',
            label: 'p1',
            worldPosition: [0, 0, 0],
            surfaceNormal: [0, 0, 1],
            meshId: 'mh_0',
            cameraState: { ...CAM },
            viewportSnapshot: 'X',
            createdAt: 'now',
          },
        ],
      }),
    );
    const blocks = msgs[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(blocks[blocks.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
  });
});
