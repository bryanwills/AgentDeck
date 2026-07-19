/**
 * SVG pixmap renderer for the Usage Dial (E3).
 * 200x100, #0f172a bg. Shows rate limit gauges, token counts, cost.
 * Follows shared encoder design: 14px bold header, 2px accent bar at y=90.
 */
import { formatTokens, type UsageModeData } from '../utility-modes/usage.js';

const W = 200;
const H = 100;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgWrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
}


/** Shared accent bar: 2px at y=90, x=10..190 with dark bg + colored fill */
function accentBar(color: string, fillRatio = 1): string {
  const barW = Math.max(2, Math.round(180 * fillRatio));
  return `<rect x="10" y="90" width="180" height="2" rx="1" fill="#1e293b"/>
    <rect x="10" y="90" width="${barW}" height="2" rx="1" fill="${color}" opacity="0.4"/>`;
}





/** Session stats: tokens + cost */
export function renderUsageSession(data: UsageModeData): string {
  const inp = formatTokens(data.inputTokens);
  const out = formatTokens(data.outputTokens);
  const cost = data.estimatedCostUsd != null ? `$${data.estimatedCostUsd.toFixed(2)}` : '';
  const dur = data.sessionDurationSec != null ? formatDuration(data.sessionDurationSec) : '';

  return svgWrap(`
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <text x="100" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#94a3b8">SESSION</text>
    <text x="100" y="46" text-anchor="middle" font-family="monospace" font-size="14" fill="#60a5fa">\u25B2${esc(inp)}  \u25BC${esc(out)}</text>
    <text x="100" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#ffffff">${esc(cost || '\u2014')}</text>
    ${dur ? `<text x="100" y="84" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#64748b">${esc(dur)}</text>` : ''}
    ${accentBar('#60a5fa')}
  `);
}




function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m${s > 0 ? ` ${s}s` : ''}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm > 0 ? ` ${rm}m` : ''}`;
}
