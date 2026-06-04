# Blender Worker Service — Architecture Decision

v1 launch. One path per question.

## 1. Execution model — **(b) Stateful per-session sandbox**

Long-lived `blender --background` per session, JSON-over-socket, idle timeout ~5 min.

Why: the validated workflow is placeholder-first, multi-turn — import STL, drop translucent cylinder, user nudges it, we read coords back, then boolean. 4–10 round trips per edit. Re-paying STL import + `bpy` startup (1.5–3 s) per turn destroys the sub-10 s budget and forces re-deriving POIs, drawings, and camera locks every call. Statefulness *is* the product. Keep `/oneshot` as fallback for thumbnails/validate.

Cap concurrent sessions per worker (4–8), evict idle to disk as `state.blend` + `state.json` + `renders/` + `history.jsonl`, hydrate on resume.

## 2. Deployment target — **Fly.io Machines (v1) → Modal sandboxes (scale)**

Fly Machines suspend in ~1 s, wake in ~1–3 s, bill per-second on shared CPU (~$3–5/mo warm). One Machine maps cleanly to one session = one Blender process = one user's state on local disk. Autostop preserves in-RAM state on resume. Global edge placement, Docker as deploy unit (Blender ~200 MB image, fine).

Why not the others: **Modal** sandboxes are stateless, 2–4 s cold every edit, we'd reupload the `.blend` each call — perfect for *scale* batch renders ($0.000306/vCPU-s, no idle cost) but wrong for our session loop. **Replicate** is GPU-priced, no session affinity. **Cloudflare Containers** lacks a Blender-size image story and per-request persistent disk. **Bare VPS + systemd**: we'd build autoscale/sleep ourselves — defer.

Scale path: shard sessions by `session_id → region` (sticky); offload one-shot renders to Modal.

## 3. HTTP API surface

Next.js → Worker, mTLS + signed session tokens, JSON.

```
POST /sessions                      { user_id }                     → { session_id, worker_url }
POST /sessions/:id/import_mesh      { stl_url | stl_b64 }           → { mesh_id, bbox, dims_mm }
POST /sessions/:id/apply_operation  { op: { type, params } }        → { mesh_id, diff_summary, warnings[] }
POST /sessions/:id/exec_bpy         { code }                        → { result, stdout, raycast? }     # fallback
POST /sessions/:id/place_placeholder{ shape, size_mm, anchor_hint } → { placeholder_id, transform }
POST /sessions/:id/update_transform { id, translate, rotate }       → { transform }
POST /sessions/:id/render_preview   { view, mode, annotate_axes }   → { png_url, camera }
POST /sessions/:id/measure          { type, params }                → { value_mm }
POST /sessions/:id/export_stl       { selection? }                  → { stl_url, sha256, manifold }
POST /sessions/:id/checkpoint       {}                              → { snapshot_id }                  # undo
POST /sessions/:id/restore          { snapshot_id }                 → ok
GET  /sessions/:id/state                                            → POIs, camera locks, drawings, history
DELETE /sessions/:id ; GET /healthz
```

State canonical in the worker `.blend`, mirrored to Postgres JSON for resume across worker restarts.

## 4. Operation surface — **(c) Named-op DSL + raw `bpy` fallback**

Named ops cover the printable use cases; raw `bpy` only when none fit.

Initial set:
- `boolean_diff/union/intersect` — always `solver='EXACT'`, `use_self=True`, `use_hole_tolerant=True` (memory-mandated).
- `add_cylinder_cutter`, `add_box_cutter`, `add_slot_cutter` — FDM offset baked in (`fit='press'|'clearance'|'free'` → +0.0/+0.15/+0.3 mm/side).
- `cable_channel(path, diameter_mm, fit, open_top?)` — sweep along polyline.
- `mounting_hole(point, diameter_mm, depth_mm, countersink?)` — M3/M4 counterbore presets.
- `bracket(face, profile: L|T|gusset, thickness_mm)`.
- `snap_fit_clip(point, axis, span_mm, deflection_mm)`.
- `chamfer_edges`, `fillet_edges`, `text_emboss`, `shell`, `offset_surface`.
- `verify([manifold, min_wall, overhang, raycast_hit])` — runs after every mutation.
- `select_face_by_point`, `select_edge_loop`, `nearest_feature_to(xyz)`.

