/**
 * Procedural primitives that produce binary STL bytes — used by the "From
 * scratch" intake flow to seed both the viewer and the Blender worker with
 * a real, editable mesh.
 */

/** Generate a centered cube of side `sizeMm` as a binary STL ArrayBuffer. */
export function generateStarterCubeStl(sizeMm = 50): ArrayBuffer {
  const h = sizeMm / 2;
  // 8 corners of a centered cube.
  const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const A = v(-h, -h, -h);
  const B = v(+h, -h, -h);
  const C = v(+h, +h, -h);
  const D = v(-h, +h, -h);
  const E = v(-h, -h, +h);
  const F = v(+h, -h, +h);
  const G = v(+h, +h, +h);
  const H = v(-h, +h, +h);

  // 12 triangles, with their face normals. CCW winding from the outside.
  const tris: Array<{ n: [number, number, number]; t: [[number, number, number], [number, number, number], [number, number, number]] }> = [
    { n: [0, 0, -1], t: [A, C, B] },
    { n: [0, 0, -1], t: [A, D, C] },
    { n: [0, 0, +1], t: [E, F, G] },
    { n: [0, 0, +1], t: [E, G, H] },
    { n: [-1, 0, 0], t: [A, E, H] },
    { n: [-1, 0, 0], t: [A, H, D] },
    { n: [+1, 0, 0], t: [B, C, G] },
    { n: [+1, 0, 0], t: [B, G, F] },
    { n: [0, -1, 0], t: [A, B, F] },
    { n: [0, -1, 0], t: [A, F, E] },
    { n: [0, +1, 0], t: [D, H, G] },
    { n: [0, +1, 0], t: [D, G, C] },
  ];

  // Binary STL: 80-byte header + uint32 triangle count + 50 bytes per tri.
  const buf = new ArrayBuffer(80 + 4 + tris.length * 50);
  const view = new DataView(buf);
  // Header — anything 80 bytes works; embed something identifying.
  const header = new TextEncoder().encode('Printable starter cube (generated client-side)');
  new Uint8Array(buf, 0, Math.min(80, header.length)).set(header.slice(0, 80));
  view.setUint32(80, tris.length, true);

  let off = 84;
  for (const { n, t } of tris) {
    view.setFloat32(off, n[0], true); off += 4;
    view.setFloat32(off, n[1], true); off += 4;
    view.setFloat32(off, n[2], true); off += 4;
    for (const p of t) {
      view.setFloat32(off, p[0], true); off += 4;
      view.setFloat32(off, p[1], true); off += 4;
      view.setFloat32(off, p[2], true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2; // attribute byte count
  }

  return buf;
}
