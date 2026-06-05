import type Anthropic from '@anthropic-ai/sdk';

// One tool per Blender operation. Each schema mirrors the worker's Pydantic
// model exactly (see apps/blender-worker/src/schemas.py and packages/shared-
// types/operations.ts). Anthropic doesn't allow `oneOf`/`anyOf` at the top
// level of a tool's input_schema, so we split rather than use a discriminated
// union in one tool.
//
// Mesh-mutating tools get their stl exported + streamed to the viewer after
// they succeed; non-mutating tools (render_preview, measure, commit_state)
// don't.

const MM_NUMBER = { type: 'number' as const, description: 'In millimetres.' };
const VEC3 = {
  type: 'array' as const,
  items: { type: 'number' as const },
  minItems: 3 as const,
  maxItems: 3 as const,
};
const EDGE_REGION = {
  description: 'List of edge indices to operate on, or the literal string "all".',
  type: ['array', 'string'] as unknown as 'string',
  // Anthropic's validator wants a primitive type — we tell Claude in the
  // description that "all" is also valid and rely on its instruction-following.
};

export const MESH_MUTATING_TOOLS = new Set([
  'boolean_diff',
  'boolean_union',
  'add_cylinder_at_point',
  'add_box_at_point',
  'extrude_faces',
  'fillet_edges',
  'chamfer_edges',
  'transform_mesh',
  'raw_bpy',
  'create_primitive',
  'delete_object',
  'duplicate_object',
  'set_transform',
  'add_modifier',
  'apply_modifier',
  'join_objects',
]);

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'boolean_diff',
    description:
      'Boolean difference: subtract `cutterMeshId` from `meshId`. The cutter is removed by default. Use this for explicit "carve A out of B" operations when you already have both meshes. For drilling a hole at a clicked point, prefer `add_cylinder_at_point` — it creates the cutter automatically.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string', description: 'Target mesh (the body being cut).' },
        cutterMeshId: { type: 'string', description: 'Mesh used as the cutter.' },
        solver: { type: 'string', enum: ['EXACT', 'FAST'], description: 'EXACT is required for correctness; FAST has silent failures.' },
        useSelf: { type: 'boolean' },
        useHoleTolerant: { type: 'boolean' },
        fdmToleranceMm: { type: 'number', description: 'Extra mm per side (+0.1–0.2 for friction-fit features).' },
        keepCutter: { type: 'boolean' },
      },
      required: ['meshId', 'cutterMeshId'],
    },
  },
  {
    name: 'boolean_union',
    description: 'Boolean union: merge `otherMeshId` into `meshId`.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        otherMeshId: { type: 'string' },
        solver: { type: 'string', enum: ['EXACT', 'FAST'] },
        useSelf: { type: 'boolean' },
        useHoleTolerant: { type: 'boolean' },
        keepOther: { type: 'boolean' },
      },
      required: ['meshId', 'otherMeshId'],
    },
  },
  {
    name: 'add_cylinder_at_point',
    description:
      'Drill a hole, place a peg, or place a translucent placeholder cylinder at a clicked point. `operation: "cut"` removes material (hole); `"emboss"` adds material (peg); `"placeholder"` previews the location with a translucent cylinder. The cylinder is oriented along the point\'s surface normal when `alongNormal: true`. Use this for "drill a 5mm hole through @p1" style requests.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string', description: 'The body being cut into or extruded from.' },
        pointId: { type: 'string', description: 'Clicked point id (e.g. "pt_abc"). The user-visible @pN label and this id are stored on the same PointToken — use the id, not the label.' },
        radius: { ...MM_NUMBER, description: 'Cylinder radius in mm (half of diameter).' },
        height: { ...MM_NUMBER, description: 'Depth in mm.' },
        alongNormal: { type: 'boolean', description: 'Default true — cylinder axis = surface normal.' },
        operation: {
          type: 'string',
          enum: ['cut', 'emboss', 'placeholder'],
          description: '"cut" = drill (boolean diff). "emboss" = peg (boolean union). "placeholder" = translucent preview, no boolean.',
        },
        fit: {
          type: 'string',
          enum: ['press', 'clearance', 'free'],
          description: 'FDM tolerance preset. press = no oversize (snug grip). clearance = +0.15mm/side (slip fit). free = +0.3mm/side (loose).',
        },
      },
      required: ['meshId', 'pointId', 'radius', 'height'],
    },
  },
  {
    name: 'add_box_at_point',
    description: 'Place a rectangular pocket (cut) or pad (emboss) at a clicked point.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        pointId: { type: 'string' },
        size: { ...VEC3, description: '[width, depth, height] in mm.' },
        alignToNormal: { type: 'boolean' },
        operation: { type: 'string', enum: ['cut', 'emboss', 'placeholder'] },
      },
      required: ['meshId', 'pointId', 'size'],
    },
  },
  {
    name: 'extrude_faces',
    description: 'Push selected faces by `distance` mm. Positive = outward, negative = inward.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        faceIndices: { type: 'array', items: { type: 'integer' } },
        distance: { type: 'number', description: 'mm.' },
      },
      required: ['meshId', 'faceIndices', 'distance'],
    },
  },
  {
    name: 'fillet_edges',
    description: 'Round edges with `radius` mm. Pass faceIndices as an array of ints, or the literal string "all" via raw_bpy if needed for v0.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        edgeIndices: { type: 'array', items: { type: 'integer' } },
        radius: { ...MM_NUMBER },
      },
      required: ['meshId', 'edgeIndices', 'radius'],
    },
  },
  {
    name: 'chamfer_edges',
    description: 'Bevel edges by `width` mm.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        edgeIndices: { type: 'array', items: { type: 'integer' } },
        width: { ...MM_NUMBER },
      },
      required: ['meshId', 'edgeIndices', 'width'],
    },
  },
  {
    name: 'transform_mesh',
    description: 'Translate / rotate (Euler degrees) / scale a mesh.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        translate: VEC3,
        rotateEulerDegrees: VEC3,
        scale: VEC3,
      },
      required: ['meshId', 'translate', 'rotateEulerDegrees', 'scale'],
    },
  },
  {
    name: 'verify',
    description: 'Sanity-check the current mesh (manifoldness, raycast hits, minimum wall, overhangs). Call after every boolean.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['manifold', 'raycast_hit', 'min_wall_mm', 'overhang'] },
        },
        minWallMm: { type: 'number' },
      },
      required: ['meshId', 'checks'],
    },
  },
  {
    name: 'raw_bpy',
    description: [
      'Escape hatch: execute Blender Python in the worker session. Use this when the named ops cannot express the geometry — e.g. multi-point cutters, spatial edge selection, custom sweeps, custom bmesh.',
      '',
      '## Exec namespace',
      '- `bpy`, `bmesh`, `math`, `Vector` (mathutils.Vector)',
      '- `ctx` — the session context:',
      '  - `ctx.points` — dict { pointId: { "world_position": [x,y,z], "surface_normal": [nx,ny,nz], "mesh_id": <worker mesh id>, "label": "p1" } }. Use the WORKER mesh ids, not the @label.',
      '  - `ctx.resolve(mesh_id)` — returns the Blender Object for a mesh id.',
      '  - `ctx.active_mesh_id` — the currently active mesh id.',
      '- Builtins are restricted: `len, range, enumerate, min, max, abs, sum, sorted, list, dict, set, tuple, int, float, str, bool, print, isinstance, Exception` only.',
      '',
      '## Imports',
      '`bpy`, `bmesh`, `math`, `Vector` are already injected — you do not need `import` statements for them. If you do write them they will work, but they are noise. `os`, `subprocess`, `sys`, `socket`, `urllib`, `shutil`, `pathlib`, `tempfile`, `pickle`, `ctypes`, `importlib`, `threading`, `asyncio`, etc. are rejected at parse time — do not try to import them.',
      '',
      '## Return value',
      'Set `result` to a JSON-serialisable dict. The worker returns:',
      '- `diff_summary.tri_count_before / tri_count_after` — for the target mesh you passed in `meshId`. **If these are equal, your script did not change the body. Do not claim success.**',
      '- `script_result` — the repr of your `result` variable.',
      '- `script_stdout` — anything you `print()`ed.',
      '- `script_error` — set ONLY if your script raised. If non-null, the script crashed — read it, fix the script, retry.',
      '',
      '## Critical for cutting with clicked points',
      'Real-world clicks rarely land on a single planar face. The 4 corners can have DIFFERENT surface_normal vectors (e.g. two on the top face, two on the side face). You MUST handle this:',
      '1. Detect: are all 4 normals approximately equal (dot > 0.95)? If yes, the user clicked one face — extrude along that shared normal.',
      '2. If normals diverge: project all 4 points onto the dominant plane. Pick the axis with the LEAST variance across the points (that\'s the through-cut axis), set every point\'s coordinate on that axis to the bar\'s mid-plane value, then extrude perpendicular to that axis from outside the bar to outside.',
      '',
      'For a through-cut on a bar, the safer recipe is: compute the body\'s bbox, pick the axis with the smallest extent (the bar\'s thin direction = the through-cut axis), set every cutter corner\'s position on that axis to (bbox_min - eps), and extrude along +axis for (extent + 2*eps). The cutter is then a prism that fully overlaps the bar in the through direction; the 4 corners only define the shape of the hole in the OTHER two dimensions.',
      '',
      '## Worked example — through-rectangle cutout from 4 clicked corners',
      '```python',
      '# NO `import` statements — bmesh, bpy, math, Vector are already in scope.',
      '',
      'BODY_ID = "mesh_0"   # use the real worker mesh id',
      'PIDS = ["pt_a", "pt_b", "pt_c", "pt_d"]   # the actual ids from ctx.points',
      'pts = [Vector(ctx.points[p]["world_position"]) for p in PIDS]',
      'body = ctx.resolve(BODY_ID)',
      '',
      '# Pick the through-axis = the bar\'s thin axis (smallest bbox extent in world).',
      'mw = body.matrix_world',
      'world_co = [mw @ v.co for v in body.data.vertices]',
      'mn = Vector((min(c.x for c in world_co), min(c.y for c in world_co), min(c.z for c in world_co)))',
      'mx = Vector((max(c.x for c in world_co), max(c.y for c in world_co), max(c.z for c in world_co)))',
      'extent = mx - mn',
      'thru_axis = [extent.x, extent.y, extent.z].index(min(extent.x, extent.y, extent.z))   # 0=X, 1=Y, 2=Z',
      'eps = 2.0   # mm overshoot on each side',
      '',
      '# Project the 4 clicked corners onto the bar\'s near face (thru_axis = mn).',
      'near = mn[thru_axis] - eps',
      'far  = mx[thru_axis] + eps',
      'def at_near(p):',
      '    v = Vector(p); v[thru_axis] = near; return v',
      'def at_far(p):',
      '    v = Vector(p); v[thru_axis] = far; return v',
      '',
      '# Order the corners around the polygon so edges don\'t cross. Use the centroid + atan2 of the two in-plane axes.',
      'axes = [i for i in [0,1,2] if i != thru_axis]',
      'centroid = sum((p for p in pts), Vector((0,0,0))) / 4',
      'def angle(p):',
      '    return math.atan2(p[axes[1]] - centroid[axes[1]], p[axes[0]] - centroid[axes[0]])',
      'pts_sorted = sorted(pts, key=angle)',
      '',
      '# Build a closed prism cutter: 4 verts near, 4 verts far, top + bottom + 4 sides.',
      'mesh = bpy.data.meshes.new("cutter_mesh")',
      'obj = bpy.data.objects.new("cutter", mesh)',
      'bpy.context.scene.collection.objects.link(obj)',
      'bm = bmesh.new()',
      'near_v = [bm.verts.new(at_near(p)) for p in pts_sorted]',
      'far_v  = [bm.verts.new(at_far(p))  for p in pts_sorted]',
      'bm.faces.new(near_v)',
      'bm.faces.new(far_v[::-1])',
      'for i in range(4):',
      '    bm.faces.new([near_v[i], near_v[(i+1)%4], far_v[(i+1)%4], far_v[i]])',
      'bm.normal_update()',
      'bm.to_mesh(mesh); bm.free()',
      '',
      '# Boolean DIFFERENCE — EXACT solver, apply immediately, remove the cutter.',
      'mod = body.modifiers.new("cutout", "BOOLEAN")',
      'mod.operation = "DIFFERENCE"',
      'mod.solver = "EXACT"',
      'mod.use_self = True',
      'mod.use_hole_tolerant = True',
      'mod.object = obj',
      'bpy.context.view_layer.objects.active = body',
      'bpy.ops.object.modifier_apply(modifier="cutout")',
      'bpy.data.objects.remove(obj, do_unlink=True)',
      'result = {"thru_axis": thru_axis, "near": near, "far": far, "body_verts": len(body.data.vertices)}',
      '```',
      '',
      '## Rules',
      '- EXACT solver only. FAST fails silently.',
      '- Always apply modifiers immediately (no dangling) and remove the cutter object after.',
      '- ALWAYS check `mesh_delta.any_change` and `mesh_delta.changed[<body_name>]` in the returned result. If the body\'s vert count is unchanged, the cut did not land — retry with different geometry.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string', description: 'The worker mesh id this op targets (e.g. "mesh_0").' },
        pythonScript: {
          type: 'string',
          description: 'bpy code. See tool description for available namespace + example.',
        },
      },
      required: ['meshId', 'pythonScript'],
    },
  },
  {
    name: 'render_preview',
    description: 'Render the current mesh from a named camera angle. Use after any geometry change to verify visually.',
    input_schema: {
      type: 'object',
      properties: {
        cameraPreset: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'current'] },
        style: { type: 'string', enum: ['solid_engineering', 'placeholder_overlay'] },
        showAxes: { type: 'boolean' },
        orthographic: { type: 'boolean' },
      },
      required: ['cameraPreset'],
    },
  },
  {
    name: 'measure',
    description: [
      'Verify geometry numerically. Pick `kind`:',
      '- distance_between_points — straight-line mm between two clicked points. Needs fromPointId + toPointId.',
      '- raycast_hit — does a ray from a point hit the body? Needs fromPointId (optional direction; defaults to the point surface normal).',
      '- void_along_normal — depth of the cavity under a point along its inward normal. Needs fromPointId. Use this after a drill/pocket to confirm the hole reached the intended depth.',
      '- min_wall_thickness — thinnest wall of a mesh in mm (optional meshId, defaults to active).',
      '- bbox_dims — bounding-box dimensions in mm (optional meshId, defaults to active).',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'distance_between_points',
            'raycast_hit',
            'void_along_normal',
            'min_wall_thickness',
            'bbox_dims',
          ],
        },
        fromPointId: { type: 'string', description: 'Clicked point id (e.g. "pt_abc"). Required for distance/raycast/void kinds.' },
        toPointId: { type: 'string', description: 'Second clicked point id, for distance_between_points.' },
        direction: { ...VEC3, description: 'Optional ray direction for raycast_hit (defaults to the point surface normal).' },
        expectedVoidMm: { type: 'number', description: 'Optional expected cavity depth for void_along_normal — compare against the measured value.' },
        meshId: { type: 'string', description: 'Optional target mesh for min_wall_thickness / bbox_dims. Defaults to the active mesh.' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'commit_state',
    description: 'Mark the current mesh as user-approved. Call ONLY when the user confirms ("looks good", "yes", "that\'s it").',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
  },
  // ---------------------------------------------------------------------
  // Blender-MCP-equivalent introspection + manipulation. These give the
  // agent the same toolbox as the standalone Blender MCP: see what's in
  // the scene, drill into one object, raycast, spawn primitives, etc.
  // ---------------------------------------------------------------------
  {
    name: 'inspect_scene',
    description:
      'List every object in the current Blender scene with type, location, dimensions, and tri count. Also returns the active mesh_id and a mapping from worker mesh_id → Blender object name. Use this FIRST when you need to know what\'s in the scene.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'inspect_object',
    description:
      'Detailed inspection of a single object. Returns: name, type, location, rotation_euler_deg, scale, dimensions, parent, children, modifiers (list of {name, type}), materials, and for meshes also {verts, edges, faces, tri_count, world_bbox, is_watertight, vertex_groups, shape_keys}. Pass the worker mesh_id (e.g. "mesh_0") or a direct Blender object name.',
    input_schema: {
      type: 'object',
      properties: {
        nameOrId: { type: 'string', description: 'Mesh id like "mesh_0" or a raw Blender object name.' },
      },
      required: ['nameOrId'],
    },
  },
  {
    name: 'raycast',
    description:
      'Cast a ray in world space and return the first hit (mesh_id, world position, surface normal, face index, distance). Optionally restrict to a single mesh by passing meshId. Use this to: probe geometry, find what\'s at a viewport pixel, verify a hole goes through, sample a face normal.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        direction: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        meshId: { type: 'string', description: 'Optional — restrict to this mesh.' },
      },
      required: ['origin', 'direction'],
    },
  },
  {
    name: 'create_primitive',
    description:
      'Spawn a fresh primitive mesh at arbitrary world coords. Use for cutters, pads, mounts, or any geometry not tied to a clicked point. Returns the new mesh_id so subsequent ops can reference it. For drilling at a clicked point use add_cylinder_at_point instead.',
    input_schema: {
      type: 'object',
      properties: {
        primitive: { type: 'string', enum: ['cube', 'cylinder', 'sphere', 'cone', 'plane', 'torus'] },
        location: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'World position in mm.' },
        rotationEulerDegrees: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        size: { type: 'number', description: 'For cube / plane: edge length in mm.' },
        radius: { type: 'number', description: 'For cylinder / sphere / cone / torus (major radius).' },
        depth: { type: 'number', description: 'For cylinder / cone: height in mm.' },
        segments: { type: 'integer', description: 'For cylinder / sphere / cone: rotational segments (default 32).' },
        minorRadius: { type: 'number', description: 'For torus.' },
        label: { type: 'string' },
        kind: { type: 'string', enum: ['body', 'cutter'], description: 'Defaults to body. Set "cutter" if it will be used as a boolean cutter.' },
        meshId: { type: 'string', description: 'Optional — caller-chosen mesh id. Worker mints one if absent.' },
      },
      required: ['primitive'],
    },
  },
  {
    name: 'delete_object',
    description: 'Remove an object from the scene by mesh_id. Used to clean up cutters that were not auto-removed.',
    input_schema: {
      type: 'object',
      properties: { meshId: { type: 'string' } },
      required: ['meshId'],
    },
  },
  {
    name: 'duplicate_object',
    description:
      'Clone an object (mesh data is also copied — independent edits). Returns the new mesh_id. Useful for preserving the original before destructive edits.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        newMeshId: { type: 'string', description: 'Optional caller-chosen id for the copy.' },
      },
      required: ['meshId'],
    },
  },
  {
    name: 'set_transform',
    description: 'Set ABSOLUTE world transform (location / rotation / scale). For RELATIVE deltas use transform_mesh.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        location: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotationEulerDegrees: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      required: ['meshId'],
    },
  },
  {
    name: 'add_modifier',
    description:
      'Add a Blender modifier to a mesh without applying it. Use to stack BEVEL, SOLIDIFY, MIRROR, SUBSURF, BOOLEAN, etc. with named settings. For booleans on existing meshes prefer the high-level boolean_diff / boolean_union tools. Returns the modifier_name to pass to apply_modifier later.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        modifierType: { type: 'string', description: 'e.g. "BEVEL", "SOLIDIFY", "MIRROR", "SUBSURF", "BOOLEAN", "ARRAY".' },
        modifierName: { type: 'string', description: 'Optional name; defaults to lowercase type.' },
        settings: { type: 'object', description: 'Modifier-specific attributes. For BOOLEAN.object pass another mesh_id.' },
      },
      required: ['meshId', 'modifierType'],
    },
  },
  {
    name: 'apply_modifier',
    description: 'Apply a named modifier (or all modifiers if name omitted) on a mesh. Reports tri_count before/after.',
    input_schema: {
      type: 'object',
      properties: {
        meshId: { type: 'string' },
        modifierName: { type: 'string', description: 'If omitted, applies ALL modifiers in stack order.' },
      },
      required: ['meshId'],
    },
  },
  {
    name: 'join_objects',
    description: 'Merge multiple mesh objects into the first one. The first mesh_id is the survivor; the rest are absorbed and their ids freed.',
    input_schema: {
      type: 'object',
      properties: {
        meshIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
      },
      required: ['meshIds'],
    },
  },
];

// EDGE_REGION ended up unused once we constrained edgeIndices to int[] for the
// schema validator. The "all" literal is reachable via apply_raw_bpy if needed.
void EDGE_REGION;
