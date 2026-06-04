"""Long-lived script that runs *inside* Blender's embedded Python.

Launched by ``blender_process.py`` via::

    blender --background --python blender_script.py -- --session-id=<id> --session-dir=<path>

Reads one JSON-RPC request per line from ``stdin``, writes one JSON response per
line to ``stdout``. Everything else (logging, Blender chatter) is muted to
``stderr`` to keep the channel clean.

Protocol::

    > {"id": "...", "method": "name", "params": {...}}
    < {"id": "...", "ok": true,  "result": {...}}
    < {"id": "...", "ok": false, "error": "..."}

Methods mirror the FastAPI endpoint set, minus session-lifecycle calls.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import sys
import traceback
from pathlib import Path

# Make sure the worker package is importable inside Blender.
_THIS = Path(__file__).resolve()
_SRC_DIR = _THIS.parent
if str(_SRC_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR.parent))

# Inside Blender these imports succeed; outside they fail (caller never imports this file).
from datetime import UTC

import bmesh  # type: ignore[import-not-found]  # noqa: E402
import bpy  # type: ignore[import-not-found]  # noqa: E402
from mathutils import Vector  # type: ignore[import-not-found]  # noqa: E402

from src import operations as ops  # noqa: E402
from src import render as render_mod  # noqa: E402
from src.safety import UnsafeCodeError  # noqa: E402
from src.safety import validate as ast_validate

# ---- Stdout discipline -----------------------------------------------------
# Blender writes a lot to stdout. We redirect Blender's chatter to stderr and
# reserve stdout strictly for JSON-RPC. ``log()`` routes diagnostics to stderr.

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr  # everything that's not an explicit RPC write goes to stderr


def log(msg: str) -> None:
    print(f"[worker] {msg}", file=sys.stderr, flush=True)


def write_response(payload: dict) -> None:
    line = json.dumps(payload, default=str)
    _REAL_STDOUT.write(line + "\n")
    _REAL_STDOUT.flush()


# ---- Session context -------------------------------------------------------


def make_ctx(session_id: str, session_dir: Path) -> ops.SessionCtx:
    return ops.SessionCtx(session_id=session_id, session_dir=str(session_dir))


# ---- Scene helpers ---------------------------------------------------------


def _purge_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _save_blend(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path), copy=False, compress=True)


def _load_blend(path: Path) -> None:
    bpy.ops.wm.open_mainfile(filepath=str(path))


# ---- Method handlers -------------------------------------------------------


def h_ping(ctx, params):
    return {"pong": True, "session_id": ctx.session_id}


def h_purge_scene(ctx, params):
    _purge_scene()
    ctx.object_by_id.clear()
    ctx.object_kind.clear()
    ctx.points.clear()
    ctx.active_mesh_id = None
    return {"ok": True}


def h_import_mesh(ctx, params):
    """params = { stl_base64?: str, stl_path?: str, label?, set_active?: bool, mesh_id: str }"""
    mesh_id = params["mesh_id"]
    label = params.get("label") or mesh_id
    set_active = params.get("set_active", True)

    # Resolve the STL bytes to a file Blender's importer can consume.
    stl_path: Path
    if "stl_path" in params and params["stl_path"]:
        stl_path = Path(params["stl_path"])
    elif "stl_base64" in params and params["stl_base64"]:
        # Write to a tmp file then import.
        tmp_dir = Path(ctx.session_dir) / "meshes"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        stl_path = tmp_dir / f"{mesh_id}.stl"
        stl_path.write_bytes(base64.b64decode(params["stl_base64"]))
    else:
        raise ValueError("import_mesh requires stl_path or stl_base64")

    existing_names = set(bpy.data.objects.keys())
    # Blender 4.x: bpy.ops.wm.stl_import; older: import_mesh.stl
    try:
        bpy.ops.wm.stl_import(filepath=str(stl_path))
    except AttributeError:
        bpy.ops.import_mesh.stl(filepath=str(stl_path))

    new_objs = [o for n, o in bpy.data.objects.items() if n not in existing_names]
    if not new_objs:
        raise RuntimeError("STL import produced no objects")
    # If multiple, join them into one
    if len(new_objs) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in new_objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = new_objs[0]
        bpy.ops.object.join()
        new_objs = [new_objs[0]]
    obj = new_objs[0]
    obj.name = mesh_id
    obj.data.name = f"{mesh_id}_mesh"
    ctx.object_by_id[mesh_id] = obj.name
    ctx.object_kind[mesh_id] = "body"
    if set_active:
        ctx.active_mesh_id = mesh_id

    bb = ops._bbox(obj)
    dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
    return {
        "mesh_id": mesh_id,
        "label": label,
        "bbox": bb,
        "dims_mm": dims,
        "tri_count": ops._tri_count(obj),
        "is_watertight": ops._is_watertight(obj),
        "warnings": [],
    }


def h_apply_operation(ctx, params):
    op = params["op"]
    op_type = op["type"]
    mesh_id = op.get("mesh_id") or ctx.active_mesh_id
    if not mesh_id:
        raise ValueError("op missing mesh_id and no active mesh")

    if op_type == "boolean_diff":
        return ops.boolean_difference(
            ctx,
            mesh_id,
            op["cutter_mesh_id"],
            solver=op.get("solver", "EXACT"),
            use_self=op.get("use_self", True),
            use_hole_tolerant=op.get("use_hole_tolerant", True),
            fdm_tolerance_mm=op.get("fdm_tolerance_mm", 0.0),
            keep_cutter=op.get("keep_cutter", False),
        )
    if op_type == "boolean_union":
        return ops.boolean_union(
            ctx,
            mesh_id,
            op["other_mesh_id"],
            solver=op.get("solver", "EXACT"),
            use_self=op.get("use_self", True),
            use_hole_tolerant=op.get("use_hole_tolerant", True),
            keep_other=op.get("keep_other", False),
        )
    if op_type == "add_cylinder_at_point":
        return ops.add_cylinder_at_point(
            ctx,
            mesh_id,
            op["point_id"],
            radius=op["radius"],
            height=op["height"],
            along_normal=op.get("along_normal", True),
            operation=op.get("operation", "cut"),
            fit=op.get("fit", "press"),
        )
    if op_type == "add_box_at_point":
        return ops.add_box_at_point(
            ctx,
            mesh_id,
            op["point_id"],
            size=op["size"],
            align_to_normal=op.get("align_to_normal", True),
            operation=op.get("operation", "cut"),
        )
    if op_type == "fillet_edges":
        return ops.fillet_edges(
            ctx, mesh_id, region=op.get("edge_indices", "all"), radius=op["radius"]
        )
    if op_type == "chamfer_edges":
        return ops.chamfer_edges(
            ctx, mesh_id, region=op.get("edge_indices", "all"), width=op["width"]
        )
    if op_type == "extrude_faces":
        return ops.extrude_region(
            ctx, mesh_id, face_indices=op["face_indices"], distance=op["distance"]
        )
    if op_type == "transform_mesh":
        return ops.transform_mesh(
            ctx,
            mesh_id,
            translate=op.get("translate"),
            rotate_euler_deg=op.get("rotate_euler_degrees"),
            scale=op.get("scale"),
            absolute=op.get("absolute", False),
        )
    if op_type == "verify":
        return ops.verify(
            ctx,
            mesh_id,
            checks=op.get("checks", ["manifold"]),
            min_wall_mm=op.get("min_wall_mm", 1.0),
        )
    if op_type == "raw_bpy":
        # Snapshot the TARGET mesh's tri count + bbox before/after the script
        # runs, then surface it via the existing diff_summary field so the
        # agent can tell whether the boolean actually landed.
        target_name = ctx.object_by_id.get(mesh_id) if mesh_id else None
        before_diff = _mesh_diff_snapshot(target_name)
        before_stats = _mesh_stats_snapshot()
        out = _exec_bpy_code(ctx, op["python_script"])
        after_diff = _mesh_diff_snapshot(target_name)
        after_stats = _mesh_stats_snapshot()
        out["mesh_delta"] = _diff_mesh_stats(before_stats, after_stats)
        # Wrap before/after into a diff_summary FastAPI can return on the
        # standard response. `volume_change_mm3` here is bbox-volume delta — a
        # cheap proxy for "did anything happen" (not real solid volume).
        vb = _bbox_volume(before_diff["bbox"])
        va = _bbox_volume(after_diff["bbox"])
        out["diff_summary"] = {
            "tri_count_before": before_diff["tri_count"],
            "tri_count_after": after_diff["tri_count"],
            "bbox_before": before_diff["bbox"],
            "bbox_after": after_diff["bbox"],
            "volume_change_mm3": va - vb,
            "is_watertight": after_diff["is_watertight"],
        }
        out["mesh_id"] = mesh_id
        return out
    # ---- Blender-MCP-style mutation ops -----------------------------------
    if op_type == "create_primitive":
        return _op_create_primitive(ctx, op)
    if op_type == "delete_object":
        return _op_delete_object(ctx, op)
    if op_type == "duplicate_object":
        return _op_duplicate_object(ctx, op)
    if op_type == "set_transform":
        return _op_set_transform(ctx, op)
    if op_type == "add_modifier":
        return _op_add_modifier(ctx, op)
    if op_type == "apply_modifier":
        return _op_apply_modifier(ctx, op)
    if op_type == "join_objects":
        return _op_join_objects(ctx, op)
    raise ValueError(f"unknown op type: {op_type}")


def _mesh_diff_snapshot(name) -> dict:
    """Tri count + world bbox of a single named mesh object (or zeros)."""
    if name is None or name not in bpy.data.objects:
        return {
            "tri_count": 0,
            "bbox": {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]},
            "is_watertight": True,
        }
    obj = bpy.data.objects[name]
    if obj.type != "MESH" or obj.data is None:
        return {
            "tri_count": 0,
            "bbox": {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]},
            "is_watertight": True,
        }
    bb = ops._bbox(obj)
    tri_count = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return {
        "tri_count": tri_count,
        "bbox": bb,
        "is_watertight": ops._is_watertight(obj),
    }


def _bbox_volume(bb: dict) -> float:
    mn, mx = bb["min"], bb["max"]
    return max(0.0, (mx[0] - mn[0]) * (mx[1] - mn[1]) * (mx[2] - mn[2]))


# ---- Blender-MCP-equivalent ops: inspection ---------------------------------


def _object_summary(obj) -> dict:
    """High-level summary of any Blender object (mesh or otherwise)."""
    summary = {
        "name": obj.name,
        "type": obj.type,
        "visible": obj.visible_get(),
        "location": list(obj.location),
        "rotation_euler_deg": [math.degrees(a) for a in obj.rotation_euler],
        "scale": list(obj.scale),
        "dimensions": list(obj.dimensions),
        "parent": obj.parent.name if obj.parent else None,
        "children": [c.name for c in obj.children],
        "modifiers": [
            {"name": m.name, "type": m.type, "show_viewport": m.show_viewport}
            for m in obj.modifiers
        ],
        "materials": [s.material.name for s in obj.material_slots if s.material],
    }
    if obj.type == "MESH" and obj.data is not None:
        bb = ops._bbox(obj)
        summary["mesh"] = {
            "verts": len(obj.data.vertices),
            "edges": len(obj.data.edges),
            "faces": len(obj.data.polygons),
            "tri_count": sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons),
            "world_bbox": bb,
            "is_watertight": ops._is_watertight(obj),
            "vertex_groups": [vg.name for vg in obj.vertex_groups],
            "shape_keys": (
                [k.name for k in obj.data.shape_keys.key_blocks]
                if obj.data.shape_keys
                else []
            ),
        }
    # Reverse-lookup the worker mesh_id if this object has one.
    summary["mesh_id"] = next(
        (mid for mid, n in obj.users_collection[0].objects.items() if n is obj and False), None
    )
    return summary


def _scene_summary(ctx) -> dict:
    """Lightweight scene listing: every object with the essentials."""
    objects = []
    for obj in bpy.data.objects:
        objects.append({
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "dimensions": list(obj.dimensions),
            "tri_count": (
                sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)
                if obj.type == "MESH" and obj.data
                else 0
            ),
        })
    # Map worker mesh_ids → object names so the agent can join them up.
    mesh_id_index = {mid: name for mid, name in ctx.object_by_id.items()}
    return {
        "objects": objects,
        "object_count": len(objects),
        "active_mesh_id": ctx.active_mesh_id,
        "mesh_id_to_name": mesh_id_index,
    }


def _object_info(ctx, name_or_id: str) -> dict:
    """Resolve a mesh_id OR a direct Blender object name, return full info."""
    name = ctx.object_by_id.get(name_or_id, name_or_id)
    if name not in bpy.data.objects:
        raise ValueError(f"no object named '{name}' (also tried as mesh_id)")
    return _object_summary(bpy.data.objects[name])


# ---- Blender-MCP-equivalent ops: mutation -----------------------------------


def _next_mesh_id(ctx) -> str:
    """Mint a new mesh_id slot in the session, format `mesh_N`."""
    n = 0
    while f"mesh_{n}" in ctx.object_by_id:
        n += 1
    return f"mesh_{n}"


def _register_object(ctx, obj, mesh_id: str, kind: str = "body", label: str = None) -> None:
    """Add a Blender object to the session's mesh_id index."""
    obj.name = mesh_id
    if obj.data is not None and obj.type == "MESH":
        obj.data.name = f"{mesh_id}_mesh"
    ctx.object_by_id[mesh_id] = obj.name
    ctx.object_kind[mesh_id] = kind


