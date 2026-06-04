"""Talk to a long-lived ``blender --background`` subprocess.

For v0 (local demo) we use stdin/stdout line-delimited JSON-RPC. The research
spec calls for Unix domain sockets in production for sharing one worker across
HTTP processes, but locally that's overkill — one worker process per session,
one subprocess per worker, owned end-to-end.

``BlenderTransport`` is the abstract interface — when we swap to sockets, we
write a new implementation and the sessions code is unchanged.
"""

from __future__ import annotations

import abc
import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

BLENDER_BIN = os.environ.get("BLENDER_BIN", "/opt/homebrew/bin/blender")
BOOT_TIMEOUT_S = 30.0
CALL_TIMEOUT_S = 60.0  # generous to allow boolean_diff on real meshes


class TransportError(RuntimeError):
    pass


class TransportTimeout(TransportError):
    pass


class TransportClosed(TransportError):
    pass


class BlenderTransport(abc.ABC):
    """Speak JSON-RPC with one Blender backend, whatever the wire is."""

    @abc.abstractmethod
    async def start(self) -> None: ...

    @abc.abstractmethod
    async def call(self, method: str, params: dict | None = None, *, timeout: float | None = None) -> Any: ...

    @abc.abstractmethod
    async def close(self) -> None: ...

    @property
    @abc.abstractmethod
    def alive(self) -> bool: ...


class StdioTransport(BlenderTransport):
    """One ``blender --background --python blender_script.py`` per instance."""

    def __init__(self, session_id: str, session_dir: Path, *, blender_bin: str | None = None):
        self.session_id = session_id
        self.session_dir = session_dir
        self.blender_bin = blender_bin or BLENDER_BIN
        self._proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()  # serialize requests; Blender is single-threaded
        self._stderr_task: asyncio.Task | None = None
        self._stderr_buf: list[str] = []

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def start(self) -> None:
        if not shutil.which(self.blender_bin) and not Path(self.blender_bin).exists():
            raise TransportError(f"blender binary not found: {self.blender_bin}")

        script = Path(__file__).resolve().parent / "blender_script.py"
        self.session_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            self.blender_bin,
            "--background",
            "--factory-startup",
            "--python-use-system-env",
            "--python",
            str(script),
            "--",
            f"--session-id={self.session_id}",
            f"--session-dir={self.session_dir}",
        ]

        # asyncio's default StreamReader limit is 64 KB. Single JSON-RPC responses
        # can carry base64'd PNGs (a few MB) and STL bytes (tens of MB). Bump to 256 MB.
        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(Path(__file__).resolve().parent.parent),  # apps/blender-worker
            limit=256 * 1024 * 1024,
        )
        self._stderr_task = asyncio.create_task(self._drain_stderr())

        # Wait for the boot greeting.
        try:
            boot = await asyncio.wait_for(self._read_response(), timeout=BOOT_TIMEOUT_S)
        except TimeoutError as e:
            await self._kill()
            tail = "\n".join(self._stderr_buf[-60:])
            raise TransportTimeout(
                f"blender boot timed out after {BOOT_TIMEOUT_S}s\n--- stderr tail ---\n{tail}"
            ) from e
        if not boot.get("ok"):
            raise TransportError(f"blender boot reported error: {boot}")

    async def _drain_stderr(self) -> None:
        assert self._proc is not None
        stderr = self._proc.stderr
        if stderr is None:
            return
        try:
            while True:
                line = await stderr.readline()
                if not line:
                    return
                text = line.decode("utf-8", errors="replace").rstrip()
                # Keep only a recent tail for diagnostics; let it bound memory.
                self._stderr_buf.append(text)
                if len(self._stderr_buf) > 500:
                    self._stderr_buf = self._stderr_buf[-300:]
        except Exception:
            pass

    async def _read_response(self) -> dict:
        """Read one JSON-RPC response line from stdout."""
        assert self._proc is not None and self._proc.stdout is not None
        while True:
            line = await self._proc.stdout.readline()
            if not line:
                raise TransportClosed("blender stdout closed unexpectedly")
            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue
            # Anything that isn't valid JSON came from Blender chatter that
            # somehow leaked to stdout — log and skip.
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                self._stderr_buf.append(f"[non-json stdout] {text}")
                continue

    async def call(
        self, method: str, params: dict | None = None, *, timeout: float | None = None
    ) -> Any:
        if not self.alive:
            raise TransportClosed("blender subprocess is not running")
        rid = uuid.uuid4().hex[:12]
        msg = json.dumps({"id": rid, "method": method, "params": params or {}}) + "\n"

        async with self._lock:
            assert self._proc is not None and self._proc.stdin is not None
            try:
                self._proc.stdin.write(msg.encode())
                await self._proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as e:
                raise TransportClosed(f"write failed: {e}") from e

            try:
                resp = await asyncio.wait_for(
                    self._read_response(), timeout=timeout or CALL_TIMEOUT_S
                )
            except TimeoutError as e:
                tail = "\n".join(self._stderr_buf[-40:])
                raise TransportTimeout(
                    f"call {method!r} timed out after {timeout or CALL_TIMEOUT_S}s\n--- stderr tail ---\n{tail}"
                ) from e

        if resp.get("id") and resp["id"] != rid:
            # Shouldn't happen with a single in-flight request, but be defensive.
            raise TransportError(f"response id mismatch: got {resp.get('id')!r} expected {rid!r}")
        if not resp.get("ok"):
            err = resp.get("error", "unknown")
            tb = resp.get("traceback")
            full = err if not tb else f"{err}\n---\n{tb}"
            raise TransportError(full)
        return resp.get("result")

    async def _kill(self) -> None:
        if self._proc is None:
            return
        if self._proc.returncode is None:
            try:
                self._proc.kill()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=5.0)
        except TimeoutError:
            pass

    async def close(self) -> None:
        if self._proc is None:
            return
        try:
            if self._proc.stdin and not self._proc.stdin.is_closing():
                self._proc.stdin.close()
        except Exception:
            pass
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=10.0)
        except TimeoutError:
            await self._kill()
        finally:
            if self._stderr_task:
                self._stderr_task.cancel()
                try:
                    await self._stderr_task
                except (asyncio.CancelledError, Exception):
                    pass

    @property
    def stderr_tail(self) -> str:
        return "\n".join(self._stderr_buf[-40:])
