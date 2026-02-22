/**
 * SVG pixmap renderer for the iTerm Dial.
 * 200×100, #0f172a bg, #06b6d4 accent.
 * Follows Voice Dial design: centered header, centered icon/content, accent bar.
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

/**
 * Word-wrap text into at most maxLines lines, each at most maxChars characters.
 * Single long words are force-broken at maxChars.
 */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    // Force-break words longer than maxChars
    const chunks: string[] = [];
    let remaining = word;
    while (remaining.length > maxChars) {
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    if (remaining) chunks.push(remaining);

    for (const chunk of chunks) {
      if (!current) {
        current = chunk;
      } else if (current.length + 1 + chunk.length <= maxChars) {
        current += ' ' + chunk;
      } else {
        lines.push(current);
        if (lines.length >= maxLines) return lines;
        current = chunk;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export interface ItermRenderData {
  name: string;
  index: number;
  total: number;
}

/** Idle — no sessions active, ready state */
export function renderItermReady(): string {
  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">iTERM</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#67e8f9" opacity="0.8">💻</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#67e8f9" opacity="0.6">No sessions</text>
    <rect x="60" y="90" width="80" height="2" rx="1" fill="#06b6d4" opacity="0.2"/>
  `);
}

/** Active session display — multi-line name if needed */
export function renderItermPanel(data: ItermRenderData): string {
  const { name, index, total } = data;
  const indexLabel = `${index + 1}/${total}`;
  const barW = total > 1 ? Math.round((180 * index) / (total - 1)) : 90;

  // Choose font size and wrap budget based on name length
  const fontSize = name.length <= 14 ? 16 : 14;
  const maxChars = fontSize === 16 ? 17 : 20;
  const lines = wrapText(name, maxChars, 3);

  // Vertical centering: content area y=22..87 (65px), line height = fontSize + 3
  const lineH = fontSize + 3;
  const blockH = lines.length * lineH - 3;
  const startY = Math.round((22 + 87 - blockH) / 2) + fontSize - 2;

  const textSvg = lines
    .map((line, i) =>
      `<text x="100" y="${startY + i * lineH}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="#e2e8f0">${escapeXml(line)}</text>`,
    )
    .join('\n    ');

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">iTERM</text>
    <text x="190" y="18" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#475569">${indexLabel}</text>
    ${textSvg}
    <rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
    <rect x="10" y="90" width="${Math.max(2, barW)}" height="2" rx="1" fill="#06b6d4" opacity="0.6"/>
  `);
}

/** Disconnected / offline */
export function renderItermDisabled(): string {
  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#475569">iTERM</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#475569" opacity="0.5">💻</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#475569">Offline</text>
  `);
}