def _op_create_primitive(ctx, op: dict) -> dict:
    """Spawn a cube/cylinder/sphere/cone/torus/plane at world coords.

    Equivalent to Blender's bpy.ops.mesh.primitive_*_add. Returns the new
    mesh_id so the agent can reference it in subsequent ops.
    """
    kind = op["primitive"]   # "cube" | "cylinder" | "sphere" | "cone" | "plane" | "torus"
    location = op.get("location", [0.0, 0.0, 0.0])
    rotation = op.get("rotation_euler_degrees", [0.0, 0.0, 0.0])
    size = op.get("size", 1.0)   # used for cube/plane
    radius = op.get("radius", 1.0)
    depth = op.get("depth", 2.0)
    segments = op.get("segments", 32)
    label = op.get("label")

    existing = set(bpy.data.objects.keys())
    rot_rad = [math.radians(a) for a in rotation]
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=size, location=location, rotation=rot_rad)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=segments, radius=radius, depth=depth,
            location=location, rotation=rot_rad,
        )
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=segments, radius=radius,
            location=location, rotation=rot_rad,
        )
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(
            vertices=segments, radius1=radius, depth=depth,
            location=location, rotation=rot_rad,
        )
    elif kind == "plane":
        bpy.ops.mesh.primitive_plane_add(size=size, location=location, rotation=rot_rad)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=radius, minor_radius=op.get("minor_radius", radius * 0.25),
            location=location, rotation=rot_rad,
        )
    else:
        raise ValueError(f"unknown primitive: {kind}")

    new_obj = next(o for n, o in bpy.data.objects.items() if n not in existing)
    new_id = op.get("mesh_id") or _next_mesh_id(ctx)
    _register_object(ctx, new_obj, new_id, kind="cutter" if op.get("kind") == "cutter" else "body")

    bb = ops._bbox(new_obj)
    dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
    return {
        "mesh_id": new_id,
        "object_name": new_obj.name,
        "primitive": kind,
        "bbox": bb,
        "dims_mm": dims,
        "diff_summary": {
            "tri_count_before": 0,
            "tri_count_after": sum(max(0, len(p.vertices) - 2) for p in new_obj.data.polygons),
            "bbox_before": {"min": [0, 0, 0], "max": [0, 0, 0]},
            "bbox_after": bb,
            "volume_change_mm3": _bbox_volume(bb),
            "is_watertight": ops._is_watertight(new_obj),
        },
    }


