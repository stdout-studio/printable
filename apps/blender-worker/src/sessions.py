"""In-memory registry of active sessions.

One ``Session`` owns:
  - a ``BlenderTransport`` (live subprocess)
  - a ``SessionStore`` (disk-backed state.json / state.blend / snapshots / renders)
  - the canonical mapping ``mesh_id -> {blender_name, kind}`` (kept in state.json)
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from .blender_process import BlenderTransport, StdioTransport
from .storage import SessionStore, utc_now_iso


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class Session:
    """One in-memory session, paired with disk + a live Blender subprocess."""

    def __init__(
        self,
        session_id: str,
        store: SessionStore,
        transport: BlenderTransport,
    ):
        self.id = session_id
        self.store = store
        self.transport = transport
        self.state: dict[str, Any] = store.load_state()
        self.lock = asyncio.Lock()
        self.last_active_at = datetime.now(UTC)

    # ---- Persistence helpers ---------------------------------------------

    def _touch(self) -> None:
        self.last_active_at = datetime.now(UTC)

    def save_state(self) -> None:
        self.store.save_state(self.state)

    def append_history(self, op_type: str, *, snapshot_id: str | None = None, warnings: list[str] | None = None) -> None:
        seq = len(self.state["history"])
        entry = {
            "seq": seq,
            "op_type": op_type,
            "timestamp": utc_now_iso(),
            "snapshot_id": snapshot_id,
            "warnings": warnings or [],
        }
        self.state["history"].append(entry)
        self.state["manifest"]["operations_applied"] = (
            self.state["manifest"].get("operations_applied", 0) + 1
        )
        self.store.append_history(entry)
        self.save_state()

    # ---- Object bookkeeping ----------------------------------------------

    def _objects(self) -> list[dict[str, Any]]:
        return self.state.setdefault("objects", [])

    def add_object(self, mesh_id: str, blender_name: str, kind: str, label: str | None = None) -> None:
        objs = self._objects()
        # Replace existing entry (e.g. import re-uses id)
        objs[:] = [o for o in objs if o["mesh_id"] != mesh_id]
        objs.append(
            {
                "mesh_id": mesh_id,
                "blender_name": blender_name,
                "kind": kind,
                "label": label or mesh_id,
                "created_at": utc_now_iso(),
            }
        )

    def remove_object(self, mesh_id: str) -> None:
        self._objects()[:] = [o for o in self._objects() if o["mesh_id"] != mesh_id]

    def set_active(self, mesh_id: str | None) -> None:
        self.state["active_mesh_id"] = mesh_id

    @property
    def active_mesh_id(self) -> str | None:
        return self.state.get("active_mesh_id")

    # ---- Snapshots --------------------------------------------------------

    async def checkpoint(self, label: str | None = None) -> str:
        snap_id = _new_id("snap")
        await self.transport.call("checkpoint", {"snapshot_id": snap_id})
        self.state.setdefault("snapshots", []).append(
            {
                "id": snap_id,
                "label": label,
                "created_at": utc_now_iso(),
                # Capture object map so we can rebind after a restore.
                "objects": list(self._objects()),
                "active_mesh_id": self.active_mesh_id,
                "points": dict(self.state.get("points_map", {})),
            }
        )
        self.save_state()
        return snap_id

    async def restore(self, snapshot_id: str) -> None:
        snaps = self.state.get("snapshots", [])
        snap = next((s for s in snaps if s["id"] == snapshot_id), None)
        if snap is None:
            raise KeyError(f"unknown snapshot: {snapshot_id}")
        await self.transport.call("restore", {"snapshot_id": snapshot_id})
        # Restore object map from snapshot record.
        self.state["objects"] = list(snap.get("objects", []))
        self.state["active_mesh_id"] = snap.get("active_mesh_id")
        self.state["points_map"] = dict(snap.get("points", {}))
        # Rebind in Blender too.
        await self.transport.call(
            "register_objects",
            {
                "objects": [
                    {"mesh_id": o["mesh_id"], "blender_name": o["blender_name"], "kind": o["kind"]}
                    for o in self.state["objects"]
                ],
                "active_mesh_id": self.state["active_mesh_id"],
                "points": self.state.get("points_map", {}),
            },
        )
        self.save_state()

    # ---- Shutdown ---------------------------------------------------------

    async def shutdown(self) -> None:
        # Best-effort: save canonical state.blend on the way out.
        if self.transport.alive:
            try:
                await self.transport.call("save_state_blend", {}, timeout=15.0)
            except Exception:
                pass
            await self.transport.close()
        self.save_state()


class SessionManager:
    """Singleton holder of all active sessions in this worker process."""

    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()

    async def create(self, *, user_id: str | None = None) -> Session:
        session_id = _new_id("sess")
        store = SessionStore(session_id)
        store.ensure()
        transport = StdioTransport(session_id, store.dir)
        await transport.start()
        session = Session(session_id, store, transport)
        session.state["user_id"] = user_id
        session.save_state()
        async with self._lock:
            self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Session:
        s = self._sessions.get(session_id)
        if s is None:
            raise KeyError(f"unknown session: {session_id}")
        s._touch()
        return s

    def list(self) -> Iterable[str]:
        return list(self._sessions.keys())

    async def remove(self, session_id: str, *, delete_disk: bool = False) -> None:
        s = self._sessions.pop(session_id, None)
        if s is None:
            return
        await s.shutdown()
        if delete_disk:
            s.store.remove()

    async def shutdown_all(self) -> None:
        async with self._lock:
            ids = list(self._sessions.keys())
        for sid in ids:
            try:
                await self.remove(sid)
            except Exception:
                pass


_manager: SessionManager | None = None


def manager() -> SessionManager:
    global _manager
    if _manager is None:
        _manager = SessionManager()
    return _manager
