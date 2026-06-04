'use client';

import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useSessionStore } from '@/lib/store/session';
import { useRuntimeStore } from '@/lib/store/runtime';
import { snapshotCanvasDownsampled } from '@/lib/mesh/snapshot';
import type { CameraState } from '@printable/types';
import { PlaceholderMesh } from './PlaceholderMesh';
import { UploadedMeshes } from './UploadedMeshes';

/** Auto-frame whatever mesh is active. Runs whenever the active mesh id or
 *  its bbox changes — not every frame. Also exposed via a runtime fit nonce
 *  so the HUD's "Frame" button can request a re-fit. */
function CameraFitter() {
  const { camera, controls } = useThree();
  const meshes = useSessionStore((s) => s.meshes);
  const activeId = useSessionStore((s) => s.activeMeshId);
  const fitNonce = useRuntimeStore((s) => s.fitNonce);

  const active = meshes.find((m) => m.id === activeId) ?? meshes[0];
  const bboxKey = active
    ? `${active.id}:${active.boundingBox.min.join(',')}:${active.boundingBox.max.join(',')}:${fitNonce}`
    : `none:${fitNonce}`;

  useEffect(() => {
    if (!active || !controls) return;
    const { min, max } = active.boundingBox;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const span = Math.max(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
      1,
    );
    const fov =
      camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const halfFov = (fov * Math.PI) / 180 / 2;
    const dist = (span * 0.6) / Math.sin(halfFov) * 1.4;
    const dir = new THREE.Vector3(1, 0.75, 1).normalize();
    camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
    camera.lookAt(cx, cy, cz);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = Math.max(0.1, span * 0.01);
      camera.far = span * 50;
      camera.updateProjectionMatrix();
    }
    const c = controls as unknown as { target: THREE.Vector3; update(): void };
    c.target.set(cx, cy, cz);
    c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  return null;
}

function snapshotCamera(camera: THREE.Camera, target: THREE.Vector3): CameraState {
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
    fov,
  };
}

async function registerPointWithWorker(pt: {
  id: string;
  label: string;
  worldPosition: [number, number, number];
  surfaceNormal: [number, number, number];
  meshId: string;
}) {
  // Read store directly to avoid coupling to component lifecycle.
  const state = useSessionStore.getState();
  const workerSessionId = state.workerSessionId;
  if (!workerSessionId) return; // worker not connected; the agent will fall back to mock
  const mesh = state.meshes.find((m) => m.id === pt.meshId);
  if (!mesh?.workerMeshId) return;
  try {
    await fetch('/api/blender/register-point', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workerSessionId,
        point: {
          id: pt.id,
          label: pt.label,
          worldPosition: pt.worldPosition,
          surfaceNormal: pt.surfaceNormal,
          meshId: mesh.workerMeshId,
        },
      }),
    });
  } catch {
    // worker offline; agent still gets the mock and narrates honestly
  }
}

export function Scene() {
  const { camera, controls, gl } = useThree();
  const points = useSessionStore((s) => s.points);
  const addPoint = useSessionStore((s) => s.addPoint);
  const meshes = useSessionStore((s) => s.meshes);

  const hasUploadedMesh = meshes.length > 0;

  function dropPoint(event: ThreeEvent<MouseEvent>, meshId: string) {
    event.stopPropagation();
    const target =
      controls && 'target' in controls
        ? (controls as unknown as { target: THREE.Vector3 }).target
        : new THREE.Vector3(0, 0, 0);
    const p = event.point;
    const n = event.face?.normal ?? new THREE.Vector3(0, 1, 0);

    // Snapshot what the user is looking at right now — this becomes the
    // point's visual anchor for the agent. The Canvas has
    // preserveDrawingBuffer=true and frameloop='always', so the GL canvas
    // already holds a current frame; we DON'T force gl.render() (that was
    // confusing r3f's scheduler and leaving the viewport blank).
    let snapshot: string | undefined;
    try {
      snapshot = snapshotCanvasDownsampled(gl.domElement, 800);
    } catch {
      // toDataURL can throw on tainted canvases — degrade gracefully.
    }

    const pt = addPoint({
      worldPosition: [p.x, p.y, p.z],
      surfaceNormal: [n.x, n.y, n.z],
      meshId,
      cameraState: snapshotCamera(camera, target),
      ...(snapshot ? { viewportSnapshot: snapshot } : {}),
    });

    // Fire-and-forget: register the point with the Blender worker so the
    // agent's apply_operation calls that reference @pN can resolve it.
    // We reuse the web id as the worker id — no translation needed.
    void registerPointWithWorker(pt);
  }

  return (
    <group>
      {!hasUploadedMesh && <PlaceholderMesh onDoubleClick={(e) => dropPoint(e, 'placeholder')} />}
      {hasUploadedMesh && <UploadedMeshes onDoubleClick={dropPoint} />}
      <CameraFitter />

      {/* Points are rendered OUTSIDE Bounds — we want their absolute world
          positions on the (possibly-scaled-into-view) mesh, not bounds-
          influenced positions. */}
      {points.map((pt) => {
        // The sphere sits exactly on the surface; the label hovers slightly
        // out along the surface normal so it visually sits "above" the
        // marker rather than inside it. Scaled to ~1% of the larger mesh
        // dimension so it stays appropriate across cube-sized and arm-sized
        // meshes.
        const dynamicScale = Math.max(
          ...(meshes[0]?.boundingBox
            ? [
                meshes[0].boundingBox.max[0] - meshes[0].boundingBox.min[0],
                meshes[0].boundingBox.max[1] - meshes[0].boundingBox.min[1],
                meshes[0].boundingBox.max[2] - meshes[0].boundingBox.min[2],
              ]
            : [2]),
        ) * 0.01;
        const sphereR = Math.max(dynamicScale, 0.03);
        const labelOffset = sphereR * 2.5;
        const [nx, ny, nz] = pt.surfaceNormal;
        const labelPos: [number, number, number] = [
          pt.worldPosition[0] + nx * labelOffset,
          pt.worldPosition[1] + ny * labelOffset,
          pt.worldPosition[2] + nz * labelOffset,
        ];
        return (
          <group key={pt.id}>
            <mesh position={pt.worldPosition}>
              <sphereGeometry args={[sphereR, 20, 20]} />
              <meshStandardMaterial
                color="#6366f1"
                emissive="#6366f1"
                emissiveIntensity={0.4}
              />
            </mesh>
            <group position={labelPos}>
              <Html distanceFactor={8} center zIndexRange={[20, 0]}>
                <div className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-indigo-600 text-white shadow-md select-none pointer-events-none whitespace-nowrap">
                  @{pt.label}
                </div>
              </Html>
            </group>
          </group>
        );
      })}
    </group>
  );
}
