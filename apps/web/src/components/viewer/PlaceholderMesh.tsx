'use client';

import type { ThreeEvent } from '@react-three/fiber';

interface Props {
  onDoubleClick: (event: ThreeEvent<MouseEvent>) => void;
}

// Pre-intake decorative mesh. Scaled to ~25mm so it's visible at the same
// camera position used for the 50mm starter cube.
export function PlaceholderMesh({ onDoubleClick }: Props) {
  return (
    <mesh onDoubleClick={onDoubleClick} castShadow receiveShadow position={[0, 15, 0]}>
      <torusKnotGeometry args={[18, 6.5, 220, 32]} />
      <meshPhysicalMaterial
        color="#c9cdd3"
        metalness={0.45}
        roughness={0.38}
        clearcoat={0.35}
        clearcoatRoughness={0.5}
      />
    </mesh>
  );
}