Every op wraps: pre-checkpoint → validate args → execute → raycast/measure verify → post-checkpoint. **No op trusts the modifier "success" flag** (memory: one of three pockets silently missed in a real session). Raw `exec_bpy` behind a flag, logged separately.

## 5. Safety

Three layers:

1. **OS sandbox** — non-root, read-only rootfs except `/session/<id>`, egress blocked at Fly Machine level (ingress only on API port). Blender Python has no path to the host: `socket`/`urllib`/`subprocess` calls just timeout.
2. **AST denylist** on `exec_bpy` — parse with `ast`, reject `Import` of `os/subprocess/socket/urllib/requests/shutil/ctypes`, reject `open(` outside `/session/<id>`, reject `bpy.app.binary_path`, `bpy.utils.execfile`, `__import__`. Fail closed.
3. **Resource caps** — wall-clock 20 s/call, RSS 1 GB, output mesh ≤ 50 MB. Long ops run in a child eval so a runaway boolean is killable without losing session state (kill, restore last checkpoint).

## 6. Render previews — two presets (1024×1024 PNG, EEVEE)

**`solid_engineering`** (default for review):
```python
space.shading.type = 'SOLID'
space.shading.show_cavity = True
space.shading.cavity_type = 'WORLD'
space.overlay.show_axis_x = True
space.overlay.show_axis_y = True
space.overlay.show_axis_z = annotate_axes
scene.render.film_transparent = True
camera.data.type = 'ORTHO'                # for front/left/top
camera.data.ortho_scale = bbox_max * 1.4
```

**`placeholder_overlay`** (during placement):
```python
body_mat.blend_method = 'BLEND'
body_mat.diffuse_color = (0.8, 0.8, 0.8, 0.55)
cutter_mat.use_nodes = True
cutter_mat.node_tree.nodes['Emission'].inputs['Color'].default_value = (1, 0.4, 0.2, 1)
cutter_mat.blend_method = 'BLEND'
cutter_mat.alpha = 0.55
```

Camera locks: `render_preview` accepts a `lock_id`; the matrix is stored server-side so user drawings overlay 1:1 on subsequent renders. Drawings live as SVG in session JSON, composited by Next.js — not in Blender.

## 7. blender-mcp — reuse the protocol, not the server

**Not directly deployable.** Its `addon.py` is built for a *desktop Blender* — uses `bpy.app.timers.register()` to marshal commands onto the GUI main thread. In `--background`, the main loop exits when the script ends and the socket dies. Keepable with a `while not done: sleep(0.05)` driver, but at that point we've rewritten the server.

Reuse: **protocol shape** (`{"type", "params"}` → `{"status", "result"}`), **`execute_code` namespace pattern** in `addon.py` (`exec(code, {"bpy": bpy, ...})` — harden per §5), and the **handler dispatcher dict** for named-op registration. Files to study: `addon.py` (server loop, dispatch, `execute_code`), `src/blender_mcp/server.py` (MCP↔socket bridge — we replace). Skip `main.py`. Protocol parity makes a future MCP wrapper a one-day job.

---

Sources:
- [blender-mcp](https://github.com/ahujasid/blender-mcp)
- [Modal cold start](https://modal.com/docs/guide/cold-start) · [Modal pricing](https://modal.com/pricing)
- [Fly autostop/autostart](https://fly.io/docs/launch/autostop-autostart/) · [Fly suspend/resume](https://fly.io/docs/reference/suspend-resume/)
- [bpy.app.timers](https://docs.blender.org/api/current/bpy.app.timers.html) · [Blender sockets](https://ciesie.com/post/blender_sockets/) · [Blenderless](https://github.com/oqton/blenderless)
