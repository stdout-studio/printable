'use client';

import * as THREE from 'three';
import { OBJLoader, STLLoader } from 'three-stdlib';

export interface LoadedMesh {
  geometry: THREE.BufferGeometry;
  triangleCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  fileSizeBytes: number;
}

// USDZ support deliberately deferred — three-stdlib doesn't ship a USDZ loader,
// and the one in three/examples/jsm needs USDC + fflate parsing infra. iPhone
// scan apps (3D Scanner App, Polycam) all export STL or OBJ as alternates.
const SUPPORTED_EXTENSIONS = ['stl', 'obj'] as const;
type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

function extensionOf(filename: string): SupportedExt {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExt)) {
    throw new Error(
      `Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    );
  }
  return ext as SupportedExt;
}

/** Walks an Object3D tree and returns the first usable mesh geometry.
 *  Multi-mesh OBJ/USDZ files use the first mesh for v0 — full merging
 *  (BufferGeometryUtils.mergeGeometries) is a future improvement when we
 *  actually hit a multi-mesh case in practice. */
function firstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.BufferGeometry) {
      const cloned = obj.geometry.clone();
      cloned.applyMatrix4(obj.matrixWorld);
      found = cloned;
    }
  });
  if (!found) throw new Error('No mesh geometry found in file.');
  return found;
}

function normalizeGeometry(geometry: THREE.BufferGeometry): {
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
} {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Center the mesh at the origin so the OrbitControls target stays sensible.
  // We deliberately keep the scale — real-world mm matter to the agent.
  if (geometry.boundingBox) {
    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingBox();
  }

  return { geometry, bbox: geometry.boundingBox ?? new THREE.Box3() };
}

/** Parse raw STL bytes (binary or ASCII) into a normalized BufferGeometry. */
export function loadMeshFromStlBytes(bytes: ArrayBuffer): LoadedMesh {
  const raw = new STLLoader().parse(bytes);
  const { geometry, bbox } = normalizeGeometry(raw);
  const triangleCount = geometry.index
    ? geometry.index.count / 3
    : (geometry.attributes.position?.count ?? 0) / 3;
  return {
    geometry,
    triangleCount: Math.floor(triangleCount),
    boundingBox: {
      min: [bbox.min.x, bbox.min.y, bbox.min.z],
      max: [bbox.max.x, bbox.max.y, bbox.max.z],
    },
    fileSizeBytes: bytes.byteLength,
  };
}

/** Base64 → ArrayBuffer (binary). */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

export async function loadMeshFromFile(file: File): Promise<LoadedMesh> {
  const ext = extensionOf(file.name);
  const bytes = await file.arrayBuffer();

  let raw: THREE.BufferGeometry;
  if (ext === 'stl') {
    raw = new STLLoader().parse(bytes);
  } else {
    // obj
    const group = new OBJLoader().parse(new TextDecoder().decode(bytes));
    raw = firstMeshGeometry(group);
  }

  const { geometry, bbox } = normalizeGeometry(raw);
  const triangleCount = geometry.index
    ? geometry.index.count / 3
    : (geometry.attributes.position?.count ?? 0) / 3;

  return {
    geometry,
    triangleCount: Math.floor(triangleCount),
    boundingBox: {
      min: [bbox.min.x, bbox.min.y, bbox.min.z],
      max: [bbox.max.x, bbox.max.y, bbox.max.z],
    },
    fileSizeBytes: bytes.byteLength,
  };
}
