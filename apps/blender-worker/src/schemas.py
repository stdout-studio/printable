"""Pydantic models for the Blender worker HTTP API.

Mirror of ``packages/shared-types/src/{operations,render,point,session}.ts``.
TypeScript uses camelCase; we accept both camelCase (preferred for round-tripping
from the web app) and snake_case (preferred for hand-written Python clients /
smoke tests) via ``populate_by_name=True`` + ``alias`` per field.

If a field is added/changed here, mirror it in shared-types.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---- Base config -----------------------------------------------------------


class _Model(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="forbid",
        # round-trip through camelCase by default; snake_case still accepted on input
        # via populate_by_name=True
        ser_json_inf_nan="null",
    )


Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]


# ---- Camera & geometry primitives -----------------------------------------


class CameraState(_Model):
    position: Vec3
    target: Vec3
    up: Vec3 = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    fov: float = 35.0


class BoundingBox(_Model):
    min: Vec3
    max: Vec3


# ---- Session ---------------------------------------------------------------


class CreateSessionRequest(_Model):
    user_id: str | None = Field(default=None, alias="userId")


class CreateSessionResponse(_Model):
    session_id: str = Field(alias="sessionId")
    worker_url: str = Field(alias="workerUrl")


# ---- Import ----------------------------------------------------------------


class ImportMeshRequest(_Model):
    """Either ``stl_base64`` or ``stl_url`` must be set. Filename is used for the label."""

    stl_base64: str | None = Field(default=None, alias="stlBase64")
    stl_url: str | None = Field(default=None, alias="stlUrl")
    filename: str | None = None
    label: str | None = None
    # Used to flag the mesh as the active target body for subsequent ops.
    set_active: bool = Field(default=True, alias="setActive")


class ImportMeshResponse(_Model):
    mesh_id: str = Field(alias="meshId")
    label: str
    bbox: BoundingBox
    dims_mm: Vec3 = Field(alias="dimsMm")
    tri_count: int = Field(alias="triCount")
    is_watertight: bool = Field(alias="isWatertight")
    warnings: list[str] = Field(default_factory=list)


# ---- Operations (mirror operations.ts) -------------------------------------


class _OpBase(_Model):
    # The mesh the op targets. ``mesh_id`` matches the TS ``meshId`` field.
    mesh_id: str = Field(alias="meshId")


class BooleanDiff(_OpBase):
    type: Literal["boolean_diff"] = "boolean_diff"
    cutter_mesh_id: str = Field(alias="cutterMeshId")
    # Memory-mandated defaults — see feedback_blender_cad_workflow.md
    solver: Literal["EXACT", "FAST"] = "EXACT"
    use_self: bool = Field(default=True, alias="useSelf")
    use_hole_tolerant: bool = Field(default=True, alias="useHoleTolerant")
    fdm_tolerance_mm: float = Field(default=0.0, alias="fdmToleranceMm")
    keep_cutter: bool = Field(default=False, alias="keepCutter")


class BooleanUnion(_OpBase):
    type: Literal["boolean_union"] = "boolean_union"
    other_mesh_id: str = Field(alias="otherMeshId")
    solver: Literal["EXACT", "FAST"] = "EXACT"
    use_self: bool = Field(default=True, alias="useSelf")
    use_hole_tolerant: bool = Field(default=True, alias="useHoleTolerant")
    keep_other: bool = Field(default=False, alias="keepOther")


class AddCylinderAtPoint(_OpBase):
    type: Literal["add_cylinder_at_point"] = "add_cylinder_at_point"
    # Placement is EITHER a clicked point (point_id) OR an explicit world
    # position (+ optional normal). Coordinate mode lets the agent place a
    # feature anywhere it can compute — e.g. one call per hole for six holes —
    # without dropping to raw_bpy. In coordinate mode `position` is the center.
    point_id: str | None = Field(default=None, alias="pointId")
    position: Vec3 | None = None
    normal: Vec3 | None = None
    radius: float
    height: float
    along_normal: bool = Field(default=True, alias="alongNormal")
    # 'cut' = boolean diff, 'emboss' = boolean union, 'placeholder' = just place a translucent object
    operation: Literal["cut", "emboss", "placeholder"] = "cut"
    fit: Literal["press", "clearance", "free"] = "press"


class AddBoxAtPoint(_OpBase):
    type: Literal["add_box_at_point"] = "add_box_at_point"
    # Same point-or-coordinate placement as AddCylinderAtPoint. For an oriented
    # cutout (rotated slot, angled pocket) pass rotation_euler_degrees — it fully
    # specifies orientation and overrides the normal-alignment.
    point_id: str | None = Field(default=None, alias="pointId")
    position: Vec3 | None = None
    normal: Vec3 | None = None
    size: Vec3
    align_to_normal: bool = Field(default=True, alias="alignToNormal")
    rotation_euler_degrees: Vec3 | None = Field(default=None, alias="rotationEulerDegrees")
    operation: Literal["cut", "emboss", "placeholder"] = "cut"


class ExtrudeFaces(_OpBase):
    type: Literal["extrude_faces"] = "extrude_faces"
    face_indices: list[int] = Field(alias="faceIndices")
    distance: float


class FilletEdges(_OpBase):
    type: Literal["fillet_edges"] = "fillet_edges"
    # ``edge_indices`` mirrors the TS field; ``"all"`` is a worker-side convenience
    edge_indices: list[int] | Literal["all"] = Field(alias="edgeIndices")
    radius: float


class ChamferEdges(_OpBase):
    type: Literal["chamfer_edges"] = "chamfer_edges"
    edge_indices: list[int] | Literal["all"] = Field(alias="edgeIndices")
    width: float


class TransformMesh(_OpBase):
    type: Literal["transform_mesh"] = "transform_mesh"
    translate: Vec3
    rotate_euler_degrees: Vec3 = Field(alias="rotateEulerDegrees")
    scale: Vec3 = Field(default_factory=lambda: [1.0, 1.0, 1.0])


class RawBpy(_OpBase):
    type: Literal["raw_bpy"] = "raw_bpy"
    python_script: str = Field(alias="pythonScript")


class Verify(_OpBase):
    """Standalone verify call. Most ops auto-verify; this is for explicit re-checks."""

    type: Literal["verify"] = "verify"
    checks: list[Literal["manifold", "raycast_hit", "min_wall_mm", "overhang"]] = Field(
        default_factory=lambda: ["manifold"]
    )
    min_wall_mm: float = Field(default=1.0, alias="minWallMm")


# ---- Blender-MCP-equivalent ops --------------------------------------------


class CreatePrimitive(_Model):
    """Doesn't extend _OpBase — it CREATES the mesh, so there's no target."""

    type: Literal["create_primitive"] = "create_primitive"
    # Optional caller-chosen id; the worker will mint `mesh_N` if absent.
    mesh_id: str | None = Field(default=None, alias="meshId")
    primitive: Literal["cube", "cylinder", "sphere", "cone", "plane", "torus"]
    location: Vec3 = Field(default=(0.0, 0.0, 0.0))
    rotation_euler_degrees: Vec3 = Field(default=(0.0, 0.0, 0.0), alias="rotationEulerDegrees")
    size: float = 1.0
    radius: float = 1.0
    depth: float = 2.0
    segments: int = 32
    minor_radius: float | None = Field(default=None, alias="minorRadius")
    label: str | None = None
    kind: Literal["body", "cutter"] = "body"


class DeleteObject(_OpBase):
    type: Literal["delete_object"] = "delete_object"


class DuplicateObject(_OpBase):
    type: Literal["duplicate_object"] = "duplicate_object"
    new_mesh_id: str | None = Field(default=None, alias="newMeshId")


class SetTransform(_OpBase):
    type: Literal["set_transform"] = "set_transform"
    location: Vec3 | None = None
    rotation_euler_degrees: Vec3 | None = Field(default=None, alias="rotationEulerDegrees")
    scale: Vec3 | None = None


class AddModifier(_OpBase):
    type: Literal["add_modifier"] = "add_modifier"
    modifier_type: str = Field(alias="modifierType")
    modifier_name: str | None = Field(default=None, alias="modifierName")
    settings: dict = Field(default_factory=dict)


class ApplyModifier(_OpBase):
    type: Literal["apply_modifier"] = "apply_modifier"
    modifier_name: str | None = Field(default=None, alias="modifierName")


class JoinObjects(_Model):
    """Target = mesh_ids[0]; rest are merged in."""

    type: Literal["join_objects"] = "join_objects"
    mesh_ids: list[str] = Field(alias="meshIds")
    # Set so the apply_operation `mesh_id` field in main.py doesn't barf.
    mesh_id: str | None = Field(default=None, alias="meshId")


Operation = Annotated[
    BooleanDiff
    | BooleanUnion
    | AddCylinderAtPoint
    | AddBoxAtPoint
    | ExtrudeFaces
    | FilletEdges
    | ChamferEdges
    | TransformMesh
    | RawBpy
    | Verify
    | CreatePrimitive
    | DeleteObject
    | DuplicateObject
    | SetTransform
    | AddModifier
    | ApplyModifier
    | JoinObjects,
    Field(discriminator="type"),
]


class ApplyOperationRequest(_Model):
    op: Operation


class DiffSummary(_Model):
    tri_count_before: int = Field(alias="triCountBefore")
    tri_count_after: int = Field(alias="triCountAfter")
    bbox_before: BoundingBox = Field(alias="bboxBefore")
    bbox_after: BoundingBox = Field(alias="bboxAfter")
    volume_change_mm3: float = Field(alias="volumeChangeMm3")
    is_watertight: bool = Field(alias="isWatertight")


class ApplyOperationResponse(_Model):
    mesh_id: str = Field(alias="meshId")
    diff_summary: DiffSummary = Field(alias="diffSummary")
    warnings: list[str] = Field(default_factory=list)
    # Populated for raw_bpy ops: the script's `result` value (repr), captured
    # stdout, and any exception. Empty for other ops. Surfacing these lets the
    # agent recognize when its script silently errored (e.g. ImportError because
    # `import` is forbidden) instead of fabricating success.
    script_result: str | None = Field(default=None, alias="scriptResult")
    script_stdout: str | None = Field(default=None, alias="scriptStdout")
    script_error: str | None = Field(default=None, alias="scriptError")


# ---- Render (mirror render.ts) --------------------------------------------


RenderStyle = Literal["solid_engineering", "solid_cavity", "placeholder_overlay"]
CameraPreset = Literal["front", "back", "left", "right", "top", "bottom", "iso", "current"]


class RenderRequest(_Model):
    # Either a full CameraState OR a named preset.
    camera_state: CameraState | None = Field(default=None, alias="cameraState")
    camera_preset: CameraPreset | None = Field(default="iso", alias="cameraPreset")
    width: int = 1024
    height: int = 1024
    style: RenderStyle = "solid_engineering"
    show_axes: bool = Field(default=True, alias="showAxes")
    orthographic: bool = True
    # Optionally highlight an object as the "cutter" in placeholder_overlay style.
    cutter_object_id: str | None = Field(default=None, alias="cutterObjectId")


class RenderResponse(_Model):
    png_base64: str = Field(alias="pngBase64")
    camera_state: CameraState = Field(alias="cameraState")
    width: int
    height: int


# ---- Measure ---------------------------------------------------------------


class MeasureRequest(_Model):
    kind: Literal[
        "distance_between_points",
        "raycast_hit",
        "void_along_normal",
        "min_wall_thickness",
        "bbox_dims",
    ]
    from_point_id: str | None = Field(default=None, alias="fromPointId")
    to_point_id: str | None = Field(default=None, alias="toPointId")
    direction: Vec3 | None = None
    expected_void_mm: float | None = Field(default=None, alias="expectedVoidMm")
    mesh_id: str | None = Field(default=None, alias="meshId")


class MeasureResponse(_Model):
    kind: str
    value_mm: float | None = Field(default=None, alias="valueMm")
    hit: bool | None = None
    hit_object_id: str | None = Field(default=None, alias="hitObjectId")
    hit_point: Vec3 | None = Field(default=None, alias="hitPoint")
    dims_mm: Vec3 | None = Field(default=None, alias="dimsMm")
    extra: dict | None = None


# ---- Export ---------------------------------------------------------------


class ExportStlRequest(_Model):
    selection: list[str] | None = None  # object IDs; default = active mesh


class ExportStlResponse(_Model):
    stl_base64: str = Field(alias="stlBase64")
    sha256: str
    is_manifold: bool = Field(alias="isManifold")
    byte_count: int = Field(alias="byteCount")


# ---- exec_bpy --------------------------------------------------------------


class ExecBpyRequest(_Model):
    code: str


class ExecBpyResponse(_Model):
    result: str | None = None
    stdout: str = ""
    error: str | None = None


# ---- Placeholders & transforms --------------------------------------------


class PlacePlaceholderRequest(_Model):
    shape: Literal["cylinder", "box"]
    size_mm: Vec3 = Field(alias="sizeMm")
    anchor_point_id: str = Field(alias="anchorPointId")
    label: str | None = None


class Transform(_Model):
    translate: Vec3
    rotate_euler_deg: Vec3 = Field(alias="rotateEulerDeg")
    scale: Vec3 = Field(default_factory=lambda: [1.0, 1.0, 1.0])


class PlacePlaceholderResponse(_Model):
    placeholder_id: str = Field(alias="placeholderId")
    transform: Transform


class UpdateTransformRequest(_Model):
    object_id: str = Field(alias="objectId")
    translate: Vec3 | None = None
    rotate_euler_deg: Vec3 | None = Field(default=None, alias="rotateEulerDeg")
    scale: Vec3 | None = None
    absolute: bool = False  # if true, set transform; if false, delta-apply


class UpdateTransformResponse(_Model):
    object_id: str = Field(alias="objectId")
    transform: Transform


# ---- Checkpoint / restore --------------------------------------------------


class CheckpointResponse(_Model):
    snapshot_id: str = Field(alias="snapshotId")
    created_at: str = Field(alias="createdAt")


class RestoreRequest(_Model):
    snapshot_id: str = Field(alias="snapshotId")


class RestoreResponse(_Model):
    ok: bool = True
    snapshot_id: str = Field(alias="snapshotId")


# ---- State ----------------------------------------------------------------


class HistoryEntry(_Model):
    seq: int
    op_type: str = Field(alias="opType")
    timestamp: str
    snapshot_id: str | None = Field(default=None, alias="snapshotId")
    warnings: list[str] = Field(default_factory=list)


class SessionStateResponse(_Model):
    session_id: str = Field(alias="sessionId")
    created_at: str = Field(alias="createdAt")
    active_mesh_id: str | None = Field(default=None, alias="activeMeshId")
    objects: list[dict]  # {id, kind, label, transform, ...}
    points: list[dict]
    snapshots: list[dict]
    history: list[HistoryEntry]
    manifest: dict


class HealthResponse(_Model):
    status: Literal["ok"] = "ok"
