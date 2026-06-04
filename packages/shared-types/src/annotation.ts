import type { CameraState } from './point.js';

export interface DrawingAnnotation {
  id: string;
  label: string;
  cameraState: CameraState;
  imagePngDataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}
