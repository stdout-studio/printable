// Pure-TypeScript STL parser. Handles both binary and ASCII STL.
//
// We don't need a full mesh representation — just enough to compute:
//   - axis-aligned bounding box
//   - triangle count
//   - volume (signed tetrahedron sum)
//   - watertightness check (rough: every edge shared by exactly 2 tris)
//
// Imports no native deps; works in plain Node 22+.

import { readFileSync } from 'node:fs';

export interface StlSummary {
  triCount: number;
  bbox: { x: number; y: number; z: number };
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  volume: number;
  isWatertight: boolean;
}

const BINARY_HEADER_SIZE = 80;
const BINARY_COUNT_SIZE = 4;
const BINARY_TRI_SIZE = 50; // 12 floats * 4 bytes + 2 attr bytes
const BYTES_PER_FLOAT = 4;

function isBinaryStl(buf: Buffer): boolean {
  // Common heuristic: ASCII files start with "solid " and contain
  // "facet" and "endsolid". Binary files have a header that may
  // coincidentally start with "solid " (some legacy exporters). The
  // robust test: compare actual file size to the size implied by the
  // binary triangle count.
  if (buf.length < BINARY_HEADER_SIZE + BINARY_COUNT_SIZE) return false;
  const triCount = buf.readUInt32LE(BINARY_HEADER_SIZE);
  const expected = BINARY_HEADER_SIZE + BINARY_COUNT_SIZE + triCount * BINARY_TRI_SIZE;
  return buf.length === expected;
}

function parseBinaryStl(buf: Buffer): StlSummary {
  const triCount = buf.readUInt32LE(BINARY_HEADER_SIZE);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let volume6 = 0; // 6 * signed volume

  const edgeCounts = new Map<string, number>();

  let off = BINARY_HEADER_SIZE + BINARY_COUNT_SIZE;
  for (let i = 0; i < triCount; i++) {
    // Skip 3 normal floats (we recompute via vertices)
    off += 3 * BYTES_PER_FLOAT;

    const ax = buf.readFloatLE(off);
    const ay = buf.readFloatLE(off + 4);
    const az = buf.readFloatLE(off + 8);
    off += 12;
    const bx = buf.readFloatLE(off);
    const by = buf.readFloatLE(off + 4);
    const bz = buf.readFloatLE(off + 8);
    off += 12;
    const cx = buf.readFloatLE(off);
    const cy = buf.readFloatLE(off + 4);
    const cz = buf.readFloatLE(off + 8);
    off += 12;
    off += 2; // attribute byte count

    // bbox
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;

    // signed volume of tetrahedron with origin
    volume6 +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);

    // edges (sorted endpoint pairs for watertightness check)
    addEdge(edgeCounts, ax, ay, az, bx, by, bz);
    addEdge(edgeCounts, bx, by, bz, cx, cy, cz);
    addEdge(edgeCounts, cx, cy, cz, ax, ay, az);
  }

  if (triCount === 0) {
    return {
      triCount: 0,
      bbox: { x: 0, y: 0, z: 0 },
      bboxMin: [0, 0, 0],
      bboxMax: [0, 0, 0],
      volume: 0,
      isWatertight: false,
    };
  }

  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count !== 2) nonManifoldEdges++;
  }
  const isWatertight = nonManifoldEdges === 0;

  return {
    triCount,
    bbox: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    bboxMin: [minX, minY, minZ],
    bboxMax: [maxX, maxY, maxZ],
    volume: Math.abs(volume6) / 6,
    isWatertight,
  };
}

function addEdge(
  counts: Map<string, number>,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
): void {
  // Quantize to 1e-4 to tolerate floating point noise. Then sort
  // endpoint pair so the same edge from either direction collides.
  const q = 1e4;
  const ax = Math.round(x1 * q);
  const ay = Math.round(y1 * q);
  const az = Math.round(z1 * q);
  const bx = Math.round(x2 * q);
  const by = Math.round(y2 * q);
  const bz = Math.round(z2 * q);
  const cmp =
    ax !== bx ? ax - bx :
    ay !== by ? ay - by :
    az - bz;
  const key = cmp < 0
    ? `${ax},${ay},${az}|${bx},${by},${bz}`
    : `${bx},${by},${bz}|${ax},${ay},${az}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function parseAsciiStl(text: string): StlSummary {
  // ASCII STL parsing is rare for our pipeline (Thingi10K STLs are
  // overwhelmingly binary) but we support it for robustness.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triCount = 0;
  let volume6 = 0;
  const edgeCounts = new Map<string, number>();

  const vertexRegex = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  const facetRegex = /facet\s+normal[\s\S]*?endfacet/g;

  const facets = text.match(facetRegex);
  if (!facets) {
    return {
      triCount: 0,
      bbox: { x: 0, y: 0, z: 0 },
      bboxMin: [0, 0, 0],
      bboxMax: [0, 0, 0],
      volume: 0,
      isWatertight: false,
    };
  }

  for (const facet of facets) {
    const verts: number[] = [];
    let m: RegExpExecArray | null;
    vertexRegex.lastIndex = 0;
    while ((m = vertexRegex.exec(facet)) !== null) {
      verts.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (verts.length === 9) break;
    }
    if (verts.length < 9) continue;
    triCount++;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = verts as [
      number, number, number, number, number, number, number, number, number,
    ];
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
    if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
    if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
    volume6 +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
    addEdge(edgeCounts, ax, ay, az, bx, by, bz);
    addEdge(edgeCounts, bx, by, bz, cx, cy, cz);
    addEdge(edgeCounts, cx, cy, cz, ax, ay, az);
  }

  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count !== 2) nonManifoldEdges++;
  }
  return {
    triCount,
    bbox: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    bboxMin: [minX, minY, minZ],
    bboxMax: [maxX, maxY, maxZ],
    volume: Math.abs(volume6) / 6,
    isWatertight: nonManifoldEdges === 0,
  };
}

export function summarizeStl(filePath: string): StlSummary {
  const buf = readFileSync(filePath);
  if (isBinaryStl(buf)) return parseBinaryStl(buf);
  return parseAsciiStl(buf.toString('utf-8'));
}
