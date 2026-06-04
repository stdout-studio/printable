"""Disk-backed session state.

Layout (one directory per session):

    ~/.printable-worker/sessions/<session_id>/
        state.blend             Blender canonical state (saved on idle / checkpoint)
        state.json              points, transforms, history, manifest
        history.jsonl           append-only op log
        renders/                render preview PNGs (numbered)
        snapshots/              checkpoint .blend files
        meshes/                 imported STL originals (before any edits)

The on-disk state.json is the source of truth across worker restarts. Blender's
in-memory state is hydrated from state.blend on resume.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def worker_root() -> Path:
    """Override-able via ``PRINTABLE_WORKER_HOME`` for tests."""
    env = os.environ.get("PRINTABLE_WORKER_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".printable-worker"


def sessions_root() -> Path:
    return worker_root() / "sessions"


def tmp_root() -> Path:
    """A scratch directory the worker (and AST-validated user code) may write to."""
    p = worker_root() / "tmp"
    p.mkdir(parents=True, exist_ok=True)
    return p


class SessionStore:
    """Filesystem layout + JSON helpers for one session."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.dir = sessions_root() / session_id
        self.renders_dir = self.dir / "renders"
        self.snapshots_dir = self.dir / "snapshots"
        self.meshes_dir = self.dir / "meshes"
        self.state_blend = self.dir / "state.blend"
        self.state_json = self.dir / "state.json"
        self.history_jsonl = self.dir / "history.jsonl"

    def ensure(self) -> None:
        for p in (self.dir, self.renders_dir, self.snapshots_dir, self.meshes_dir):
            p.mkdir(parents=True, exist_ok=True)

    def exists(self) -> bool:
        return self.dir.exists()

    # ---- state.json -------------------------------------------------------

    def load_state(self) -> dict[str, Any]:
        if not self.state_json.exists():
            return self._initial_state()
        return json.loads(self.state_json.read_text())

    def save_state(self, state: dict[str, Any]) -> None:
        self.ensure()
        state["updated_at"] = utc_now_iso()
        self.state_json.write_text(json.dumps(state, indent=2))

    def _initial_state(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "active_mesh_id": None,
            "objects": [],  # [{id, kind: "body"|"cutter"|"placeholder", label, transform}]
            "points": [],
            "snapshots": [],  # [{id, path, created_at, label}]
            "history": [],  # [{seq, op_type, timestamp, snapshot_id, warnings}]
            "manifest": {
                "blender_version": None,
                "operations_applied": 0,
            },
        }

    # ---- history.jsonl ---------------------------------------------------

    def append_history(self, entry: dict[str, Any]) -> None:
        self.ensure()
        with self.history_jsonl.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    # ---- snapshots --------------------------------------------------------

    def snapshot_path(self, snapshot_id: str) -> Path:
        return self.snapshots_dir / f"{snapshot_id}.blend"

    def render_path(self, name: str) -> Path:
        return self.renders_dir / name

    def mesh_path(self, mesh_id: str, ext: str = "stl") -> Path:
        return self.meshes_dir / f"{mesh_id}.{ext}"

    def remove(self) -> None:
        import shutil

        if self.dir.exists():
            shutil.rmtree(self.dir)
