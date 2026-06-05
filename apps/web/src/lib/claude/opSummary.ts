/**
 * Turn an agent tool call into a compact, mono "operation step" line, and slim
 * tool results for the collapsible raw view (the inline flight-recorder in the
 * chat). Pure — unit-tested.
 */

type Rec = Record<string, unknown>;

function s(v: unknown): string {
  return v == null ? '' : String(v);
}

/** A short human-ish summary of what a tool call does, in mono. */
export function summarizeOp(name: string, input: unknown): string {
  const i = (input ?? {}) as Rec;
  switch (name) {
    case 'add_cylinder_at_point':
      return [s(i.pointId), i.radius != null ? `r${s(i.radius)}` : '', s(i.operation) || 'cut']
        .filter(Boolean)
        .join(' · ');
    case 'add_box_at_point':
      return [s(i.pointId), s(i.operation) || 'cut'].filter(Boolean).join(' · ');
    case 'boolean_diff':
      return [`− ${s(i.cutterMeshId) || 'cutter'}`, s(i.solver) || 'EXACT'].join(' · ');
    case 'boolean_union':
      return [`+ ${s(i.otherMeshId) || 'mesh'}`, s(i.solver) || 'EXACT'].join(' · ');
    case 'render_preview':
      return s(i.cameraPreset) || 'iso';
    case 'measure':
      return s(i.kind);
    case 'verify':
      return Array.isArray(i.checks) ? (i.checks as unknown[]).join(',') : 'manifold';
    case 'raw_bpy':
      return 'script';
    case 'create_primitive':
      return s(i.primitive);
    case 'transform_mesh':
    case 'set_transform':
    case 'duplicate_object':
    case 'delete_object':
    case 'inspect_object':
      return s(i.meshId) || s(i.nameOrId);
    case 'join_objects':
      return Array.isArray(i.meshIds) ? (i.meshIds as unknown[]).join('+') : '';
    default:
      return s(i.meshId);
  }
}

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

/** Strip heavy base64 blobs + cap long strings/arrays so a tool result is safe
 *  to keep on the message + render in the raw view. */
export function slimForDisplay(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > 600 ? `${value.slice(0, 600)}… (${value.length} chars)` : value;
  }
  if (Array.isArray(value)) {
    if (depth > 4) return '[…]';
    return value.slice(0, 50).map((v) => slimForDisplay(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth > 4) return '{…}';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Rec)) {
      if (HEAVY.has(k) && typeof v === 'string') out[k] = `<${v.length} bytes stripped>`;
      else out[k] = slimForDisplay(v, depth + 1);
    }
    return out;
  }
  return value;
}
