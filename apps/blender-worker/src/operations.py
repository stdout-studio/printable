"""Named-operation DSL implementations.

This module is *imported by* ``blender_script.py`` which runs inside Blender's
embedded Python. Importing it at the FastAPI side will fail (no ``bpy``).

Every mutation function must:

  1. Snapshot pre-state for diff reporting.
  2. Validate args.
  3. Execute (defaulting to ``solver='EXACT'``, ``use_self=True``,
     ``use_hole_tolerant=True`` for booleans — memory-mandated).
  4. Verify via raycast / measure — never trust the modifier success flag.
  5. Return ``{ok, diff_summary, warnings}``.

The session state (active body, points, object kinds) is held in a ``SessionCtx``
that the blender_script wires up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ``bpy`` only exists inside Blender's embedded Python. The script's ``EXEC_NAMESPACE``
# injects it for us; here we late-import in each function so unit-importing the module
# from the host process for typecheck doesn't fail.


# ---- FDM tolerance presets -------------------------------------------------

FDM_TOLERANCE = {
    "press": 0.0,
    "clearance": 0.15,  # mm per side
    "free": 0.3,
}


# ---- Session context ------------------------------------------------------


@dataclass
class SessionCtx:
    """In-Blender session bookkeeping. Kept here so blender_script stays small."""

    session_id: str
    session_dir: str
    active_mesh_id: str | None = None
    # mesh_id -> bpy object name
    object_by_id: dict[str, str] = field(default_factory=dict)
    # mesh_id -> "body" | "cutter" | "placeholder"
    object_kind: dict[str, str] = field(default_factory=dict)
    # point_id -> {world_position, surface_normal, mesh_id}
    points: dict[str, dict[str, Any]] = field(default_factory=dict)

    def resolve(self, mesh_id: str):
        import bpy  # type: ignore[import-not-found]

        name = self.object_by_id.get(mesh_id)
        if not name:
            raise KeyError(f"unknown mesh_id: {mesh_id}")
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise KeyError(f"object {name!r} not in scene")
        return obj


# ---- Helpers --------------------------------------------------------------


def _bbox(obj) -> dict[str, list[float]]:
    """World-space AABB of one object."""
    from mathutils import Vector  # type: ignore[import-not-found]

    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
    }


def _tri_count(obj) -> int:
    if obj.type != "MESH":
        return 0
    me = obj.data
    # Triangulate-on-the-fly count: sum of (loop_count - 2) per polygon
    return sum(max(0, p.loop_total - 2) for p in me.polygons)


def _volume_mm3(obj) -> float:
    import bmesh  # type: ignore[import-not-found]

    if obj.type != "MESH":
        return 0.0
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        return bm.calc_volume(signed=False)
    finally:
        bm.free()


def _is_watertight(obj) -> bool:
    """Cheap check: every non-boundary edge has exactly two link faces."""
    import bmesh  # type: ignore[import-not-found]

    if obj.type != "MESH":
        return False
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        for e in bm.edges:
            if len(e.link_faces) != 2:
                return False
        return True
    finally:
        bm.free()


def _diff_summary(obj, before: dict[str, Any]) -> dict[str, Any]:
    return {
        "tri_count_before": before["tri_count"],
        "tri_count_after": _tri_count(obj),
        "bbox_before": before["bbox"],
        "bbox_after": _bbox(obj),
        "volume_change_mm3": _volume_mm3(obj) - before["volume_mm3"],
        "is_watertight": _is_watertight(obj),
    }


def _snapshot_pre(obj) -> dict[str, Any]:
    return {
        "tri_count": _tri_count(obj),
        "bbox": _bbox(obj),
        "volume_mm3": _volume_mm3(obj),
    }


def _apply_modifier(target, modifier_name: str) -> None:
    """Apply a modifier on ``target``, ignoring the OPERATOR ``RETURN`` flag.

    Per memory: Blender's FAST solver returns FINISHED even on a silent miss. We
    apply the modifier and verify the result downstream via raycast/measure.
    """
    import bpy  # type: ignore[import-not-found]

    # Make sure target is active and selected for modifier_apply
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=modifier_name)


def _verify_raycast(target, origin, direction) -> dict[str, Any]:
    """Raycast in target's local space. Returns hit/distance."""
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = target.evaluated_get(depsgraph)

    # Convert world ray to object-local
    inv = target.matrix_world.inverted()
    local_origin = inv @ Vector(origin)
    local_dir = (inv.to_3x3() @ Vector(direction)).normalized()

    hit, loc, normal, idx = eval_obj.ray_cast(local_origin, local_dir)
    world_loc = (target.matrix_world @ loc) if hit else None
    return {
        "hit": bool(hit),
        "world_loc": list(world_loc) if world_loc else None,
        "face_index": idx if hit else None,
    }