def _op_delete_object(ctx, op: dict) -> dict:
    target_id = op.get("mesh_id") or ctx.active_mesh_id
    name = ctx.object_by_id.get(target_id)
    if not name or name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{target_id}'")
    bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    ctx.object_by_id.pop(target_id, None)
    ctx.object_kind.pop(target_id, None)
    if ctx.active_mesh_id == target_id:
        # Pick another mesh as active if any exists.
        remaining = list(ctx.object_by_id.keys())
        ctx.active_mesh_id = remaining[0] if remaining else None
    return {"mesh_id": target_id, "deleted": True}


def _op_duplicate_object(ctx, op: dict) -> dict:
    src_id = op["mesh_id"]
    src_name = ctx.object_by_id.get(src_id)
    if not src_name or src_name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{src_id}'")
    src = bpy.data.objects[src_name]
    copy = src.copy()
    if src.data is not None:
        copy.data = src.data.copy()
    bpy.context.scene.collection.objects.link(copy)
    new_id = op.get("new_mesh_id") or _next_mesh_id(ctx)
    _register_object(ctx, copy, new_id, kind=ctx.object_kind.get(src_id, "body"))
    return {"mesh_id": new_id, "source_mesh_id": src_id, "object_name": copy.name}


def _op_set_transform(ctx, op: dict) -> dict:
    """Set ABSOLUTE world transform. For relative deltas use transform_mesh."""
    name = ctx.object_by_id.get(op["mesh_id"])
    if not name or name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{op['mesh_id']}'")
    obj = bpy.data.objects[name]
    if "location" in op:
        obj.location = op["location"]
    if "rotation_euler_degrees" in op:
        obj.rotation_euler = [math.radians(a) for a in op["rotation_euler_degrees"]]
    if "scale" in op:
        obj.scale = op["scale"]
    bpy.context.view_layer.update()
    return {
        "mesh_id": op["mesh_id"],
        "location": list(obj.location),
        "rotation_euler_deg": [math.degrees(a) for a in obj.rotation_euler],
        "scale": list(obj.scale),
    }


