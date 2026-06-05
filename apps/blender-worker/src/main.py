"""FastAPI app — printable-blender-worker.

The HTTP contract mirrors ``packages/shared-types/src/{operations,render}.ts``.
This module wires HTTP routes to ``SessionManager`` which owns the Blender
subprocesses.

Run locally::

    cd apps/blender-worker
    uv run uvicorn src.main:app --reload --port 8080
"""

from __future__ import annotations

import base64
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel as _BaseModel, Field as _Field

from . import schemas
from .blender_process import TransportError, TransportTimeout
from .sessions import Session, manager
from .storage import utc_now_iso

# ---- App lifecycle ---------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Cleanly tear down sessions so Blender subprocesses don't linger.
    await manager().shutdown_all()


app = FastAPI(title="printable-blender-worker", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("WORKER_CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Helpers ---------------------------------------------------------------


def _worker_url() -> str:
    host = os.environ.get("WORKER_PUBLIC_HOST", "127.0.0.1")
    port = os.environ.get("WORKER_PUBLIC_PORT", "8080")
    scheme = os.environ.get("WORKER_PUBLIC_SCHEME", "http")
    return f"{scheme}://{host}:{port}"


def _get_session(session_id: str) -> Session:
    try:
        return manager().get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


SessionDep = Annotated[Session, Depends(_get_session)]


def _http_error(e: Exception) -> HTTPException:
    if isinstance(e, TransportTimeout):
        return HTTPException(status_code=504, detail=str(e))
    if isinstance(e, TransportError):
        return HTTPException(status_code=500, detail=str(e))
    return HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# ---- Health ----------------------------------------------------------------


@app.get("/healthz", response_model=schemas.HealthResponse)
async def healthz() -> schemas.HealthResponse:
    return schemas.HealthResponse()


@app.get("/health")
async def health_legacy() -> dict[str, str]:
    # Back-compat shim for early code.
    return {"status": "ok"}


# ---- Sessions --------------------------------------------------------------


@app.post("/sessions", response_model=schemas.CreateSessionResponse)
async def create_session(req: schemas.CreateSessionRequest | None = None) -> schemas.CreateSessionResponse:
    try:
        session = await manager().create(user_id=(req.user_id if req else None))
    except Exception as e:
        raise _http_error(e) from e
    return schemas.CreateSessionResponse(
        session_id=session.id, worker_url=_worker_url()
    )


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, delete_disk: bool = False) -> dict[str, bool]:
    try:
        await manager().remove(session_id, delete_disk=delete_disk)
    except Exception as e:
        raise _http_error(e) from e
    return {"ok": True}


@app.get("/sessions/{session_id}/state", response_model=schemas.SessionStateResponse)
async def session_state(session: SessionDep) -> schemas.SessionStateResponse:
    state = session.state
    return schemas.SessionStateResponse(
        session_id=session.id,
        created_at=state.get("created_at", utc_now_iso()),
        active_mesh_id=state.get("active_mesh_id"),
        objects=state.get("objects", []),
        points=list(state.get("points_map", {}).values()),
        snapshots=state.get("snapshots", []),
        history=[schemas.HistoryEntry(**h) for h in state.get("history", [])],
        manifest=state.get("manifest", {}),
    )


# ---- Import mesh -----------------------------------------------------------


@app.post("/sessions/{session_id}/import_mesh", response_model=schemas.ImportMeshResponse)
async def import_mesh(
    session: SessionDep, req: schemas.ImportMeshRequest
) -> schemas.ImportMeshResponse:
    if not req.stl_base64 and not req.stl_url:
        raise HTTPException(status_code=400, detail="stl_base64 or stl_url required")
    if req.stl_url:
        raise HTTPException(status_code=501, detail="stl_url not implemented in v0 (use stl_base64)")

    mesh_id = f"mesh_{len(session.state.get('objects', []))}"
    label = req.label or req.filename or mesh_id

    try:
        async with session.lock:
            await session.checkpoint(label=f"pre_import_{mesh_id}")
            result = await session.transport.call(
                "import_mesh",
                {
                    "mesh_id": mesh_id,
                    "label": label,
                    "set_active": req.set_active,
                    "stl_base64": req.stl_base64,
                },
                timeout=60.0,
            )
            session.add_object(mesh_id, mesh_id, "body", label=label)
            if req.set_active:
                session.set_active(mesh_id)
            session.append_history("import_mesh")
    except Exception as e:
        raise _http_error(e) from e

    return schemas.ImportMeshResponse(
        mesh_id=mesh_id,
        label=label,
        bbox=schemas.BoundingBox(**result["bbox"]),
        dims_mm=result["dims_mm"],
        tri_count=result["tri_count"],
        is_watertight=result["is_watertight"],
        warnings=result.get("warnings", []),
    )


@app.post("/sessions/{session_id}/import_mesh_upload", response_model=schemas.ImportMeshResponse)
async def import_mesh_upload(
    session: SessionDep,
    file: UploadFile = File(...),
    label: str | None = Form(default=None),
    set_active: bool = Form(default=True),
) -> schemas.ImportMeshResponse:
    """Multipart variant for convenience (curl -F)."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    req = schemas.ImportMeshRequest(
        stl_base64=base64.b64encode(data).decode("ascii"),
        filename=file.filename,
        label=label,
        set_active=set_active,
    )
    return await import_mesh(session, req)


# ---- Apply operation -------------------------------------------------------


@app.post("/sessions/{session_id}/apply_operation", response_model=schemas.ApplyOperationResponse)
async def apply_operation(
    session: SessionDep, req: schemas.ApplyOperationRequest
) -> schemas.ApplyOperationResponse:
    op_dict = req.op.model_dump(by_alias=False)
    try:
        async with session.lock:
            # Pre-checkpoint, then dispatch.
            snap_id = await session.checkpoint(label=f"pre_{op_dict['type']}")
            # Was 120s. A raw_bpy that does many sequential booleans on a
            # heavy mesh (e.g. 3 button pockets + 6 cable through-holes)
            # comfortably exceeds that; the resulting 504 is opaque to the
            # agent. 300s is enough headroom for real work without making
            # truly stuck scripts hide forever.
            result = await session.transport.call(
                "apply_operation", {"op": op_dict}, timeout=300.0
            )
            warnings = result.get("warnings", []) or []
            session.append_history(op_dict["type"], snapshot_id=snap_id, warnings=warnings)
    except Exception as e:
        raise _http_error(e) from e

    diff = result.get("diff_summary")
    if diff is None:
        # Verify ops / placeholders return no diff; synthesize an empty one.
        diff = {
            "tri_count_before": 0,
            "tri_count_after": 0,
            "bbox_before": {"min": [0, 0, 0], "max": [0, 0, 0]},
            "bbox_after": {"min": [0, 0, 0], "max": [0, 0, 0]},
            "volume_change_mm3": 0.0,
            "is_watertight": True,
        }
    return schemas.ApplyOperationResponse(
        mesh_id=result.get("mesh_id", session.active_mesh_id or ""),
        diff_summary=schemas.DiffSummary(
            tri_count_before=diff["tri_count_before"],
            tri_count_after=diff["tri_count_after"],
            bbox_before=schemas.BoundingBox(**diff["bbox_before"]),
            bbox_after=schemas.BoundingBox(**diff["bbox_after"]),
            volume_change_mm3=diff["volume_change_mm3"],
            is_watertight=diff["is_watertight"],
        ),
        warnings=warnings,
        script_result=result.get("result"),
        script_stdout=result.get("stdout"),
        script_error=result.get("error"),
    )


# ---- Render ----------------------------------------------------------------


@app.post("/sessions/{session_id}/render_preview", response_model=schemas.RenderResponse)
async def render_preview(
    session: SessionDep, req: schemas.RenderRequest
) -> schemas.RenderResponse:
    params: dict = {
        "width": req.width,
        "height": req.height,
        "style": req.style,
        "show_axes": req.show_axes,
        "orthographic": req.orthographic,
    }
    if req.camera_state is not None:
        params["camera_state"] = req.camera_state.model_dump(by_alias=False)
    else:
        params["camera_preset"] = req.camera_preset
    if req.cutter_object_id:
        params["cutter_object_id"] = req.cutter_object_id

    try:
        async with session.lock:
            result = await session.transport.call(
                "render_preview", params, timeout=120.0
            )
    except Exception as e:
        raise _http_error(e) from e
    return schemas.RenderResponse(
        png_base64=result["png_base64"],
        camera_state=schemas.CameraState(**result["camera_state"]),
        width=result["width"],
        height=result["height"],
    )


# ---- Measure ---------------------------------------------------------------


@app.post("/sessions/{session_id}/measure", response_model=schemas.MeasureResponse)
async def measure(
    session: SessionDep, req: schemas.MeasureRequest
) -> schemas.MeasureResponse:
    payload = req.model_dump(by_alias=False, exclude_none=True)
    try:
        async with session.lock:
            result = await session.transport.call("measure", payload)
    except Exception as e:
        raise _http_error(e) from e
    return schemas.MeasureResponse(**result)


# ---- Export ---------------------------------------------------------------


@app.post("/sessions/{session_id}/export_stl", response_model=schemas.ExportStlResponse)
async def export_stl(
    session: SessionDep, req: schemas.ExportStlRequest | None = None
) -> schemas.ExportStlResponse:
    payload: dict = {}
    if req and req.selection:
        payload["selection"] = req.selection
    try:
        async with session.lock:
            result = await session.transport.call("export_stl", payload)
    except Exception as e:
        raise _http_error(e) from e
    return schemas.ExportStlResponse(
        stl_base64=result["stl_base64"],
        sha256=result["sha256"],
        is_manifold=result["is_manifold"],
        byte_count=result["byte_count"],
    )


# ---- exec_bpy --------------------------------------------------------------


@app.post("/sessions/{session_id}/exec_bpy", response_model=schemas.ExecBpyResponse)
async def exec_bpy(
    session: SessionDep, req: schemas.ExecBpyRequest
) -> schemas.ExecBpyResponse:
    try:
        async with session.lock:
            result = await session.transport.call("exec_bpy", {"code": req.code})
    except Exception as e:
        raise _http_error(e) from e
    return schemas.ExecBpyResponse(
        result=result.get("result"),
        stdout=result.get("stdout", ""),
        error=result.get("error"),
    )


# ---- Blender-MCP-equivalent introspection ----------------------------------


@app.post("/sessions/{session_id}/inspect_scene")
async def inspect_scene(session: SessionDep) -> dict:
    try:
        async with session.lock:
            return await session.transport.call("inspect_scene", {})
    except Exception as e:
        raise _http_error(e) from e


class _InspectObjectReq(_BaseModel):
    name_or_id: str = _Field(alias="nameOrId")

    class Config:
        populate_by_name = True


@app.post("/sessions/{session_id}/inspect_object")
async def inspect_object(session: SessionDep, req: _InspectObjectReq) -> dict:
    try:
        async with session.lock:
            return await session.transport.call(
                "inspect_object", {"name_or_id": req.name_or_id}
            )
    except Exception as e:
        raise _http_error(e) from e


class _RaycastReq(_BaseModel):
    origin: list[float]
    direction: list[float]
    mesh_id: str | None = _Field(default=None, alias="meshId")

    class Config:
        populate_by_name = True


@app.post("/sessions/{session_id}/raycast")
async def raycast(session: SessionDep, req: _RaycastReq) -> dict:
    try:
        async with session.lock:
            return await session.transport.call(
                "raycast",
                {"origin": req.origin, "direction": req.direction, "mesh_id": req.mesh_id},
            )
    except Exception as e:
        raise _http_error(e) from e


# ---- Placeholders & transforms --------------------------------------------


@app.post("/sessions/{session_id}/place_placeholder", response_model=schemas.PlacePlaceholderResponse)
async def place_placeholder(
    session: SessionDep, req: schemas.PlacePlaceholderRequest
) -> schemas.PlacePlaceholderResponse:
    try:
        async with session.lock:
            await session.checkpoint(label=f"pre_placeholder_{req.shape}")
            result = await session.transport.call(
                "place_placeholder",
                {
                    "shape": req.shape,
                    "size_mm": req.size_mm,
                    "anchor_point_id": req.anchor_point_id,
                },
            )
            session.add_object(
                result["placeholder_id"],
                result["placeholder_id"],
                "placeholder",
                label=req.label or result["placeholder_id"],
            )
            session.append_history("place_placeholder")
    except Exception as e:
        raise _http_error(e) from e
    return schemas.PlacePlaceholderResponse(
        placeholder_id=result["placeholder_id"],
        transform=schemas.Transform(**result["transform"]),
    )


@app.post("/sessions/{session_id}/update_transform", response_model=schemas.UpdateTransformResponse)
async def update_transform(
    session: SessionDep, req: schemas.UpdateTransformRequest
) -> schemas.UpdateTransformResponse:
    payload: dict = {"object_id": req.object_id, "absolute": req.absolute}
    if req.translate is not None:
        payload["translate"] = req.translate
    if req.rotate_euler_deg is not None:
        payload["rotate_euler_deg"] = req.rotate_euler_deg
    if req.scale is not None:
        payload["scale"] = req.scale
    try:
        async with session.lock:
            result = await session.transport.call("update_transform", payload)
            session.append_history("update_transform")
    except Exception as e:
        raise _http_error(e) from e
    return schemas.UpdateTransformResponse(
        object_id=result["object_id"], transform=schemas.Transform(**result["transform"])
    )


# ---- Points (helper for the host to register POIs) ------------------------


@app.post("/sessions/{session_id}/register_point")
async def register_point(session: SessionDep, point: dict) -> dict[str, str]:
    """Persist a Point-of-Interest. The shape mirrors ``PointToken`` from shared-types."""
    point_id = point.get("id") or point.get("point_id")
    if not point_id:
        raise HTTPException(status_code=400, detail="point requires id")
    payload = {
        "point_id": point_id,
        "world_position": point["worldPosition"] if "worldPosition" in point else point["world_position"],
        "surface_normal": point.get("surfaceNormal") or point.get("surface_normal"),
        "mesh_id": point.get("meshId") or point.get("mesh_id"),
        "label": point.get("label"),
    }
    try:
        async with session.lock:
            await session.transport.call("register_point", payload)
            session.state.setdefault("points_map", {})[point_id] = payload
            session.save_state()
    except Exception as e:
        raise _http_error(e) from e
    return {"point_id": point_id}


# ---- Checkpoint / restore --------------------------------------------------


@app.post("/sessions/{session_id}/checkpoint", response_model=schemas.CheckpointResponse)
async def checkpoint(session: SessionDep) -> schemas.CheckpointResponse:
    try:
        async with session.lock:
            snap_id = await session.checkpoint()
        snaps = session.state.get("snapshots", [])
        rec = next((s for s in reversed(snaps) if s["id"] == snap_id), {})
    except Exception as e:
        raise _http_error(e) from e
    return schemas.CheckpointResponse(snapshot_id=snap_id, created_at=rec.get("created_at", utc_now_iso()))


@app.post("/sessions/{session_id}/restore", response_model=schemas.RestoreResponse)
async def restore(
    session: SessionDep, req: schemas.RestoreRequest
) -> schemas.RestoreResponse:
    try:
        async with session.lock:
            await session.restore(req.snapshot_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise _http_error(e) from e
    return schemas.RestoreResponse(ok=True, snapshot_id=req.snapshot_id)


# ---- Listing helpers ------------------------------------------------------


@app.get("/sessions/{session_id}/objects")
async def list_objects(session: SessionDep) -> dict:
    try:
        async with session.lock:
            result = await session.transport.call("list_objects", {})
    except Exception as e:
        raise _http_error(e) from e
    return result


@app.get("/sessions")
async def list_sessions() -> dict:
    return {"sessions": list(manager().list())}
