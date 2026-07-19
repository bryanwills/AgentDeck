/**
 * SVG pixmap renderer for the Launcher dial (E4).
 * Shares the utility-dial visual grammar: #0f172a bg, header, centred content,
 * accent underline. The position row replaces the retired mode-dots row.
 */

const W = 200;
const H = 100;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgWrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export interface LauncherRenderData {
  /** Agent display name. */
  label: string;
  /** Secondary line describing what the press does. */
  detail: string;
  /** 1-based position within the rolling list. */
  position: number;
  total: number;
}

/** Rendered only if every launch target has been cleared. */
export function renderLauncherEmpty(): string {
  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">LAUNCH</text>
    <text x="100" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#475569">No targets</text>
    <rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
  `);
}

/** Track geometry for the position indicator. */
const TRACK_X = 10;
const TRACK_W = 180;

export function renderLauncher(data: LauncherRenderData): string {
  const { label, detail, position, total } = data;
  const accent = '#818cf8';

  // A moving thumb, NOT a filling gauge. The volume dial's bar fills from the
  // left because it shows a magnitude; this shows which of N discrete entries is
  // selected, so the mark travels along the track instead of growing. Filling
  // here would read as "the launcher is 2/3 full".
  const slots = Math.max(1, total);
  const thumbW = Math.max(12, Math.round(TRACK_W / slots));
  const index = Math.min(Math.max(position - 1, 0), slots - 1);
  // Spread travel across the leftover track so the first entry sits flush left
  // and the last flush right, whatever the thumb width works out to.
  const thumbX = slots > 1
    ? TRACK_X + Math.round(((TRACK_W - thumbW) * index) / (slots - 1))
    : TRACK_X;

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="${accent}">LAUNCH</text>
    <text x="100" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#e2e8f0">${escapeXml(truncate(label, 16))}</text>
    <text x="100" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#94a3b8">${escapeXml(truncate(detail, 26))}</text>
    <text x="186" y="70" text-anchor="end" font-family="Arial,sans-serif" font-size="10" fill="#475569">${position}/${total}</text>
    <rect x="${TRACK_X}" y="90" width="${TRACK_W}" height="2" rx="1" fill="#1e293b"/>
    <rect x="${thumbX}" y="89" width="${thumbW}" height="4" rx="2" fill="${accent}" opacity="0.85"/>
  `);
}
