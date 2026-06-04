"""End-to-end smoke test for the Blender worker.

Run with the worker already up::

    # terminal 1
    cd apps/blender-worker
    uv run uvicorn src.main:app --port 8080

    # terminal 2
    uv run python scripts/smoke.py

The flow:
  1. POST /healthz                           → ok
  2. POST /sessions                          → session_id
  3. POST /sessions/{id}/import_mesh         → import a generated 40mm cube STL
  4. POST /sessions/{id}/register_point      → mark POI on top face
  5. POST /sessions/{id}/apply_operation     → add_cylinder_at_point (cut, fit=clearance)
  6. POST /sessions/{id}/measure (bbox_dims) → confirm dimensions reasonable
  7. POST /sessions/{id}/render_preview      → fetch a PNG
  8. POST /sessions/{id}/export_stl          → confirm STL bytes returned
  9. DELETE /sessions/{id}                   → teardown
"""

from __future__ import annotations

import base64
import io
import struct
import sys
from pathlib import Path

import httpx
import numpy as np

WORKER = "http://127.0.0.1:8080"


def write_cube_stl(size_mm: float = 40.0) -> bytes:
    """Return the bytes of a binary STL of an axis-aligned cube centered on the origin."""
    s = size_mm / 2.0
    # 8 cube corners
    c = np.array(
        [
            [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
            [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s],
        ],
        dtype=np.float32,
    )
    # 12 triangles (CCW outward), one per face split into two triangles
    tris = np.array(
        [
            # -Z (bottom)
            [0, 2, 1], [0, 3, 2],
            # +Z (top)
            [4, 5, 6], [4, 6, 7],
            # -Y
            [0, 1, 5], [0, 5, 4],
            # +Y
            [3, 7, 6], [3, 6, 2],
            # -X
            [0, 4, 7], [0, 7, 3],
            # +X
            [1, 2, 6], [1, 6, 5],
        ],
        dtype=np.int32,
    )

    buf = io.BytesIO()
    buf.write(b"\0" * 80)  # header
    buf.write(struct.pack("<I", len(tris)))
    for tri in tris:
        v0, v1, v2 = c[tri[0]], c[tri[1]], c[tri[2]]
        n = np.cross(v1 - v0, v2 - v0)
        nlen = np.linalg.norm(n)
        if nlen:
            n = n / nlen
        buf.write(struct.pack("<3f", *n))
        for v in (v0, v1, v2):
            buf.write(struct.pack("<3f", *v))
        buf.write(b"\0\0")  # attr byte count
    return buf.getvalue()


def fail(msg: str, *, response: httpx.Response | None = None) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    if response is not None:
        print(f"  status: {response.status_code}", file=sys.stderr)
        print(f"  body:   {response.text[:600]}", file=sys.stderr)
    sys.exit(1)


def post(client: httpx.Client, path: str, payload: dict | None = None) -> dict:
    r = client.post(f"{WORKER}{path}", json=payload or {}, timeout=300.0)
    if r.status_code >= 400:
        fail(f"POST {path}", response=r)
    return r.json()


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        # 1. health
        h = client.get(f"{WORKER}/healthz").json()
        assert h.get("status") == "ok", h
        print("[1/9] healthz ok")

        # 2. create session
        sess = post(client, "/sessions", {})
        sid = sess["sessionId"]
        print(f"[2/9] session created: {sid}")
        print(f"      worker_url: {sess['workerUrl']}")

        try:
            # 3. import cube STL
            stl_bytes = write_cube_stl(40.0)
            stl_b64 = base64.b64encode(stl_bytes).decode("ascii")
            imp = post(
                client,
                f"/sessions/{sid}/import_mesh",
                {"stlBase64": stl_b64, "filename": "cube_40mm.stl"},
            )
            mesh_id = imp["meshId"]
            print(f"[3/9] imported {mesh_id}: tris={imp['triCount']} dims={imp['dimsMm']} watertight={imp['isWatertight']}")
            assert imp["triCount"] >= 12, "expected at least 12 triangles for a cube"
            assert imp["isWatertight"], "cube should be watertight"

            # 4. register a point of interest on the top face center
            point_id = "poi_top"
            post(
                client,
                f"/sessions/{sid}/register_point",
                {
                    "id": point_id,
                    "worldPosition": [0.0, 0.0, 20.0],
                    "surfaceNormal": [0.0, 0.0, 1.0],
                    "meshId": mesh_id,
                    "label": "top face center",
                },
            )
            print(f"[4/9] registered POI {point_id}")

            # 5. boolean cut: 8mm-diameter cylinder, 30mm deep, fit=clearance (+0.15mm/side)
            op = {
                "op": {
                    "type": "add_cylinder_at_point",
                    "meshId": mesh_id,
                    "pointId": point_id,
                    "radius": 4.0,
                    "height": 30.0,
                    "alongNormal": True,
                    "operation": "cut",
                    "fit": "clearance",
                }
            }
            res = post(client, f"/sessions/{sid}/apply_operation", op)
            warns = res.get("warnings", [])
            ds = res["diffSummary"]
            print(
                f"[5/9] cylinder cut: tris {ds['triCountBefore']}→{ds['triCountAfter']}, "
                f"ΔV={ds['volumeChangeMm3']:.1f} mm³, watertight={ds['isWatertight']}, warnings={warns}"
            )
            if ds["volumeChangeMm3"] >= 0:
                fail(f"boolean cut did not remove volume: ΔV={ds['volumeChangeMm3']}")
            if ds["triCountAfter"] <= ds["triCountBefore"]:
                # A successful cut adds geometry along the bore.
                fail(
                    f"boolean cut did not add geometry: {ds['triCountBefore']}→{ds['triCountAfter']}"
                )

            # 6. measure: bbox should still be roughly 40 mm
            m = post(
                client, f"/sessions/{sid}/measure", {"kind": "bbox_dims", "meshId": mesh_id}
            )
            print(f"[6/9] bbox_dims: {m.get('dimsMm') or m.get('dims_mm')}")
            dims = m.get("dimsMm") or m.get("dims_mm")
            assert dims is not None
            for d in dims:
                assert 39.0 < d < 41.0, f"unexpected bbox dim: {d}"

            # 7. render
            r = post(
                client,
                f"/sessions/{sid}/render_preview",
                {
                    "cameraPreset": "iso",
                    "width": 512,
                    "height": 512,
                    "style": "solid_engineering",
                    "showAxes": True,
                    "orthographic": False,
                },
            )
            png_b64 = r["pngBase64"]
            png = base64.b64decode(png_b64)
            (out_dir / "smoke_preview.png").write_bytes(png)
            print(
                f"[7/9] rendered {len(png)} bytes PNG → "
                f"{(out_dir / 'smoke_preview.png').as_posix()}"
            )
            assert png.startswith(b"\x89PNG"), "render did not return a PNG"

            # 8. export STL
            ex = post(client, f"/sessions/{sid}/export_stl", {})
            stl_data = base64.b64decode(ex["stlBase64"])
            (out_dir / "smoke_export.stl").write_bytes(stl_data)
            print(
                f"[8/9] exported STL: {ex['byteCount']} bytes, manifold={ex['isManifold']}, "
                f"sha256={ex['sha256'][:16]}…"
            )
            assert ex["byteCount"] > 200, "export STL suspiciously small"

        finally:
            # 9. teardown
            client.delete(f"{WORKER}/sessions/{sid}?delete_disk=false", timeout=30.0)
            print(f"[9/9] session {sid} closed")

    print("\nSMOKE TEST PASSED")


if __name__ == "__main__":
    main()
