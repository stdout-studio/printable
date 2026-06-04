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
              <div className="px-2 py-1 rounded-md text-xs bg-yellow-100 border border-yellow-300 text-yellow-900 shadow-sm">
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
            <meshStandardMaterial
              color={isActive ? '#6366f1' : isContext ? '#9ca3af' : '#94a3b8'}
              roughness={0.55}
              metalness={0.08}
              transparent={isContext}
              opacity={isContext ? 0.55 : 1}
            />
          </mesh>
        );
      })}
    </group>
  );
}