def _op_add_modifier(ctx, op: dict) -> dict:
    """Add a modifier (BOOLEAN / BEVEL / SOLIDIFY / MIRROR / SUBSURF / etc.)
    without applying. Returns the modifier name so the agent can apply later."""
    name = ctx.object_by_id.get(op["mesh_id"])
    if not name or name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{op['mesh_id']}'")
    target = bpy.data.objects[name]
    mod_type = op["modifier_type"]   # "BOOLEAN" | "BEVEL" | "SOLIDIFY" | "MIRROR" | "SUBSURF" | ...
    mod_name = op.get("modifier_name", mod_type.lower())
    mod = target.modifiers.new(name=mod_name, type=mod_type)
    # Apply any settings the caller passed in.
    for k, v in (op.get("settings") or {}).items():
        if k == "object" and isinstance(v, str):
            # Resolve cutter mesh_id to actual Blender object.
            ref_name = ctx.object_by_id.get(v, v)
            if ref_name in bpy.data.objects:
                setattr(mod, k, bpy.data.objects[ref_name])
            continue
        try:
            setattr(mod, k, v)
        except (AttributeError, TypeError) as e:
            return {"error": f"could not set {k}={v!r} on {mod_type}: {e}"}
    return {
        "mesh_id": op["mesh_id"],
        "modifier_name": mod.name,
        "modifier_type": mod.type,
    }


