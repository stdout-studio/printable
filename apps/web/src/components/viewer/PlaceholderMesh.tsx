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
      <meshStandardMaterial color="#94a3b8" roughness={0.55} metalness={0.08} />
    </mesh>
  );
}
