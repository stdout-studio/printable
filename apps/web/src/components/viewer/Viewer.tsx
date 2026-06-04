'use client';

import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { useRuntimeStore } from '@/lib/store/runtime';
import { CameraSync } from './CameraSync';
import { DrawingOverlay } from './DrawingOverlay';
import { Scene } from './Scene';
import { ViewerHUD } from './ViewerHUD';

export function Viewer() {
  const drawingActive = useRuntimeStore((s) => s.drawing.active);

  return (
    <>
      <Canvas
        shadows
        // `frameloop='always'` — we have intermittent blank-canvas issues
        // when r3f's demand-mode skips a paint right after state changes
        // (mesh upload, point-add, mesh refresh). Constant rendering costs
        // a few % CPU but eliminates the bug. Revisit if it matters.
        frameloop="always"
        camera={{ position: [90, 70, 90], fov: 45, near: 0.5, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#f5f7fa']} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[120, 200, 120]}
            intensity={1.0}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-100}
            shadow-camera-right={100}
            shadow-camera-top={100}
            shadow-camera-bottom={-100}
            shadow-camera-far={500}
          />
          <directionalLight position={[-120, -40, -120]} intensity={0.25} />

          <Scene />
          <CameraSync />

          {/* Grid spans 200 units (200mm) with 1cm cells. Sized for our default
              50mm starter cube — uploads at different scales work too because
              Bounds rescales the view. */}
          <gridHelper args={[200, 20, '#cbd5e1', '#e2e8f0']} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            enabled={!drawingActive}
          />
          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport
              axisColors={['#ef4444', '#22c55e', '#3b82f6']}
              labelColor="white"
            />
          </GizmoHelper>
        </Suspense>
      </Canvas>
      <ViewerHUD />
      <DrawingOverlay />
    </>
  );
}