# ---- Booleans -------------------------------------------------------------


def boolean_difference(
    ctx: SessionCtx,
    target_mesh_id: str,
    cutter_object_id: str,
    *,
    solver: str = "EXACT",
    use_self: bool = True,
    use_hole_tolerant: bool = True,
    fdm_tolerance_mm: float = 0.0,
    keep_cutter: bool = False,
) -> dict[str, Any]:
    import bpy  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    cutter = ctx.resolve(cutter_object_id)
    warnings: list[str] = []
    pre = _snapshot_pre(target)

    # FDM tolerance: scale cutter uniformly to grow by tolerance (mm/side).
    # We scale rather than mesh-offset to keep the cutter editable.
    if fdm_tolerance_mm:
        # Scale around the cutter's bound-box center.
        bb = _bbox(cutter)
        dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
        sx = (dims[0] + 2 * fdm_tolerance_mm) / dims[0] if dims[0] else 1.0
        sy = (dims[1] + 2 * fdm_tolerance_mm) / dims[1] if dims[1] else 1.0
        sz = (dims[2] + 2 * fdm_tolerance_mm) / dims[2] if dims[2] else 1.0
        cutter.scale.x *= sx
        cutter.scale.y *= sy
        cutter.scale.z *= sz
        bpy.context.view_layer.update()

    mod = target.modifiers.new(name="printable_diff", type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = solver
    mod.use_self = use_self
    mod.use_hole_tolerant = use_hole_tolerant
    mod.object = cutter

    _apply_modifier(target, mod.name)

    if not keep_cutter:
        bpy.data.objects.remove(cutter, do_unlink=True)
        ctx.object_by_id.pop(cutter_object_id, None)
        ctx.object_kind.pop(cutter_object_id, None)

    diff = _diff_summary(target, pre)
    # Verification: tri count should have changed AND volume should have decreased.
    if diff["tri_count_after"] == diff["tri_count_before"]:
        warnings.append(
            "boolean_difference: triangle count unchanged — cutter may have missed the body"
        )
    if diff["volume_change_mm3"] >= 0:
        warnings.append("boolean_difference: volume did not decrease — cut likely failed")
    if not diff["is_watertight"]:
        warnings.append("boolean_difference: result is not watertight")
    return {"ok": True, "diff_summary": diff, "warnings": warnings, "mesh_id": target_mesh_id}


def boolean_union(
    ctx: SessionCtx,
    target_mesh_id: str,
    other_object_id: str,
    *,
    solver: str = "EXACT",
    use_self: bool = True,
    use_hole_tolerant: bool = True,
    keep_other: bool = False,
) -> dict[str, Any]:
    import bpy  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    other = ctx.resolve(other_object_id)
    warnings: list[str] = []
    pre = _snapshot_pre(target)

    mod = target.modifiers.new(name="printable_union", type="BOOLEAN")
    mod.operation = "UNION"
    mod.solver = solver
    mod.use_self = use_self
    mod.use_hole_tolerant = use_hole_tolerant
    mod.object = other

    _apply_modifier(target, mod.name)

    if not keep_other:
        bpy.data.objects.remove(other, do_unlink=True)
        ctx.object_by_id.pop(other_object_id, None)
        ctx.object_kind.pop(other_object_id, None)

    diff = _diff_summary(target, pre)
    if diff["volume_change_mm3"] <= 0:
        warnings.append("boolean_union: volume did not increase — union likely missed")
    if not diff["is_watertight"]:
        warnings.append("boolean_union: result is not watertight")
    return {"ok": True, "diff_summary": diff, "warnings": warnings, "mesh_id": target_mesh_id}


# ---- Add-at-point ---------------------------------------------------------


def _make_cylinder(
    name: str, radius: float, height: float, location, rotation_quat=None
):
    import bmesh  # type: ignore[import-not-found]
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=48,
        radius1=radius,
        radius2=radius,
        depth=height,
    )
    bm.to_mesh(mesh)
    bm.free()

    obj.location = Vector(location)
    if rotation_quat is not None:
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = rotation_quat
    return obj


