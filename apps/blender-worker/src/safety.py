"""AST-based denylist for ``exec_bpy`` user code.

Layered per research §5:

  1. Reject imports of dangerous stdlib modules (os, subprocess, socket, …).
  2. Reject ``__import__``, ``bpy.app.binary_path``, ``bpy.utils.execfile`` access.
  3. Constrain ``open(...)`` to a per-session writable directory.
  4. (Wall-clock cap is enforced by the caller via signal/threading.)

Fail closed: any AST node we don't understand should be rejected.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable
from pathlib import Path

DENIED_IMPORTS = frozenset(
    {
        "os",
        "os.path",
        "subprocess",
        "socket",
        "urllib",
        "urllib.request",
        "urllib.parse",
        "requests",
        "httpx",
        "shutil",
        "ctypes",
        "pathlib",
        "tempfile",
        "pickle",
        "marshal",
        "sys",
        "importlib",
        "fcntl",
        "resource",
        "signal",
        "multiprocessing",
        "threading",
        "asyncio",
        "pty",
    }
)

DENIED_NAMES = frozenset(
    {
        "__import__",
        "compile",
        "eval",
        "exec",
        "globals",
        "locals",
        "vars",
        "input",
        "breakpoint",
        "memoryview",
    }
)

# Attribute chains we don't want — checked via dotted-path matching.
DENIED_ATTRIBUTE_PATHS = frozenset(
    {
        "bpy.app.binary_path",
        "bpy.app.tempdir",
        "bpy.utils.execfile",
        "bpy.utils.user_resource",
        "bpy.utils.script_path_user",
        "bpy.path.abspath",
    }
)


class UnsafeCodeError(ValueError):
    """Raised by ``validate`` when user code is rejected."""


def _dotted_attr(node: ast.AST) -> str | None:
    """Return ``a.b.c`` for an Attribute chain rooted in a Name, else None."""
    parts: list[str] = []
    cur: ast.AST = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
        return ".".join(reversed(parts))
    return None


def validate(code: str, *, allow_open_paths: Iterable[Path] = ()) -> None:
    """Parse code and raise ``UnsafeCodeError`` on any denied construct.

    ``allow_open_paths`` is the set of directory prefixes within which ``open(...)``
    with a string literal first argument is permitted. Non-literal paths are rejected
    (we can't statically verify them).
    """
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as e:
        raise UnsafeCodeError(f"syntax error: {e}") from e

    allow_prefixes = tuple(str(Path(p).resolve()) for p in allow_open_paths)

    for node in ast.walk(tree):
        # 1) Imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in DENIED_IMPORTS or alias.name.split(".")[0] in DENIED_IMPORTS:
                    raise UnsafeCodeError(f"import of {alias.name!r} is not allowed")
        if isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if mod in DENIED_IMPORTS or mod.split(".")[0] in DENIED_IMPORTS:
                raise UnsafeCodeError(f"import from {mod!r} is not allowed")

        # 2) Denied attribute paths and names
        if isinstance(node, ast.Attribute):
            dotted = _dotted_attr(node)
            if dotted and dotted in DENIED_ATTRIBUTE_PATHS:
                raise UnsafeCodeError(f"access to {dotted!r} is not allowed")

        if isinstance(node, ast.Name) and node.id in DENIED_NAMES:
            raise UnsafeCodeError(f"reference to {node.id!r} is not allowed")

        # 3) open(...) constrained to allow_open_paths
        if isinstance(node, ast.Call):
            func = node.func
            func_name: str | None = None
            if isinstance(func, ast.Name):
                func_name = func.id
            elif isinstance(func, ast.Attribute):
                func_name = func.attr

            if func_name == "open":
                if not node.args:
                    raise UnsafeCodeError("open() with no args is not allowed")
                first = node.args[0]
                if not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
                    raise UnsafeCodeError("open() requires a string literal path")
                resolved = str(Path(first.value).resolve())
                if not any(resolved.startswith(p) for p in allow_prefixes):
                    raise UnsafeCodeError(
                        f"open({first.value!r}) is outside the allowed session paths"
                    )

            # Block dynamic attribute access: getattr(bpy, "app").binary_path
            if func_name in {"getattr", "setattr", "delattr"}:
                raise UnsafeCodeError(f"{func_name}() is not allowed in exec_bpy code")
