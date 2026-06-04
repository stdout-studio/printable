'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import type { CameraState } from '@printable/types';
import { useRuntimeStore } from '@/lib/store/runtime';

/**
 * Internal Canvas component. Wires useThree-only state (camera, GL renderer)
 * into the runtime store so HUD buttons outside the Canvas can capture a
 * camera lock or snapshot the framebuffer without props-drilling refs.
 */
export function CameraSync() {
  const { camera, controls, gl } = useThree();
  const setCaptureFns = useRuntimeStore((s) => s.setCaptureFns);

  useEffect(() => {
    const captureCameraState = (): CameraState => {
      const target =
        controls && 'target' in controls
          ? (controls as unknown as { target: THREE.Vector3 }).target
          : new THREE.Vector3(0, 0, 0);
      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [target.x, target.y, target.z],
        up: [camera.up.x, camera.up.y, camera.up.z],
        fov,
      };
    };

    const captureGlSnapshot = (): string => {
      // The Canvas was created with preserveDrawingBuffer: true so this works.
      // Force a render first to ensure the buffer matches the visible frame.
      gl.render(gl.xr.getCamera ? gl.xr.getCamera() : camera, gl.xr.getCamera ? gl.xr.getCamera() as unknown as THREE.Camera : camera);
      return gl.domElement.toDataURL('image/png');
    };

    setCaptureFns(captureCameraState, captureGlSnapshot);
    return () => setCaptureFns(null, null);
  }, [camera, controls, gl, setCaptureFns]);

  return null;
}