def _make_box(name: str, size, location, rotation_quat=None):
    import bmesh  # type: ignore[import-not-found]
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    # Scale to size[]
    bmesh.ops.scale(bm, vec=(size[0], size[1], size[2]), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()

    obj.location = Vector(location)
    if rotation_quat is not None:
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = rotation_quat
    return obj


def _normal_to_quat(normal):
    """Return a quaternion that aligns +Z to ``normal``."""
    from mathutils import Vector  # type: ignore[import-not-found]

    z = Vector((0, 0, 1))
    n = Vector(normal).normalized()
    return z.rotation_difference(n)


def add_cylinder_at_point(
    ctx: SessionCtx,
    target_mesh_id: str,
    point_id: str,
    *,
    radius: float,
    height: float,
    along_normal: bool = True,
    operation: str = "cut",
    fit: str = "press",
) -> dict[str, Any]:
    from mathutils import Vector  # type: ignore[import-not-found]

    pt = ctx.points.get(point_id)
    if not pt:
        raise KeyError(f"unknown point_id: {point_id}")
    pos = Vector(pt["world_position"])
    normal = Vector(pt["surface_normal"]) if along_normal else Vector((0, 0, 1))
    quat = _normal_to_quat(normal) if along_normal else None

    # Place the cylinder so its center sits ON the surface, not embedded
    # — for a 'cut', center it half-into the body so it actually pierces.
    if operation in ("cut", "emboss"):
        # Sink the cylinder half its height into the body so geometry overlaps.
        center = pos - normal.normalized() * (height * 0.25)
    else:
        center = pos + normal.normalized() * (height * 0.5)

    cyl_id = f"cyl_{len(ctx.object_by_id)}"
    cyl = _make_cylinder(cyl_id, radius=radius, height=height, location=center, rotation_quat=quat)
    ctx.object_by_id[cyl_id] = cyl.name
    ctx.object_kind[cyl_id] = "placeholder" if operation == "placeholder" else "cutter"

    fdm = FDM_TOLERANCE.get(fit, 0.0)

    if operation == "cut":
        return boolean_difference(
            ctx, target_mesh_id, cyl_id, fdm_tolerance_mm=fdm, keep_cutter=False
        )
    if operation == "emboss":
        return boolean_union(ctx, target_mesh_id, cyl_id, keep_other=False)

    # placeholder: just mark and return its transform
    return {
        "ok": True,
        "diff_summary": None,
        "warnings": [],
        "mesh_id": cyl_id,
        "placeholder_id": cyl_id,
    }


def add_box_at_point(
    ctx: SessionCtx,
    target_mesh_id: str,
    point_id: str,
    *,
    size,
    align_to_normal: bool = True,
    operation: str = "cut",
) -> dict[str, Any]:
    from mathutils import Vector  # type: ignore[import-not-found]

    pt = ctx.points.get(point_id)
    if not pt:
        raise KeyError(f"unknown point_id: {point_id}")
    pos = Vector(pt["world_position"])
    normal = Vector(pt["surface_normal"]) if align_to_normal else Vector((0, 0, 1))
    quat = _normal_to_quat(normal) if align_to_normal else None
    center = pos
    if operation in ("cut", "emboss"):
        center = pos - normal.normalized() * (size[2] * 0.25)
    else:
        center = pos + normal.normalized() * (size[2] * 0.5)

    box_id = f"box_{len(ctx.object_by_id)}"
    box = _make_box(box_id, size=size, location=center, rotation_quat=quat)
    ctx.object_by_id[box_id] = box.name
    ctx.object_kind[box_id] = "placeholder" if operation == "placeholder" else "cutter"

    if operation == "cut":
        return boolean_difference(ctx, target_mesh_id, box_id)
    if operation == "emboss":
        return boolean_union(ctx, target_mesh_id, box_id)
    return {
        "ok": True,
        "diff_summary": None,
        "warnings": [],
        "mesh_id": box_id,
        "placeholder_id": box_id,
    }


# ---- Edge ops -------------------------------------------------------------


def fillet_edges(
    ctx: SessionCtx,
    target_mesh_id: str,
    *,
    region: str | list[int] = "all",
    radius: float,
) -> dict[str, Any]:
    import bmesh  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    pre = _snapshot_pre(target)

    bm = bmesh.new()
    bm.from_mesh(target.data)
    bm.edges.ensure_lookup_table()

    if region == "all":
        edges = list(bm.edges)
    else:
        edges = [bm.edges[i] for i in region if 0 <= i < len(bm.edges)]

    bmesh.ops.bevel(
        bm,
        geom=edges,
        offset=radius,
        affect="EDGES",
        segments=4,
        profile=0.5,
    )
    bm.to_mesh(target.data)
    bm.free()
    target.data.update()
    diff = _diff_summary(target, pre)
    return {"ok": True, "diff_summary": diff, "warnings": [], "mesh_id": target_mesh_id}


def chamfer_edges(
    ctx: SessionCtx,
    target_mesh_id: str,
    *,
    region: str | list[int] = "all",
    width: float,
) -> dict[str, Any]:
    import bmesh  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    pre = _snapshot_pre(target)
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bm.edges.ensure_lookup_table()
    edges = list(bm.edges) if region == "all" else [bm.edges[i] for i in region]
    bmesh.ops.bevel(
        bm, geom=edges, offset=width, affect="EDGES", segments=1, profile=0.5
    )
    bm.to_mesh(target.data)
    bm.free()
    target.data.update()
    return {
        "ok": True,
        "diff_summary": _diff_summary(target, pre),
        "warnings": [],
        "mesh_id": target_mesh_id,
    }


def extrude_region(
    ctx: SessionCtx,
    target_mesh_id: str,
    *,
    face_indices: list[int],
    distance: float,
) -> dict[str, Any]:
    import bmesh  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    pre = _snapshot_pre(target)
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bm.faces.ensure_lookup_table()
    faces = [bm.faces[i] for i in face_indices if 0 <= i < len(bm.faces)]
    if not faces:
        bm.free()
        return {
            "ok": False,
            "diff_summary": None,
            "warnings": ["extrude_region: no faces resolved"],
            "mesh_id": target_mesh_id,
        }
    normal = sum((f.normal for f in faces), Vector((0, 0, 0)))
    if normal.length:
        normal.normalize()
    else:
        normal = Vector((0, 0, 1))

    ret = bmesh.ops.extrude_face_region(bm, geom=faces)
    new_verts = [el for el in ret["geom"] if isinstance(el, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=normal * distance, verts=new_verts)
    bm.to_mesh(target.data)
    bm.free()
    target.data.update()
    return {
        "ok": True,
        "diff_summary": _diff_summary(target, pre),
        "warnings": [],
        "mesh_id": target_mesh_id,
    }


# ---- Verify ---------------------------------------------------------------


def verify(
    ctx: SessionCtx,
    target_mesh_id: str,
    *,
    checks: list[str] | None = None,
    min_wall_mm: float = 1.0,
) -> dict[str, Any]:
    target = ctx.resolve(target_mesh_id)
    checks = checks or ["manifold"]
    result: dict[str, Any] = {}
    warnings: list[str] = []
    if "manifold" in checks:
        ok = _is_watertight(target)
        result["manifold"] = ok
        if not ok:
            warnings.append("verify: mesh is not manifold/watertight")
    if "min_wall_mm" in checks:
        # Rough proxy: smallest bbox dim. A real impl needs medial-axis analysis.
        bb = _bbox(target)
        dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
        thinnest = min(dims)
        result["min_wall_mm"] = thinnest
        if thinnest < min_wall_mm:
            warnings.append(f"verify: min wall {thinnest:.2f}mm < required {min_wall_mm}mm")
    if "raycast_hit" in checks:
        bb = _bbox(target)
        center = [(bb["max"][i] + bb["min"][i]) / 2 for i in range(3)]
        origin = [center[0], center[1], bb["max"][2] + 10]
        rc = _verify_raycast(target, origin, [0, 0, -1])
        result["raycast_hit"] = rc["hit"]
        if not rc["hit"]:
            warnings.append("verify: raycast from above missed the body")
    return {
        "ok": not warnings,
        "result": result,
        "warnings": warnings,
        "mesh_id": target_mesh_id,
    }


# ---- Transform ------------------------------------------------------------


def transform_mesh(
    ctx: SessionCtx,
    target_mesh_id: str,
    *,
    translate=None,
    rotate_euler_deg=None,
    scale=None,
    absolute: bool = False,
) -> dict[str, Any]:
    import math

    from mathutils import Euler, Vector  # type: ignore[import-not-found]

    target = ctx.resolve(target_mesh_id)
    if absolute:
        if translate is not None:
            target.location = Vector(translate)
        if rotate_euler_deg is not None:
            target.rotation_mode = "XYZ"
            target.rotation_euler = Euler([math.radians(a) for a in rotate_euler_deg], "XYZ")
        if scale is not None:
            target.scale = Vector(scale)
    else:
        if translate is not None:
            target.location += Vector(translate)
        if rotate_euler_deg is not None:
            target.rotation_mode = "XYZ"
            target.rotation_euler.x += math.radians(rotate_euler_deg[0])
            target.rotation_euler.y += math.radians(rotate_euler_deg[1])
            target.rotation_euler.z += math.radians(rotate_euler_deg[2])
        if scale is not None:
            target.scale.x *= scale[0]
            target.scale.y *= scale[1]
            target.scale.z *= scale[2]

    import bpy  # type: ignore[import-not-found]

    bpy.context.view_layer.update()
    return {
        "ok": True,
        "transform": {
            "translate": list(target.location),
            "rotate_euler_deg": [math.degrees(a) for a in target.rotation_euler],
            "scale": list(target.scale),
        },
    }
