export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
}

export interface PointToken {
  id: string;
  label: string;
  worldPosition: [number, number, number];
  surfaceNormal: [number, number, number];
  meshId: string;
  cameraState: CameraState;
  /** PNG (base64, no data: prefix) of the GL canvas at the moment the user
   *  dropped this point. Gives Claude a visual anchor for what the user was
   *  looking at, in addition to the world coords + normal. Optional because
   *  older points (pre-feature) may not have one. */
  viewportSnapshot?: string;
  createdAt: string;
}
