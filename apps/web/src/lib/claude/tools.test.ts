import { describe, it, expect } from 'vitest';
import { TOOLS, MESH_MUTATING_TOOLS } from './tools';

function tool(name: string) {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`no tool named ${name}`);
  return t;
}

function props(name: string): Record<string, { enum?: string[] } & Record<string, unknown>> {
  return (tool(name).input_schema as { properties: Record<string, never> }).properties as never;
}

describe('tool schemas mirror the worker contract', () => {
  // Guards the measure fix: the tool used to advertise raycast_from_point /
  // void_at_point, which the worker 422'd. Must be exactly the worker's kinds.
  it('measure advertises only worker-supported kinds', () => {
    const kinds = props('measure').kind!.enum!;
    expect(new Set(kinds)).toEqual(
      new Set([
        'distance_between_points',
        'raycast_hit',
        'void_along_normal',
        'min_wall_thickness',
        'bbox_dims',
      ]),
    );
    expect(kinds).not.toContain('raycast_from_point');
    expect(kinds).not.toContain('void_at_point');
  });

  // Guards the render_preview fix: the client forwards cameraPreset/showAxes;
  // the tool must expose exactly those keys (not view/show_axes).
  it('render_preview exposes cameraPreset + showAxes', () => {
    const p = props('render_preview');
    expect(p.cameraPreset).toBeDefined();
    expect(p.cameraPreset!.enum).toContain('iso');
    expect(p.showAxes).toBeDefined();
    expect(p.view).toBeUndefined();
    expect(p.show_axes).toBeUndefined();
  });

  it('every mesh-mutating tool is a real tool', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const m of MESH_MUTATING_TOOLS) expect(names.has(m)).toBe(true);
  });

  it('all tools have unique names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.length).toBe(new Set(names).size);
  });
});
