import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlenderClient } from './client';

// Capture the request bodies the client actually sends to the worker, so the
// render/measure wire fixes are guarded from the TS side too (the Python
// contract_check.py guards the worker side).

beforeEach(() => {
  vi.restoreAllMocks();
});

function stubOkFetch(json: unknown) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function reqOf(fetchMock: { mock: { calls: unknown[][] } }): { url: string; body: any } {
  const call = fetchMock.mock.calls[0]!;
  const init = call[1] as { body: string };
  return { url: call[0] as string, body: JSON.parse(init.body) };
}

describe('BlenderClient wire mapping', () => {
  it('renderPreview forwards cameraPreset + showAxes (not view/show_axes)', async () => {
    const fetchMock = stubOkFetch({ ok: true });
    const c = new BlenderClient('http://w', 'sess_1', {});
    await c.renderPreview({ cameraPreset: 'front', showAxes: false, orthographic: true });
    const { url, body } = reqOf(fetchMock);
    expect(url).toContain('/sessions/sess_1/render_preview');
    expect(body.cameraPreset).toBe('front');
    expect(body.showAxes).toBe(false);
    expect('view' in body).toBe(false);
    expect('show_axes' in body).toBe(false);
  });

  it('renderPreview defaults a missing preset to iso (never undefined)', async () => {
    const fetchMock = stubOkFetch({ ok: true });
    const c = new BlenderClient('http://w', 'sess_1', {});
    await c.renderPreview({});
    expect(reqOf(fetchMock).body.cameraPreset).toBe('iso');
  });

  it('measure forwards the camelCase kind + point ids', async () => {
    const fetchMock = stubOkFetch({ kind: 'void_along_normal' });
    const c = new BlenderClient('http://w', 'sess_1', {});
    await c.measure({ kind: 'void_along_normal', fromPointId: 'pt_a' });
    const { body } = reqOf(fetchMock);
    expect(body.kind).toBe('void_along_normal');
    expect(body.fromPointId).toBe('pt_a');
  });

  it('applyOperation translates the web mesh id to the worker id', async () => {
    const fetchMock = stubOkFetch({ ok: true });
    const c = new BlenderClient('http://w', 'sess_1', { mh_web: 'mesh_0' });
    await c.applyOperation({ type: 'boolean_diff', meshId: 'mh_web', cutterMeshId: 'mh_web' });
    expect(reqOf(fetchMock).body.op.meshId).toBe('mesh_0');
  });
});
