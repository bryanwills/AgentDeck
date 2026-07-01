/**
 * QR code SVG renderer for Stream Deck buttons.
 * Uses the `qrcode` library's create() for module matrix,
 * then renders directly as SVG path data (no canvas/PNG).
 */
import QRCode from 'qrcode';

const SIZE = 144;
const QUIET_ZONE = 4; // px quiet zone around QR

/** Extract host (+ port if non-standard) from URL for display label */
export function extractUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : '';
    return `${host}${port}`;
  } catch {
    return url.length > 20 ? url.slice(0, 18) + '\u2026' : url;
  }
}

/**
 * Generate SVG path d-attribute for QR code modules.
 * Returns a single <path> d string (efficient — one element for all dark modules).
 */
export function qrPathData(
  text: string,
  cellSize: number,
  offsetX: number,
  offsetY: number,
): { d: string; modules: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;

  let d = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col] & 1) {
        const x = offsetX + col * cellSize;
        const y = offsetY + row * cellSize;
        d += `M${x},${y}h${cellSize}v${cellSize}h${-cellSize}z`;
      }
    }
  }

  return { d, modules: size };
}

/**
 * Render a 144×144 QR code button SVG.
 * Layout: top label (12px) → centered QR → bottom page dots.
 */
export function renderQrButtonSvg(
  url: string,
  label: string,
  pageCount: number,
  pageIndex: number,
  accentColor: string,
): string {
  // Maximize QR size — use full button area minus page dots (bottom 14px)
  const qrAreaTop = 4;
  const qrAreaBottom = SIZE - 14;
  const qrAreaSize = qrAreaBottom - qrAreaTop; // ~126px

  // Generate QR and compute cell size to fit
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size; // e.g. 29 for Version 3
  const cellSize = Math.floor((qrAreaSize - QUIET_ZONE * 2) / modules);
  const qrPx = cellSize * modules;
  const offsetX = Math.floor((SIZE - qrPx) / 2);
  const offsetY = qrAreaTop + Math.floor((qrAreaSize - qrPx) / 2);

  // Build path data
  let d = '';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.modules.data[row * modules + col] & 1) {
        const x = offsetX + col * cellSize;
        const y = offsetY + row * cellSize;
        d += `M${x},${y}h${cellSize}v${cellSize}h${-cellSize}z`;
      }
    }
  }

  // White background behind QR for contrast
  const bgPad = 3;
  const bgX = offsetX - bgPad;
  const bgY = offsetY - bgPad;
  const bgW = qrPx + bgPad * 2;
  const bgH = qrPx + bgPad * 2;

  // Page dots
  const dots = Array.from({ length: pageCount }, (_, i) => {
    const cx = 72 - ((pageCount - 1) * 8) / 2 + i * 8;
    const fill = i === pageIndex ? accentColor : `${accentColor}40`;
    return `<circle cx="${cx}" cy="136" r="3" fill="${fill}"/>`;
  }).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="12" fill="#0c0e10"/>`,
    // White QR background
    `<rect x="${bgX}" y="${bgY}" width="${bgW}" height="${bgH}" rx="3" fill="#ffffff"/>`,
    // QR modules
    `<path d="${d}" fill="#000000"/>`,
    // Page dots
    dots,
    `</svg>`,
  ].join('');
}
