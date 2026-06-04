"""Render presets — runs inside Blender.

Two named presets per research §6:

- ``solid_engineering`` (default for review): SOLID viewport-style render with
  cavity shading; ortho camera by default; axes visible.
- ``placeholder_overlay``: translucent body + emissive cutter, for the
  placeholder-first workflow.

Cameras: named presets (``front`` / ``iso`` / …) computed from the scene AABB.
The caller may also pass an explicit ``CameraState`` to lock the view.
"""

from __future__ import annotations

import base64
import math
from pathlib import Path
from typing import Any


def _scene_bbox():
    """Combined world-space AABB of all mesh objects in the scene."""
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    pts: list[Vector] = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for c in obj.bound_box:
            pts.append(obj.matrix_world @ Vector(c))
    if not pts:
        return Vector((-1, -1, -1)), Vector((1, 1, 1))
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def _camera_for_preset(preset: str):
    """Return (location, target, up) for a camera preset, derived from the scene AABB."""
    from mathutils import Vector  # type: ignore[import-not-found]

    mn, mx = _scene_bbox()
    center = (mn + mx) * 0.5
    size = (mx - mn).length or 1.0
    d = max(size * 1.5, 1.0)

    presets = {
        "front":  (center + Vector((0, -d, 0)),  center, Vector((0, 0, 1))),
        "back":   (center + Vector((0, d, 0)),   center, Vector((0, 0, 1))),
        "left":   (center + Vector((-d, 0, 0)),  center, Vector((0, 0, 1))),
        "right":  (center + Vector((d, 0, 0)),   center, Vector((0, 0, 1))),
        "top":    (center + Vector((0, 0, d)),   center, Vector((0, 1, 0))),
        "bottom": (center + Vector((0, 0, -d)),  center, Vector((0, -1, 0))),
        "iso":    (center + Vector((d * 0.9, -d * 0.9, d * 0.7)), center, Vector((0, 0, 1))),
    }
    if preset not in presets:
        preset = "iso"
    return presets[preset]


def _setup_camera(location, target, up, *, ortho: bool, ortho_scale: float | None):
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    cam_data = bpy.data.cameras.get("printable_cam") or bpy.data.cameras.new("printable_cam")
    cam_obj = bpy.data.objects.get("printable_cam")
    if cam_obj is None:
        cam_obj = bpy.data.objects.new("printable_cam", cam_data)
        bpy.context.collection.objects.link(cam_obj)

    cam_obj.location = Vector(location)
    direction = Vector(target) - Vector(location)
    cam_obj.rotation_mode = "QUATERNION"
    cam_obj.rotation_quaternion = direction.to_track_quat("-Z", "Y")

    cam_data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        if ortho_scale is None:
            mn, mx = _scene_bbox()
            ortho_scale = (mx - mn).length * 1.2 or 4.0
        cam_data.ortho_scale = ortho_scale
    else:
        cam_data.lens = 50

    bpy.context.scene.camera = cam_obj
    return cam_obj


def _ensure_sun_light():
    import bpy  # type: ignore[import-not-found]

    if "printable_sun" in bpy.data.objects:
        return bpy.data.objects["printable_sun"]
    light_data = bpy.data.lights.new("printable_sun", type="SUN")
    light_data.energy = 4.0
    light_obj = bpy.data.objects.new("printable_sun", light_data)
    bpy.context.collection.objects.link(light_obj)
    light_obj.rotation_euler = (math.radians(45), math.radians(35), math.radians(20))
    return light_obj


def _apply_solid_engineering_materials(ctx) -> None:
    """Matte gray PBR for bodies, hidden materials for cutters."""
    import bpy  # type: ignore[import-not-found]

    for mesh_id, name in ctx.object_by_id.items():
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH":
            continue
        kind = ctx.object_kind.get(mesh_id, "body")
        if kind in ("cutter", "placeholder"):
            obj.hide_render = True
            continue
        obj.hide_render = False
        mat_name = f"mat_{mesh_id}_solid"
        mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        for n in list(nodes):
            nodes.remove(n)
        out = nodes.new("ShaderNodeOutputMaterial")
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = (0.78, 0.78, 0.80, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.55
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
        mat.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)


def _apply_placeholder_overlay_materials(ctx, cutter_object_id: str | None) -> None:
    """Translucent body, emissive cutter."""
    import bpy  # type: ignore[import-not-found]

    for mesh_id, name in ctx.object_by_id.items():
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH":
            continue
        obj.hide_render = False
        kind = ctx.object_kind.get(mesh_id, "body")
        is_target_cutter = (mesh_id == cutter_object_id) or kind in ("cutter", "placeholder")
        mat_name = f"mat_{mesh_id}_overlay"
        mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        for n in list(nodes):
            nodes.remove(n)
        out = nodes.new("ShaderNodeOutputMaterial")
        if is_target_cutter:
            emit = nodes.new("ShaderNodeEmission")
            emit.inputs["Color"].default_value = (1.0, 0.4, 0.2, 1.0)
            emit.inputs["Strength"].default_value = 2.0
            mat.node_tree.links.new(emit.outputs[0], out.inputs[0])
        else:
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.6
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = 0.55
            mat.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
        # Best-effort blend method: not all Blender versions/engines support BLEND on EEVEE-Next.
        for attr in ("blend_method", "surface_render_method"):
            if hasattr(mat, attr):
                try:
                    setattr(mat, attr, "BLEND")
                except Exception:
                    pass
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)


def render_preview(
    ctx,
    out_path: Path,
    *,
    style: str = "solid_engineering",
    camera_preset: str | None = "iso",
    camera_state: dict | None = None,
    width: int = 1024,
    height: int = 1024,
    show_axes: bool = True,
    orthographic: bool = True,
    cutter_object_id: str | None = None,
) -> dict[str, Any]:
    """Render and return ``{png_base64, camera_state, width, height}``."""
    import bpy  # type: ignore[import-not-found]
    from mathutils import Vector  # type: ignore[import-not-found]

    # ---- Scene config -----------------------------------------------------
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True

    # Force EEVEE for speed/portability. Newer Blender exposes BLENDER_EEVEE_NEXT.
    target_engines = ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"]
    for eng in target_engines:
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue

    _ensure_sun_light()

    # ---- Materials --------------------------------------------------------
    if style == "placeholder_overlay":
        _apply_placeholder_overlay_materials(ctx, cutter_object_id)
    else:
        _apply_solid_engineering_materials(ctx)

    # ---- Camera -----------------------------------------------------------
    if camera_state is not None:
        loc = Vector(camera_state["position"])
        tgt = Vector(camera_state["target"])
        up = Vector(camera_state.get("up", [0, 0, 1]))
    else:
        loc, tgt, up = _camera_for_preset(camera_preset or "iso")

    _setup_camera(loc, tgt, up, ortho=orthographic, ortho_scale=None)

    # ---- World background -------------------------------------------------
    world = scene.world or bpy.data.worlds.new("World")
    if scene.world is None:
        scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = (0.05, 0.05, 0.06, 1.0)
        bg.inputs[1].default_value = 1.0

    # ---- Render -----------------------------------------------------------
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)

    # ---- Encode -----------------------------------------------------------
    png = out_path.read_bytes()
    b64 = base64.b64encode(png).decode("ascii")

    return {
        "png_base64": b64,
        "camera_state": {
            "position": list(loc),
            "target": list(tgt),
            "up": list(up),
            "fov": 35.0,
        },
        "width": width,
        "height": height,
    }
