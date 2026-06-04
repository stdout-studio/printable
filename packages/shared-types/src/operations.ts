// Operation surface. Mirrored by `apps/blender-worker/src/schemas.py`.
// If you add/change an op here, mirror it on the Python side in the same PR.

export type BooleanSolver = 'EXACT' | 'FAST';
export type FdmFit = 'press' | 'clearance' | 'free';
export type CutterOperation = 'cut' | 'emboss' | 'placeholder';
export type EdgeRegion = number[] | 'all';

export interface OperationBase {
  meshId: string;
}

export interface BooleanDiff extends OperationBase {
  type: 'boolean_diff';
  cutterMeshId: string;
  solver?: BooleanSolver;
  useSelf?: boolean;
  useHoleTolerant?: boolean;
  fdmToleranceMm?: number;
  keepCutter?: boolean;
}

export interface BooleanUnion extends OperationBase {
  type: 'boolean_union';
  otherMeshId: string;
  solver?: BooleanSolver;
  useSelf?: boolean;
  useHoleTolerant?: boolean;
  keepOther?: boolean;
}

export interface AddCylinderAtPoint extends OperationBase {
  type: 'add_cylinder_at_point';
  pointId: string;
  radius: number;
  height: number;
  alongNormal: boolean;
  operation?: CutterOperation;
  fit?: FdmFit;
}

export interface AddBoxAtPoint extends OperationBase {
  type: 'add_box_at_point';
  pointId: string;
  size: [number, number, number];
  alignToNormal: boolean;
  operation?: CutterOperation;
}

export interface ExtrudeFaces extends OperationBase {
  type: 'extrude_faces';
  faceIndices: number[];
  distance: number;
}

export interface FilletEdges extends OperationBase {
  type: 'fillet_edges';
  edgeIndices: EdgeRegion;
  radius: number;
}

export interface ChamferEdges extends OperationBase {
  type: 'chamfer_edges';
  edgeIndices: EdgeRegion;
  width: number;
}

export interface TransformMesh extends OperationBase {
  type: 'transform_mesh';
  translate: [number, number, number];
  rotateEulerDegrees: [number, number, number];
  scale: [number, number, number];
}

export interface RawBpy extends OperationBase {
  type: 'raw_bpy';
  pythonScript: string;
}

export type VerifyCheck = 'manifold' | 'raycast_hit' | 'min_wall_mm' | 'overhang';

export interface Verify extends OperationBase {
  type: 'verify';
  checks: VerifyCheck[];
  minWallMm?: number;
}

export type BlenderOperation =
  | BooleanDiff
  | BooleanUnion
  | AddCylinderAtPoint
  | AddBoxAtPoint
  | ExtrudeFaces
  | FilletEdges
  | ChamferEdges
  | TransformMesh
  | RawBpy
  | Verify;
