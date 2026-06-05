import { describe, it, expect } from 'vitest';
import { summarizeOp, slimForDisplay } from './opSummary';

describe('summarizeOp', () => {
  it('summarizes add_cylinder_at_point', () => {
    expect(summarizeOp('add_cylinder_at_point', { pointId: 'pt_a', radius: 2.5, operation: 'cut' })).toBe(
      'pt_a · r2.5 · cut',
    );
  });

  it('summarizes boolean_diff with the cutter + solver', () => {
    const d = summarizeOp('boolean_diff', { meshId: 'm0', cutterMeshId: 'm1', solver: 'EXACT' });
    expect(d).toContain('m1');
    expect(d).toContain('EXACT');
  });

  it('summarizes measure by kind', () => {
    expect(summarizeOp('measure', { kind: 'void_along_normal' })).toBe('void_along_normal');
  });

  it('defaults render_preview to iso', () => {
    expect(summarizeOp('render_preview', {})).toBe('iso');
  });

  it('falls back sensibly for unknown / introspection tools', () => {
    expect(summarizeOp('inspect_scene', {})).toBe('');
    expect(summarizeOp('apply_modifier', { meshId: 'm3' })).toBe('m3');
  });
});

describe('slimForDisplay', () => {
  it('strips heavy base64 blobs but keeps siblings', () => {
    const out = slimForDisplay({ png_base64: 'x'.repeat(5000), ok: true }) as Record<string, unknown>;
    expect(String(out.png_base64)).toMatch(/bytes stripped/);
    expect(out.ok).toBe(true);
  });

  it('caps very long strings', () => {
    const out = slimForDisplay('y'.repeat(2000)) as string;
    expect(out.length).toBeLessThan(700);
    expect(out).toMatch(/chars\)$/);
  });

  it('passes through small values unchanged', () => {
    expect(slimForDisplay({ a: 1, b: 'hi' })).toEqual({ a: 1, b: 'hi' });
  });
});
