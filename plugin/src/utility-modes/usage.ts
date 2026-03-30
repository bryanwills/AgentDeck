/**
 * Usage utility mode — shows 5h/7d rate limit gauges on encoder LCD.
 * Rotate cycles pages (5h, 7d, session, extra). Push refreshes data.
 */
import type { UtilityMode, RefreshCallback } from './types.js';

export interface UsageModeData {
  fiveHourPercent?: number;
  fiveHourResetsAt?: string;
  sevenDayPercent?: number;
  sevenDayResetsAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  sessionDurationSec?: number;
  extraUsageEnabled?: boolean;
  extraUsageUtilization?: number;
}

const PAGES = ['5h', '7d', 'session', 'extra'] as const;
type UsagePage = typeof PAGES[number];

let sharedData: UsageModeData = {};
let onRefreshRequest: (() => void) | null = null;

/** Update shared usage data (called from plugin.ts on usage_update). */
export function updateUsageModeData(data: UsageModeData): void {
  sharedData = { ...sharedData, ...data };
}

/** Set callback for refresh request (query_usage). */
export function setUsageRefreshCallback(cb: () => void): void {
  onRefreshRequest = cb;
}

function gaugeBar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function formatResetTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = d.getTime() - now;
    if (diff <= 0) return 'now';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  } catch { return ''; }
}

function formatTokens(n?: number): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function createUsageMode(refresh: RefreshCallback): UtilityMode {
  let pageIdx = 0;

  return {
    id: 'usage',
    label: 'USAGE',

    async onRotate(ticks: number) {
      pageIdx = (pageIdx + ticks + PAGES.length) % PAGES.length;
      refresh();
    },

    async onPush() {
      onRefreshRequest?.();
      refresh();
    },

    getFeedback() {
      const page = PAGES[pageIdx];
      let title = '';
      let value = '';
      let icon = '';
      let barColor = '#60a5fa';

      switch (page) {
        case '5h': {
          const pct = sharedData.fiveHourPercent ?? 0;
          const reset = formatResetTime(sharedData.fiveHourResetsAt);
          title = '5H LIMIT';
          icon = gaugeBar(pct);
          value = `${Math.round(pct)}%${reset ? ` \u00B7 ${reset}` : ''}`;
          barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#eab308' : '#22c55e';
          break;
        }
        case '7d': {
          const pct = sharedData.sevenDayPercent ?? 0;
          const reset = formatResetTime(sharedData.sevenDayResetsAt);
          title = '7D LIMIT';
          icon = gaugeBar(pct);
          value = `${Math.round(pct)}%${reset ? ` \u00B7 ${reset}` : ''}`;
          barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#eab308' : '#22c55e';
          break;
        }
        case 'session': {
          const inp = formatTokens(sharedData.inputTokens);
          const out = formatTokens(sharedData.outputTokens);
          const cost = sharedData.estimatedCostUsd != null
            ? `$${sharedData.estimatedCostUsd.toFixed(2)}`
            : '';
          title = 'SESSION';
          icon = `\u25B2${inp} \u25BC${out}`;
          value = cost || '-';
          barColor = '#60a5fa';
          break;
        }
        case 'extra': {
          if (!sharedData.extraUsageEnabled) {
            title = 'EXTRA';
            value = 'disabled';
            barColor = '#6b7280';
          } else {
            const pct = sharedData.extraUsageUtilization ?? 0;
            title = 'EXTRA USAGE';
            icon = gaugeBar(pct);
            value = `${Math.round(pct)}%`;
            barColor = pct > 80 ? '#ef4444' : '#60a5fa';
          }
          break;
        }
      }

      return {
        canvas: buildLcdSvg(title, icon, value, barColor),
      };
    },

    async onActivate() {},
    onDeactivate() {},
  };
}

function buildLcdSvg(title: string, icon: string, value: string, barColor: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `data:image/svg+xml,${encodeURIComponent([
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
    '<rect width="200" height="100" fill="#0f172a"/>',
    `<text x="100" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">${esc(title)}</text>`,
    icon ? `<text x="100" y="50" text-anchor="middle" font-family="monospace,sans-serif" font-size="14" fill="${barColor}">${esc(icon)}</text>` : '',
    `<text x="100" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#ffffff">${esc(value)}</text>`,
    `<rect x="0" y="96" width="200" height="4" rx="2" fill="${barColor}" opacity="0.6"/>`,
    '</svg>',
  ].join(''))}`;
}
