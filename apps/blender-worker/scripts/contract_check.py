"""Wire-contract check (no Blender required).

Validates that the EXACT payloads the web/agent layer sends — camelCase keys and
the tool's enum values — are accepted by the worker's Pydantic schemas. This
guards the render_preview / measure field + enum bugs fixed in the agent↔Blender
pass and catches future TypeScript↔Python drift, without needing a running
Blender (it only imports ``src.schemas``, which depends on pydantic alone).

Run::

    cd apps/blender-worker
    python3 -m venv .venv && .venv/bin/pip install -q pydantic
    .venv/bin/python scripts/contract_check.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from src import schemas  # noqa: E402

failures: list[str] = []


def ok(name, fn):
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL  {name}: {type(e).__name__}: {e}")
        failures.append(name)


def must_reject(name, fn):
    try:
        fn()
        print(f"FAIL  {name}: expected rejection but it parsed")
        failures.append(name)
    except ValidationError:
        print(f"PASS  {name} (correctly rejected)")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL  {name}: wrong error {type(e).__name__}: {e}")
        failures.append(name)


# --- render_preview: the agent emits cameraPreset/showAxes (camelCase). The
# old client read i.view/i.show_axes and dropped the angle; this locks the fix.
ok(
    "render: cameraPreset + showAxes (camelCase)",
    lambda: schemas.RenderRequest(
        cameraPreset="front", style="solid_engineering", showAxes=True, orthographic=True, width=1024, height=1024
    ),
)

# --- measure: every kind the tool now advertises, with camelCase point ids ---
for kind, extra in [
    ("distance_between_points", {"fromPointId": "pt_a", "toPointId": "pt_b"}),
    ("raycast_hit", {"fromPointId": "pt_a"}),
    ("void_along_normal", {"fromPointId": "pt_a", "expectedVoidMm": 5.0}),
    ("min_wall_thickness", {"meshId": "mesh_0"}),
    ("bbox_dims", {"meshId": "mesh_0"}),
]:
    ok(f"measure: {kind} (camelCase)", lambda k=kind, e=extra: schemas.MeasureRequest(kind=k, **e))

# The two legacy kinds the tool used to (wrongly) advertise must be rejected.
must_reject(
    "measure: legacy raycast_from_point rejected",
    lambda: schemas.MeasureRequest(kind="raycast_from_point", fromPointId="pt_a"),
)
must_reject(
    "measure: legacy void_at_point rejected",
    lambda: schemas.MeasureRequest(kind="void_at_point", fromPointId="pt_a"),
)

# --- operations: alias-heavy ops the agent emits as camelCase, via the
# discriminated ApplyOperationRequest union ---
OPS = [
    {"type": "boolean_diff", "meshId": "mesh_0", "cutterMeshId": "mesh_1", "solver": "EXACT", "useSelf": True, "useHoleTolerant": True, "fdmToleranceMm": 0.15, "keepCutter": False},
    {"type": "add_cylinder_at_point", "meshId": "mesh_0", "pointId": "pt_a", "radius": 2.5, "height": 10, "alongNormal": True, "operation": "cut", "fit": "clearance"},
    # Coordinate-mode placement (no pointId) — the granular Blender-MCP-style path.
    {"type": "add_cylinder_at_point", "meshId": "mesh_0", "position": [1, 2, 3], "normal": [0, 0, 1], "radius": 2.5, "height": 10, "operation": "cut"},
    {"type": "add_box_at_point", "meshId": "mesh_0", "pointId": "pt_a", "size": [4, 5, 6], "operation": "cut"},
    {"type": "add_box_at_point", "meshId": "mesh_0", "position": [1, 2, 3], "size": [4, 5, 6], "rotationEulerDegrees": [0, 0, 45], "operation": "cut"},
    {"type": "transform_mesh", "meshId": "mesh_0", "translate": [1, 2, 3], "rotateEulerDegrees": [0, 0, 90], "scale": [1, 1, 1]},
    {"type": "create_primitive", "primitive": "cylinder", "rotationEulerDegrees": [0, 0, 0], "minorRadius": 1.0},
    {"type": "join_objects", "meshIds": ["mesh_0", "mesh_1"]},
    {"type": "raw_bpy", "meshId": "mesh_0", "pythonScript": "result = {}"},
]
for op in OPS:
    ok(f"op: {op['type']} (camelCase)", lambda o=op: schemas.ApplyOperationRequest(op=o))


if failures:
    print(f"\n{len(failures)} FAILURE(S): {failures}")
    sys.exit(1)
print("\nAll wire-contract checks passed.")
