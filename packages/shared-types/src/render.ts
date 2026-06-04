// Render request/response shapes. Mirrored by `apps/blender-worker/src/schemas.py`.

import type { CameraState } from './point.js';

export type RenderStyle = 'solid_engineering' | 'solid_cavity' | 'placeholder_overlay';

export type CameraPreset =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'iso'
  | 'current';

export interface RenderRequest {
  // Provide either an explicit camera state or a named preset.
  cameraState?: CameraState;
  cameraPreset?: CameraPreset;
  width: number;
  height: number;
  style: RenderStyle;
  showAxes: boolean;
  orthographic: boolean;
  // Highlight this object as the cutter when style === 'placeholder_overlay'.
  cutterObjectId?: string;
}

export interface RenderResult {
  // Base64-encoded PNG (without the data: prefix). Convert to a data URL on the client.
  pngBase64: string;
  cameraState: CameraState;
  width: number;
  height: number;
}
