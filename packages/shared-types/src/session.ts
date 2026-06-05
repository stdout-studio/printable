import type { PointToken } from './point.js';
import type { DrawingAnnotation } from './annotation.js';

export type MeshSource = 'lidar_scan' | 'base_stl' | 'generated' | 'reference';

export interface MeshHandle {
  id: string;
  label: string;
  source: MeshSource;
  filename: string;
  triangleCount: number;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  uploadedAt: string;
  /** Set once the mesh has been imported into the Blender worker session.
   *  Operations target this id, not the web-local id. */
  workerMeshId?: string;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatContent =
  | { type: 'text'; text: string }
  // Label is snapshotted at message-submit time so the user's bubble keeps
  // showing @p1 even after the point is cleared from the session at turn end.
  | { type: 'point_ref'; pointId: string; label: string }
  | { type: 'drawing_ref'; annotationId: string; label: string }
  | { type: 'render_preview'; pngDataUrl: string; label?: string };

export interface OpStep {
  toolUseId: string;
  /** Tool name, e.g. "boolean_diff". */
  name: string;
  /** Short mono summary, e.g. "@p1 · r2.5 · cut". */
  detail: string;
  status: 'running' | 'ok' | 'error';
  /** Slimmed input/result for the collapsible raw view (heavy base64 stripped). */
  input?: unknown;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: ChatContent[];
  /** The agent's tool calls for this message, shown as inline operation steps
   *  (the flight-recorder), streamed in as the agent works. */
  ops?: OpStep[];
  createdAt: string;
}

export type IntakeMode =
  | 'attach_to_something'
  | 'edit_base_stl'
  | 'from_picture'
  | 'from_drawing'
  | 'from_scratch';

export interface IntakeState {
  mode: IntakeMode;
  completedAt: string;
}

export interface SessionState {
  id: string;
  createdAt: string;
  intake: IntakeState | null;
  meshes: MeshHandle[];
  points: PointToken[];
  annotations: DrawingAnnotation[];
  messages: ChatMessage[];
  contextMeshId: string | null;
  activeMeshId: string | null;
  /** Blender worker session id — created lazily on first mesh import. */
  workerSessionId: string | null;
}