def _op_apply_modifier(ctx, op: dict) -> dict:
    """Apply a named modifier (or all modifiers) on the target."""
    name = ctx.object_by_id.get(op["mesh_id"])
    if not name or name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{op['mesh_id']}'")
    target = bpy.data.objects[name]
    before = sum(max(0, len(p.vertices) - 2) for p in target.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    if "modifier_name" in op:
        bpy.ops.object.modifier_apply(modifier=op["modifier_name"])
    else:
        # Apply all in order.
        for m in list(target.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    after = sum(max(0, len(p.vertices) - 2) for p in target.data.polygons)
    return {
        "mesh_id": op["mesh_id"],
        "tri_count_before": before,
        "tri_count_after": after,
        "diff_summary": {
            "tri_count_before": before,
            "tri_count_after": after,
            "bbox_before": ops._bbox(target),
            "bbox_after": ops._bbox(target),
            "volume_change_mm3": 0.0,
            "is_watertight": ops._is_watertight(target),
        },
    }


def _op_join_objects(ctx, op: dict) -> dict:
    """Merge multiple meshes into one. First id is the target; rest are merged in."""
    ids = op["mesh_ids"]
    if len(ids) < 2:
        raise ValueError("join_objects needs at least 2 mesh_ids")
    target_name = ctx.object_by_id.get(ids[0])
    if not target_name or target_name not in bpy.data.objects:
        raise ValueError(f"no object for mesh_id '{ids[0]}'")
    target = bpy.data.objects[target_name]
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    for mid in ids[1:]:
        nm = ctx.object_by_id.get(mid)
        if nm and nm in bpy.data.objects:
            bpy.data.objects[nm].select_set(True)
    bpy.ops.object.join()
    # The joined-in mesh_ids no longer exist.
    for mid in ids[1:]:
        ctx.object_by_id.pop(mid, None)
        ctx.object_kind.pop(mid, None)
    return {
        "mesh_id": ids[0],
        "merged_ids": ids[1:],
        "tri_count": sum(max(0, len(p.vertices) - 2) for p in target.data.polygons),
    }


# ---- Raycast / inspection ---------------------------------------------------


def _raycast_world(ctx, origin, direction, mesh_id=None) -> dict:
    """Cast a ray in world space against a single mesh or the whole scene."""
    from mathutils import Vector  # type: ignore[import-not-found]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    o = Vector(origin)
    d = Vector(direction).normalized()
    if mesh_id:
        name = ctx.object_by_id.get(mesh_id, mesh_id)
        if name not in bpy.data.objects:
            return {"hit": False}
        obj = bpy.data.objects[name].evaluated_get(depsgraph)
        inv = bpy.data.objects[name].matrix_world.inverted()
        lo = inv @ o
        ld = (inv.to_3x3() @ d).normalized()
        hit, loc, normal, idx = obj.ray_cast(lo, ld)
        if not hit:
            return {"hit": False}
        wl = bpy.data.objects[name].matrix_world @ loc
        return {
            "hit": True,
            "mesh_id": mesh_id,
            "world_position": list(wl),
            "world_normal": list(normal),
            "face_index": idx,
            "distance_mm": (wl - o).length,
        }
    # Scene-wide: ask the scene for the first hit.
    hit, loc, normal, idx, obj_hit, _ = bpy.context.scene.ray_cast(depsgraph, list(o), list(d))
    if not hit:
        return {"hit": False}
    # Map back from object name to mesh_id if possible.
    mid = next((m for m, n in ctx.object_by_id.items() if n == obj_hit.name), None)
    return {
        "hit": True,
        "mesh_id": mid,
        "object_name": obj_hit.name,
        "world_position": list(loc),
        "world_normal": list(normal),
        "face_index": idx,
        "distance_mm": (Vector(loc) - o).length,
    }


def _mesh_stats_snapshot() -> dict:
    """Per-mesh-object {verts, edges, faces} for everything in the active scene."""
    stats = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data is not None:
            stats[obj.name] = {
                "verts": len(obj.data.vertices),
                "edges": len(obj.data.edges),
                "faces": len(obj.data.polygons),
            }
    return stats


def _diff_mesh_stats(before: dict, after: dict) -> dict:
    """Summarize what changed. Returns {name: {verts_before, verts_after, ...}}
    for objects that changed, plus added/removed object lists."""
    changed = {}
    added = []
    for name, st in after.items():
        if name not in before:
            added.append({"name": name, **st})
            continue
        b = before[name]
        if (st["verts"] != b["verts"]) or (st["edges"] != b["edges"]) or (st["faces"] != b["faces"]):
            changed[name] = {
                "verts": [b["verts"], st["verts"]],
                "edges": [b["edges"], st["edges"]],
                "faces": [b["faces"], st["faces"]],
            }
    removed = [{"name": n, **before[n]} for n in before if n not in after]
    any_change = bool(changed or added or removed)
    return {
        "any_change": any_change,
        "changed": changed,
        "added": added,
        "removed": removed,
    }


def h_render_preview(ctx, params):
    out = Path(ctx.session_dir) / "renders" / f"preview_{int(_now_ms())}.png"
    return render_mod.render_preview(
        ctx,
        out_path=out,
        style=params.get("style", "solid_engineering"),
        camera_preset=params.get("camera_preset"),
        camera_state=params.get("camera_state"),
        width=params.get("width", 1024),
        height=params.get("height", 1024),
        show_axes=params.get("show_axes", True),
        orthographic=params.get("orthographic", True),
        cutter_object_id=params.get("cutter_object_id"),
    )


def h_measure(ctx, params):
    kind = params["kind"]
    if kind == "bbox_dims":
        mesh_id = params.get("mesh_id") or ctx.active_mesh_id
        target = ctx.resolve(mesh_id)
        bb = ops._bbox(target)
        dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
        return {"kind": kind, "dims_mm": dims, "value_mm": max(dims)}
    if kind == "distance_between_points":
        a = ctx.points[params["from_point_id"]]
        b = ctx.points[params["to_point_id"]]
        d = (Vector(b["world_position"]) - Vector(a["world_position"])).length
        return {"kind": kind, "value_mm": d}
    if kind == "raycast_hit":
        mesh_id = params.get("mesh_id") or ctx.active_mesh_id
        target = ctx.resolve(mesh_id)
        # Origin/direction supplied by caller (defaults: from a point along its normal)
        if "from_point_id" in params and params["from_point_id"]:
            pt = ctx.points[params["from_point_id"]]
            origin = pt["world_position"]
            direction = params.get("direction") or pt["surface_normal"]
        else:
            origin = params.get("origin") or [0, 0, 100]
            direction = params.get("direction") or [0, 0, -1]
        rc = ops._verify_raycast(target, origin, direction)
        return {
            "kind": kind,
            "hit": rc["hit"],
            "hit_object_id": mesh_id if rc["hit"] else None,
            "hit_point": rc["world_loc"],
        }
    if kind == "void_along_normal":
        mesh_id = params.get("mesh_id") or ctx.active_mesh_id
        target = ctx.resolve(mesh_id)
        pt = ctx.points[params["from_point_id"]]
        origin = Vector(pt["world_position"]) + Vector(pt["surface_normal"]) * 0.01
        direction = -Vector(pt["surface_normal"])
        rc = ops._verify_raycast(target, list(origin), list(direction))
        if not rc["hit"]:
            return {"kind": kind, "hit": False, "value_mm": None}
        depth = (Vector(rc["world_loc"]) - Vector(pt["world_position"])).length
        return {"kind": kind, "hit": True, "value_mm": depth, "hit_point": rc["world_loc"]}
    if kind == "min_wall_thickness":
        mesh_id = params.get("mesh_id") or ctx.active_mesh_id
        target = ctx.resolve(mesh_id)
        # Proxy: smallest bbox dim (real impl needs medial-axis sampling)
        bb = ops._bbox(target)
        dims = [bb["max"][i] - bb["min"][i] for i in range(3)]
        return {"kind": kind, "value_mm": min(dims)}
    raise ValueError(f"unknown measure kind: {kind}")


def h_export_stl(ctx, params):
    mesh_ids = params.get("selection") or [ctx.active_mesh_id]
    if not mesh_ids[0]:
        raise ValueError("export_stl: no mesh to export")

    # Select the requested objects.
    bpy.ops.object.select_all(action="DESELECT")
    for mid in mesh_ids:
        name = ctx.object_by_id.get(mid)
        if name and name in bpy.data.objects:
            bpy.data.objects[name].select_set(True)
            bpy.context.view_layer.objects.active = bpy.data.objects[name]

    out = Path(ctx.session_dir) / "exports" / f"export_{int(_now_ms())}.stl"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.wm.stl_export(filepath=str(out), export_selected_objects=True)
    except AttributeError:
        bpy.ops.export_mesh.stl(filepath=str(out), use_selection=True)

    data = out.read_bytes()
    is_manifold = all(
        ops._is_watertight(ctx.resolve(mid)) for mid in mesh_ids if mid in ctx.object_by_id
    )
    return {
        "stl_base64": base64.b64encode(data).decode("ascii"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "is_manifold": is_manifold,
        "byte_count": len(data),
    }


def _exec_bpy_code(ctx, code: str) -> dict:
    """Execute user code with AST validation and a captured stdout buffer."""
    session_dir = Path(ctx.session_dir).resolve()
    tmp_dir = (Path(os.environ.get("PRINTABLE_WORKER_TMP", "/tmp/printable-worker"))).resolve()
    tmp_dir.mkdir(parents=True, exist_ok=True)
    try:
        ast_validate(code, allow_open_paths=[session_dir, tmp_dir])
    except UnsafeCodeError as e:
        return {"result": None, "stdout": "", "error": f"unsafe code: {e}"}

    namespace = {
        "bpy": bpy,
        "bmesh": bmesh,
        "math": math,
        "Vector": Vector,
        "ctx": ctx,
        "session_dir": str(session_dir),
        "__builtins__": {
            # Tight builtins; anything more we re-add explicitly.
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "min": min,
            "max": max,
            "abs": abs,
            "sum": sum,
            "sorted": sorted,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "int": int,
            "float": float,
            "str": str,
            "bool": bool,
            "print": print,
            "isinstance": isinstance,
            "True": True,
            "False": False,
            "None": None,
            "Exception": Exception,
        },
    }
    buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = buf
    try:
        exec(code, namespace)  # noqa: S102 - guarded by AST validation
        result = namespace.get("result")
        return {"result": repr(result) if result is not None else None, "stdout": buf.getvalue()}
    except Exception as e:
        return {"result": None, "stdout": buf.getvalue(), "error": f"{type(e).__name__}: {e}"}
    finally:
        sys.stdout = old_stdout


def h_exec_bpy(ctx, params):
    return _exec_bpy_code(ctx, params["code"])


def h_place_placeholder(ctx, params):
    shape = params["shape"]
    size = params["size_mm"]
    point_id = params["anchor_point_id"]
    pt = ctx.points.get(point_id)
    if not pt:
        raise KeyError(f"unknown point_id: {point_id}")
    pos = Vector(pt["world_position"])
    normal = Vector(pt["surface_normal"])
    quat = ops._normal_to_quat(normal)

    placeholder_id = f"placeholder_{len(ctx.object_by_id)}"
    if shape == "cylinder":
        # size_mm: [radius_x2 (for diameter), _, height]; allow either diameter or radius
        radius = size[0] * 0.5
        height = size[2]
        obj = ops._make_cylinder(
            placeholder_id, radius=radius, height=height, location=pos, rotation_quat=quat
        )
    elif shape == "box":
        obj = ops._make_box(placeholder_id, size=size, location=pos, rotation_quat=quat)
    else:
        raise ValueError(f"unknown placeholder shape: {shape}")

    ctx.object_by_id[placeholder_id] = obj.name
    ctx.object_kind[placeholder_id] = "placeholder"
    return {
        "placeholder_id": placeholder_id,
        "transform": {
            "translate": list(obj.location),
            "rotate_euler_deg": [math.degrees(a) for a in obj.rotation_euler],
            "scale": list(obj.scale),
        },
    }


def h_update_transform(ctx, params):
    object_id = params["object_id"]
    result = ops.transform_mesh(
        ctx,
        object_id,
        translate=params.get("translate"),
        rotate_euler_deg=params.get("rotate_euler_deg"),
        scale=params.get("scale"),
        absolute=params.get("absolute", False),
    )
    return {"object_id": object_id, "transform": result["transform"]}


def h_checkpoint(ctx, params):
    snap_id = params.get("snapshot_id") or f"snap_{int(_now_ms())}"
    snap_path = Path(ctx.session_dir) / "snapshots" / f"{snap_id}.blend"
    snap_path.parent.mkdir(parents=True, exist_ok=True)
    # save_as_mainfile changes the current file path; use copy=True so future
    # saves still go to state.blend.
    bpy.ops.wm.save_as_mainfile(filepath=str(snap_path), copy=True, compress=True)
    from datetime import datetime

    return {"snapshot_id": snap_id, "created_at": datetime.now(UTC).isoformat()}


def h_restore(ctx, params):
    snap_id = params["snapshot_id"]
    snap_path = Path(ctx.session_dir) / "snapshots" / f"{snap_id}.blend"
    if not snap_path.exists():
        raise FileNotFoundError(f"snapshot not found: {snap_id}")
    _load_blend(snap_path)
    # Re-bind ctx.object_by_id against what's actually loaded.
    # We don't have authoritative IDs in the .blend, so we trust the mapping
    # was persisted by SessionManager. (See restore in main.py.)
    return {"ok": True, "snapshot_id": snap_id}


def h_save_state_blend(ctx, params):
    """Save the canonical state.blend (for graceful shutdown / idle)."""
    state_blend = Path(ctx.session_dir) / "state.blend"
    _save_blend(state_blend)
    return {"ok": True, "path": str(state_blend)}


def h_load_state_blend(ctx, params):
    state_blend = Path(ctx.session_dir) / "state.blend"
    if state_blend.exists():
        _load_blend(state_blend)
        return {"ok": True, "loaded": True}
    return {"ok": True, "loaded": False}


def h_register_point(ctx, params):
    """Record a POI from a previous raycast or click. Used by the host.

    params = { point_id, world_position, surface_normal, mesh_id, label? }
    """
    point_id = params["point_id"]
    ctx.points[point_id] = {
        "world_position": params["world_position"],
        "surface_normal": params["surface_normal"],
        "mesh_id": params.get("mesh_id"),
        "label": params.get("label"),
    }
    return {"point_id": point_id}


def h_register_objects(ctx, params):
    """Rebind ctx.object_by_id after a restore.

    params = { objects: [{mesh_id, blender_name, kind}], active_mesh_id?: str,
                points: {...} }
    """
    ctx.object_by_id.clear()
    ctx.object_kind.clear()
    for o in params.get("objects", []):
        ctx.object_by_id[o["mesh_id"]] = o["blender_name"]
        ctx.object_kind[o["mesh_id"]] = o.get("kind", "body")
    if "active_mesh_id" in params:
        ctx.active_mesh_id = params["active_mesh_id"]
    if "points" in params:
        ctx.points = dict(params["points"])
    return {"ok": True, "n_objects": len(ctx.object_by_id)}


def h_list_objects(ctx, params):
    out = []
    for mesh_id, name in ctx.object_by_id.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        out.append(
            {
                "mesh_id": mesh_id,
                "blender_name": name,
                "kind": ctx.object_kind.get(mesh_id, "body"),
                "tri_count": ops._tri_count(obj),
                "bbox": ops._bbox(obj),
            }
        )
    return {"objects": out, "active_mesh_id": ctx.active_mesh_id}


# ---- Dispatcher ------------------------------------------------------------

def h_inspect_scene(ctx, params):
    return _scene_summary(ctx)


def h_inspect_object(ctx, params):
    return _object_info(ctx, params["name_or_id"])


def h_raycast(ctx, params):
    return _raycast_world(
        ctx,
        origin=params["origin"],
        direction=params["direction"],
        mesh_id=params.get("mesh_id"),
    )


HANDLERS = {
    "ping": h_ping,
    "purge_scene": h_purge_scene,
    "import_mesh": h_import_mesh,
    "apply_operation": h_apply_operation,
    "render_preview": h_render_preview,
    "measure": h_measure,
    "export_stl": h_export_stl,
    "exec_bpy": h_exec_bpy,
    "place_placeholder": h_place_placeholder,
    "update_transform": h_update_transform,
    "checkpoint": h_checkpoint,
    "restore": h_restore,
    "save_state_blend": h_save_state_blend,
    "load_state_blend": h_load_state_blend,
    "register_point": h_register_point,
    "register_objects": h_register_objects,
    "list_objects": h_list_objects,
    # Blender-MCP-equivalent introspection.
    "inspect_scene": h_inspect_scene,
    "inspect_object": h_inspect_object,
    "raycast": h_raycast,
}


# ---- Utility ---------------------------------------------------------------


def _now_ms() -> float:
    import time

    return time.time() * 1000


# ---- Main loop -------------------------------------------------------------


def main():
    # Strip Blender's argv up to the "--" sentinel.
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--session-dir", required=True)
    args = parser.parse_args(argv)

    session_dir = Path(args.session_dir).expanduser()
    session_dir.mkdir(parents=True, exist_ok=True)
    ctx = make_ctx(args.session_id, session_dir)

    _purge_scene()
    # If a prior state.blend exists, hydrate from it.
    state_blend = session_dir / "state.blend"
    if state_blend.exists():
        try:
            _load_blend(state_blend)
        except Exception as e:
            log(f"failed to hydrate state.blend: {e}")

    log(f"ready session={args.session_id} dir={session_dir}")
    write_response({"id": "_boot", "ok": True, "result": {"ready": True}})

    while True:
        line = sys.stdin.readline()
        if not line:
            log("stdin closed — exiting")
            return
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            write_response({"id": None, "ok": False, "error": f"bad json: {e}"})
            continue

        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        handler = HANDLERS.get(method)
        if handler is None:
            write_response({"id": rid, "ok": False, "error": f"unknown method: {method}"})
            continue
        try:
            result = handler(ctx, params)
            write_response({"id": rid, "ok": True, "result": result})
        except Exception as e:
            tb = traceback.format_exc()
            log(f"handler {method} failed: {tb}")
            write_response(
                {"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}", "traceback": tb}
            )


if __name__ == "__main__":
    main()
