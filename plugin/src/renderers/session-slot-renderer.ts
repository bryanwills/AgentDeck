/**
 * Session slot button SVG renderer for v4 dynamic layout.
 *
 * Renders: session list buttons, detail view info/options/nav buttons.
 * 144x144 canvas matching SD+ button spec.
 */
import type { SessionInfo, PromptOption, AgentType } from '@agentdeck/shared';
import { State } from '@agentdeck/shared';
import type { SessionSlotConfig } from '../session-slot-manager.js';
import { agentLogoWatermark } from './agent-logos.js';
import { wrapTextByWidth, measureTextWidth } from './text-utils.js';

const SIZE = 144;
const MAX_TEXT_PX = 124; // 144 - 10px padding each side

// State colors
const STATE_COLORS: Record<string, string> = {
  idle: '#22c55e',        // green
  processing: '#eab308',  // yellow
  awaiting_option: '#f97316',    // orange
  awaiting_permission: '#ef4444', // red
  awaiting_diff: '#f97316',      // orange
  disconnected: '#6b7280', // gray
};

function stateColor(state?: string): string {
  if (!state) return STATE_COLORS.disconnected;
  return STATE_COLORS[state] ?? STATE_COLORS.idle;
}

function stateLabel(state?: string): string {
  if (!state) return 'OFFLINE';
  switch (state) {
    case 'idle': return 'IDLE';
    case 'processing': return 'WORKING';
    case 'awaiting_option':
    case 'awaiting_permission':
    case 'awaiting_diff':
      return 'AWAITING';
    default: return state.toUpperCase();
  }
}

