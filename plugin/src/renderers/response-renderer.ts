/**
 * SVG pixmap renderers for the Response Dial (option-dial).
 * Follows Voice Dial design pattern: #0f172a bg, header, centered icon/text, accent bar.
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
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

/** IDLE: prompt cycling */
export function renderResponseIdle(prompt: string, index: number, total: number): string {
  const display = escapeXml(truncate(prompt, 22));
  const counter = `${index + 1}/${total}`;
  const accent = '#818cf8';
  const barW = Math.round((180 * (index + 1)) / total);

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">PROMPT</text>
    <text x="190" y="18" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#475569">${counter}</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="${accent}" opacity="0.8">\u26A1</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${accent}" opacity="0.6">${display}</text>
    <rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
    <rect x="10" y="90" width="${Math.max(2, barW)}" height="2" rx="1" fill="${accent}" opacity="0.3"/>
  `);
}

/** PROCESSING: working indicator */
export function renderResponseProcessing(): string {
  const accent = '#f59e0b';

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">PROMPT</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="${accent}" opacity="0.8">\u23F3</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${accent}" opacity="0.6">Working...</text>
    <rect x="60" y="90" width="80" height="2" rx="1" fill="${accent}" opacity="0.2"/>
  `);
}

/** DISCONNECTED */
export function renderResponseDisconnected(): string {
  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#475569">PROMPT</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#475569" opacity="0.5">\u26A1</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#475569">Offline</text>
  `);
}

/** Generic disabled state */
export function renderResponseDisabled(): string {
  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#475569">PROMPT</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#475569" opacity="0.5">\u26A1</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#475569">--</text>
  `);
}

/** IDLE with suggestion: violet-accented autocompletion prompt */
export function renderResponseSuggestion(text: string, index: number, total: number): string {
  const display = escapeXml(truncate(text, 22));
  const counter = `${index + 1}/${total}`;
  const accent = '#a78bfa';
  const headerColor = '#c4b5fd';
  const barW = Math.round((180 * (index + 1)) / total);

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="${headerColor}">SUGGEST</text>
    <text x="190" y="18" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#475569">${counter}</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="${accent}" opacity="0.8">\u2726</text>
    <text x="100" y="78" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${accent}" opacity="0.6">${display}</text>
    <rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
    <rect x="10" y="90" width="${Math.max(2, barW)}" height="2" rx="1" fill="${accent}" opacity="0.3"/>
  `);
}

/** Interactive option/permission/diff (non-takeover fallback) */
export function renderResponseInteractive(
  label: string,
  index: number,
  total: number,
  headerText: string,
  headerColor: string,
  barColor: string,
): string {
  const display = escapeXml(truncate(label, 20));
  const counter = `${index + 1}/${total}`;
  const barW = Math.round((180 * (index + 1)) / total);

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="${headerColor}">${headerText}</text>
    <text x="190" y="18" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#475569">${counter}</text>
    <text x="100" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#e2e8f0">${display}</text>
    <rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
    <rect x="10" y="90" width="${Math.max(2, barW)}" height="2" rx="1" fill="${barColor}" opacity="0.8"/>
  `);
}
