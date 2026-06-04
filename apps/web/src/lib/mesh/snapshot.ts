'use client';

/**
 * Capture the GL canvas as a downsampled PNG, base64 (no data: prefix).
 * The 3D viewer renders at devicePixelRatio so a raw toDataURL can be 1MB+.
 * Downsampling to ~800px on the long edge keeps each image at ~80-150KB and
 * preserves enough detail for Claude to see geometry, markers, and camera angle.
 */
export function snapshotCanvasDownsampled(
  source: HTMLCanvasElement,
  maxLongEdge = 800,
): string | undefined {
  const sw = source.width;
  const sh = source.height;
  if (sw === 0 || sh === 0) return undefined;

  const scale = Math.min(1, maxLongEdge / Math.max(sw, sh));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  const off = document.createElement('canvas');
  off.width = dw;
  off.height = dh;
  const ctx = off.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, dw, dh);

  try {
    const dataUrl = off.toDataURL('image/png');
    return dataUrl.split(',')[1];
  } catch {
    return undefined;
  }
}
