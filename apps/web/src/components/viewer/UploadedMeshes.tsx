'use client';

import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useSessionStore } from '@/lib/store/session';
import { useRuntimeStore } from '@/lib/store/runtime';

interface Props {
  onDoubleClick: (event: ThreeEvent<MouseEvent>, meshId: string) => void;
}

/**
 * Renders uploaded meshes from the session.
 * Context meshes (the scanned thing we design *around*) render translucent
 * so the active part being designed remains visually primary.
 */
export function UploadedMeshes({ onDoubleClick }: Props) {
  const meshes = useSessionStore((s) => s.meshes);
  const meshGeometries = useRuntimeStore((s) => s.meshGeometries);
  const contextMeshId = useSessionStore((s) => s.contextMeshId);
  const activeMeshId = useSessionStore((s) => s.activeMeshId);

  return (
    <group>
      {meshes.map((mesh) => {
        const geo = meshGeometries.get(mesh.id);
        const isContext = mesh.id === contextMeshId;
        const isActive = mesh.id === activeMeshId;

        if (!geo) {
          // Geometry not in runtime cache — happens after a page reload since
          // BufferGeometry isn't persisted to localStorage. Show a label so
          // the user knows to re-upload.
          return (
            <Html key={mesh.id} center>
              <div className="px-2 py-1 rounded-md text-xs bg-[var(--bg-elev)] border border-[var(--line-strong)] text-[var(--status-warn)] whitespace-nowrap">
                Re-upload {mesh.label} ({mesh.filename}) — geometry not in cache
              </div>
            </Html>
          );
        }

        return (
          <mesh
            key={mesh.id}
            geometry={geo}
            onDoubleClick={(e) => onDoubleClick(e, mesh.id)}
            castShadow
            receiveShadow
          >
            {/* Brushed-aluminium PBR: the part reads as machined metal. Active
                part is bright graphite; context (the thing we design around) is
                darker + translucent so the part stays primary. */}
            <meshPhysicalMaterial
              color={isContext ? '#6b7079' : isActive ? '#cfd3d9' : '#c9cdd3'}
              metalness={0.45}
              roughness={0.38}
              clearcoat={0.35}
              clearcoatRoughness={0.5}
              transparent={isContext}
              opacity={isContext ? 0.42 : 1}
            />
          </mesh>
        );
      })}
    </group>
  );
}