function agentLabel(agentType?: AgentType): string {
  switch (agentType) {
    case 'openclaw': return 'OpenClaw';
    case 'codex-cli': return 'Codex CLI';
    case 'opencode': return 'OpenCode';
    default: return 'Claude Code';
  }
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

// ---- Session List Button ----

export function renderSessionSlot(
  session: SessionInfo,
  isActive: boolean,
  animFrame: number,
): string {
  const isAwaiting = session.state?.startsWith('awaiting') ?? false;
  const sColor = stateColor(session.state);
  const bgColor = isActive ? '#1e3a5f' : (isAwaiting ? '#2d1810' : '#1a1a2e');

  // Agent type label
  const agentText = agentLabel(session.agentType as AgentType);
  const agentFontSize = 11;

  // Project name (main text, bold)
  const projectName = truncate(session.projectName, 16);
  const projFontSize = projectName.length > 10 ? 16 : 20;

  // Model name
  const modelText = session.modelName ? truncate(session.modelName, 16) : '';
  const modelFontSize = 12;

  // State indicator
  const stateLbl = stateLabel(session.state);

  // Agent watermark (low opacity background)
  const watermark = agentLogoWatermark(
    (session.agentType as AgentType) || 'claude-code',
    sColor,
    0.06,
  );

  // AWAITING pulse glow border
  let glowBorder = '';
  if (isAwaiting) {
    const pulseOpacity = 0.4 + 0.5 * Math.abs(Math.sin(animFrame * 0.15));
    glowBorder = [
      `<defs><filter id="pg" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter></defs>`,
      `<rect x="2" y="2" width="140" height="140" rx="11" fill="none" stroke="${sColor}" stroke-width="2.5" opacity="${pulseOpacity.toFixed(2)}" filter="url(#pg)"/>`,
      `<rect x="2" y="2" width="140" height="140" rx="11" fill="none" stroke="${sColor}" stroke-width="1.5" opacity="${(pulseOpacity * 0.8).toFixed(2)}"/>`,
    ].join('');
  }

  // Active indicator (thin left border)
  const activeBorder = isActive
    ? `<rect x="0" y="16" width="3" height="112" rx="1.5" fill="#3b82f6" opacity="0.8"/>`
    : '';

  const elements = [
    watermark,
    glowBorder,
    activeBorder,
    // Agent type (top)
    `<text x="72" y="28" text-anchor="middle" font-family="Arial,sans-serif" font-size="${agentFontSize}" fill="${sColor}" opacity="0.7">${escXml(agentText)}</text>`,
    // Project name (center)
    `<text x="72" y="${56 + (projFontSize > 16 ? 0 : 4)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${projFontSize}" font-weight="bold" fill="#ffffff">${escXml(projectName)}</text>`,
    // Model name
    modelText ? `<text x="72" y="80" text-anchor="middle" font-family="Arial,sans-serif" font-size="${modelFontSize}" fill="#94a3b8">${escXml(modelText)}</text>` : '',
    // State dot + label
    `<circle cx="42" cy="${106}" r="4" fill="${sColor}"/>`,
    `<text x="50" y="110" font-family="Arial,sans-serif" font-size="12" font-weight="600" fill="${sColor}">${escXml(stateLbl)}</text>`,
  ].join('');

  return svgFrame(bgColor, elements);
}

// ---- Empty Slot ----

export function renderEmptySlot(): string {
  const label = `<text x="72" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#333333">Empty</text>`;
  return svgFrame('#111111', label);
}

export function renderNoDaemonSlot(slot: number): string {
  // Only show message on first slot, rest are dark
  if (slot === 0) {
    const elements = [
      `<text x="72" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#ef4444">NO DAEMON</text>`,
      `<text x="72" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#6b7280">Run:</text>`,
      `<text x="72" y="92" text-anchor="middle" font-family="monospace,sans-serif" font-size="10" fill="#94a3b8">agentdeck daemon start</text>`,
    ].join('');
    return svgFrame('#1a0a0a', elements);
  }
  return svgFrame('#111111', '');
}

// ---- Navigation Buttons ----

export function renderBackButton(): string {
  const arrow = `<text x="72" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" fill="#94a3b8">\u2190</text>`;
  const label = `<text x="72" y="100" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="#94a3b8">BACK</text>`;
  return svgFrame('#1a1a1a', arrow + label);
}

export function renderNextPageButton(pageLabel: string): string {
  const arrow = `<text x="72" y="64" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#60a5fa">\u25B6</text>`;
  const label = `<text x="72" y="92" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="#60a5fa">NEXT</text>`;
  const page = `<text x="72" y="114" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#64748b">${escXml(pageLabel)}</text>`;
  return svgFrame('#1a1a2e', arrow + label + page);
}

export function renderEscButton(): string {
  const icon = `<text x="72" y="64" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#f97316">\u2716</text>`;
  const label = `<text x="72" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#f97316">ESC</text>`;
  return svgFrame('#2d1810', icon + label);
}

export function renderStopButton(): string {
  const icon = `<text x="72" y="64" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#ef4444">\u25A0</text>`;
  const label = `<text x="72" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#ef4444">STOP</text>`;
  return svgFrame('#2d1010', icon + label);
}

// ---- Detail View: Session Info ----

export function renderDetailInfo(session: SessionInfo | undefined, state: State, tool?: string, modelName?: string, mode?: string): string {
  if (!session) return renderEmptySlot();

  const sColor = stateColor(session.state);
  const agentText = agentLabel(session.agentType as AgentType);
  const stateLbl = stateLabel(session.state);

  const elements = [
    // Agent type
    `<text x="72" y="24" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="${sColor}" opacity="0.8">${escXml(agentText)}</text>`,
    // Project name (bold, large)
    `<text x="72" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="bold" fill="#ffffff">${escXml(truncate(session.projectName, 14))}</text>`,
    // Model
    modelName ? `<text x="72" y="72" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#94a3b8">${escXml(truncate(modelName, 18))}</text>` : '',
    // Mode
    mode && mode !== 'default' ? `<text x="72" y="90" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#a78bfa">${escXml(mode.toUpperCase())}</text>` : '',
    // Tool (if processing)
    tool ? `<text x="72" y="108" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#fbbf24">\u25B6 ${escXml(truncate(tool, 16))}</text>` : '',
    // State
    `<circle cx="42" cy="130" r="4" fill="${sColor}"/>`,
    `<text x="50" y="134" font-family="Arial,sans-serif" font-size="12" font-weight="600" fill="${sColor}">${escXml(stateLbl)}</text>`,
  ].join('');

  return svgFrame('#0f172a', elements);
}

// ---- Detail View: Option Button ----

export function renderOptionButton(option: PromptOption, index: number): string {
  const label = option.label || `Option ${index + 1}`;
  const lines = wrapTextByWidth(label, MAX_TEXT_PX, 16);
  const lineHeight = 20;
  const startY = lines.length === 1 ? 76 : 76 - ((lines.length - 1) * lineHeight) / 2;

  // Slot number (top-right)
  const slotNum = `<text x="${SIZE - 10}" y="18" text-anchor="end" font-family="Arial,sans-serif" font-size="13" fill="#ffffff" opacity="0.25">${index + 1}</text>`;

  const textEls = lines.slice(0, 3).map((line, i) =>
    `<text x="72" y="${startY + i * lineHeight}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${escXml(line)}</text>`
  ).join('');

  // Use different bg colors for visual distinction
  const colors = ['#1e3a5f', '#1e3a4a', '#2a1e4a', '#1e4a3a', '#3a1e2a'];
  const bgColor = colors[index % colors.length];

  return svgFrame(bgColor, slotNum + textEls);
}

// ---- Detail View: Info slot (tool, model/mode) ----

export function renderInfoSlot(label: string, subtitle?: string): string {
  const mainEl = `<text x="72" y="${subtitle ? 68 : 76}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#94a3b8">${escXml(truncate(label, 18))}</text>`;
  const subEl = subtitle
    ? `<text x="72" y="92" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#64748b">${escXml(truncate(subtitle, 22))}</text>`
    : '';
  return svgFrame('#1a1a1a', mainEl + subEl);
}

// ---- SVG Frame ----

function svgFrame(bgColor: string, innerElements: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="12" fill="${bgColor}"/>`,
    innerElements,
    `</svg>`,
  ].join('');
}
