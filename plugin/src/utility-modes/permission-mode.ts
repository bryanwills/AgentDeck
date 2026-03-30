/**
 * Permission Mode utility mode — shows current Claude Code permission mode on encoder LCD.
 * Push cycles DEFAULT → PLAN → ACCEPT → DEFAULT.
 */
import type { UtilityMode, RefreshCallback } from './types.js';

let currentMode = 'default';
let onSwitchMode: (() => void) | null = null;

/** Update current mode (called from plugin.ts on state_update). */
export function updatePermissionModeData(mode: string): void {
  currentMode = mode;
}

/** Set callback for switch_mode command. */
export function setPermissionModeSwitchCallback(cb: () => void): void {
  onSwitchMode = cb;
}

const MODE_COLORS: Record<string, string> = {
  default: '#64748b',
  plan: '#7c3aed',
  'accept-edits': '#2563eb',
};

const MODE_LABELS: Record<string, string> = {
  default: 'DEFAULT',
  plan: 'PLAN',
  'accept-edits': 'ACCEPT',
};

export function createPermissionModeMode(refresh: RefreshCallback): UtilityMode {
  return {
    id: 'mode',
    label: 'MODE',

    async onRotate(_ticks: number) {
      // No-op — mode is push-only
    },

    async onPush() {
      onSwitchMode?.();
      refresh();
    },

    getFeedback() {
      const color = MODE_COLORS[currentMode] ?? '#64748b';
      const label = MODE_LABELS[currentMode] ?? currentMode.toUpperCase();

      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const svg = `data:image/svg+xml,${encodeURIComponent([
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
        '<rect width="200" height="100" fill="#0f172a"/>',
        '<text x="100" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">MODE</text>',
        `<text x="100" y="64" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="${color}">${esc(label)}</text>`,
        `<rect x="0" y="96" width="200" height="4" rx="2" fill="${color}" opacity="0.6"/>`,
        '</svg>',
      ].join(''))}`;

      return { canvas: svg };
    },

    async onActivate() {},
    onDeactivate() {},
  };
}
