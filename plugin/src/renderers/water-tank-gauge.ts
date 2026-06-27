/**
 * Water-tank usage gauge — a 144×144 keypad tile (classic Stream Deck / XL).
 *
 * The tank's water level represents the REMAINING quota (100 − usedPercent), so
 * the tank visibly drains as the agent burns through its window. Each tile is
 * self-identifying: the water hue carries the agent brand (Claude = terracotta,
 * Codex = blue) and the top label names the window ("5H"/"7D", or "CX 5H"/"CX 7D"
 * for Codex). A subtle surface-wave line sits at the waterline, the headline
 * percent is the remaining quota, and a reset countdown ("2h13m" / "6d") sits at
 * the bottom. Severity (low REMAINING = warning) is encoded on the headline +
 * tank rim without overriding the agent hue.
 */
import { Brand } from '@agentdeck/shared';
import { formatResetTime } from '../utility-modes/usage.js';

const W = 144;
const H = 144;

// Tank geometry within the 144×144 canvas.
const TANK_X = 42;
const TANK_Y = 32;
const TANK_W = 60;
const TANK_H = 82;

const BG = '#0f172a';
const TANK_EMPTY = '#0b1220';
const RIM = '#33415a';
const RIM_CRITICAL = '#ef4444';
const LABEL_DIM = '#64748b';
const TEXT_HEALTHY = '#f1f5f9';
const TEXT_DIM = '#475569';
const COUNTDOWN = '#94a3b8';

/** Agent-brand water palette (fill + lighter surface highlight). */
const PALETTE: Record<'claude' | 'codex', { water: string; surface: string }> = {
  // Claude terracotta family (Brand.claudeCode = #C07058)
  claude: { water: Brand.claudeCode, surface: '#E0A48F' },
  // Codex blue family (Brand.codex = #6166E0)
  codex: { water: Brand.codex, surface: '#9AA0F4' },
};

export interface WaterTankGaugeData {
  agent: 'claude' | 'codex';
  /** Which rolling window this tile represents (drives the label fallback). */
  window: '5h' | '7d';
  /** Tile label, e.g. "5H", "7D", "CX 5H", "CX 7D". */
  label: string;
  /** Percent of the window already consumed (0–100). */
  usedPercent: number;
  /** ISO-8601 reset instant for the countdown. */
  resetsAt?: string;
  /** False when no live quota exists — draws an empty tank + "—". */
  known?: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgWrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
}

function clampPct(p: number): number {
  return Math.max(0, Math.min(100, p));
}

/** Severity by REMAINING quota: less left = hotter. Keeps the agent hue intact. */
function remainingSeverityColor(remaining: number): string {
  if (remaining <= 15) return '#ef4444'; // critical — almost out
  if (remaining <= 35) return '#eab308'; // warning — running low
  return TEXT_HEALTHY;
}

export function renderWaterTankGauge(data: WaterTankGaugeData): string {
  const known = data.known !== false;
  const agent = data.agent === 'codex' ? 'codex' : 'claude';
  const pal = PALETTE[agent];
  const label = data.label || (agent === 'codex' ? `CX ${data.window.toUpperCase()}` : data.window.toUpperCase());

  const tank = `<rect x="${TANK_X}" y="${TANK_Y}" width="${TANK_W}" height="${TANK_H}" rx="9" fill="${TANK_EMPTY}"/>`;
  const labelEl = `<text x="72" y="20" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="13" font-weight="bold" fill="${known ? pal.water : LABEL_DIM}">${esc(label)}</text>`;

  if (!known) {
    return svgWrap(
      `<rect width="${W}" height="${H}" fill="${BG}"/>` +
      tank +
      `<rect x="${TANK_X}" y="${TANK_Y}" width="${TANK_W}" height="${TANK_H}" rx="9" fill="none" stroke="${RIM}" stroke-width="2.5"/>` +
      labelEl +
      `<text x="72" y="84" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="${TEXT_DIM}">—</text>`,
    );
  }

  const used = clampPct(data.usedPercent);
  const remaining = clampPct(100 - used);
  const waterH = Math.round((TANK_H * remaining) / 100);
  const waterY = TANK_Y + TANK_H - waterH;
  const critical = remaining <= 15;
  const headColor = remainingSeverityColor(remaining);

  // Water body with a wavy top edge. Quadratic bumps give a gentle surface
  // ripple; the body extends to the tank floor and is clipped to the rounded
  // tank so the corners stay clean.
  const seg = TANK_W / 2;
  const amp = remaining > 1 && remaining < 100 ? 3 : 0;
  const surfacePath =
    `M ${TANK_X} ${waterY} q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0`;
  const bodyPath =
    `${surfacePath} L ${TANK_X + TANK_W} ${TANK_Y + TANK_H} L ${TANK_X} ${TANK_Y + TANK_H} Z`;

  const clipId = `tank-${agent}-${data.window}`;
  const water = remaining > 0
    ? `<g clip-path="url(#${clipId})">` +
        `<path d="${bodyPath}" fill="${pal.water}"/>` +
        `<path d="${surfacePath}" fill="none" stroke="${pal.surface}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>` +
      `</g>`
    : '';

  const rimColor = critical ? RIM_CRITICAL : RIM;
  const reset = formatResetTime(data.resetsAt);

  return svgWrap(
    `<defs><clipPath id="${clipId}"><rect x="${TANK_X}" y="${TANK_Y}" width="${TANK_W}" height="${TANK_H}" rx="9"/></clipPath></defs>` +
    `<rect width="${W}" height="${H}" fill="${BG}"/>` +
    tank +
    water +
    `<rect x="${TANK_X}" y="${TANK_Y}" width="${TANK_W}" height="${TANK_H}" rx="9" fill="none" stroke="${rimColor}" stroke-width="2.5"/>` +
    labelEl +
    // Headline = remaining quota. Dark stroke halo keeps it legible over water.
    `<text x="72" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="${headColor}" stroke="${BG}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${Math.round(remaining)}%</text>` +
    (reset ? `<text x="72" y="132" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${COUNTDOWN}">${esc(reset)}</text>` : ''),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Encoder-LCD variant (Stream Deck+ touch strip, 200×100).
//
// Phase 2: each SD+ usage encoder (E2 = Claude, E3 = Codex) shows BOTH the 5h
// and 7d windows as side-by-side water tanks in one 200×100 LCD. Same visual
// language as the 144×144 keypad tile (water = remaining quota, agent-brand
// hue, per-tank window label + remaining % + reset countdown).
// ─────────────────────────────────────────────────────────────────────────

const ENC_W = 200;
const ENC_H = 100;

export interface UsageEncoderTank {
  /** Tank label, e.g. "5H" / "7D". */
  label: string;
  /** Percent of the window already consumed (0–100). */
  usedPercent: number;
  /** ISO-8601 reset instant for the countdown. */
  resetsAt?: string;
  /** False when no live quota exists for this window — draws an empty tank + "—". */
  known: boolean;
}

export interface UsageEncoderData {
  agent: 'claude' | 'codex';
  /** Top-left title, e.g. "CLAUDE" / "CODEX". */
  title: string;
  fiveHour: UsageEncoderTank;
  sevenDay: UsageEncoderTank;
  /**
   * When set, the tanks are replaced by a single centred status line (e.g.
   * "Waiting…" for the first-payload case, or "No Codex usage" when the agent
   * reports no rate limits). Keeps the agent title + brand framing.
   */
  note?: string;
}

function encSvgWrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ENC_W}" height="${ENC_H}" viewBox="0 0 ${ENC_W} ${ENC_H}">${inner}</svg>`;
}

/** Draw one tank (label + water + remaining% + reset) centred at cx. */
function drawEncoderTank(cx: number, tank: UsageEncoderTank, agent: 'claude' | 'codex', idx: number): string {
  const pal = PALETTE[agent];
  const tankW = 38;
  const tankH = 46;
  const tankX = cx - tankW / 2;
  const tankY = 30;

  const label = `<text x="${cx}" y="26" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" font-weight="bold" fill="${tank.known ? pal.water : LABEL_DIM}">${esc(tank.label)}</text>`;
  const emptyRect = `<rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="7" fill="${TANK_EMPTY}"/>`;

  if (!tank.known) {
    return (
      emptyRect +
      `<rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="7" fill="none" stroke="${RIM}" stroke-width="2"/>` +
      label +
      `<text x="${cx}" y="${tankY + tankH / 2 + 8}" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="bold" fill="${TEXT_DIM}">—</text>`
    );
  }

  const used = clampPct(tank.usedPercent);
  const remaining = clampPct(100 - used);
  const waterH = Math.round((tankH * remaining) / 100);
  const waterY = tankY + tankH - waterH;
  const critical = remaining <= 15;
  const headColor = remainingSeverityColor(remaining);

  const seg = tankW / 2;
  const amp = remaining > 1 && remaining < 100 ? 2.5 : 0;
  const surfacePath = `M ${tankX} ${waterY} q ${seg / 2} ${-amp} ${seg} 0 q ${seg / 2} ${amp} ${seg} 0`;
  const bodyPath = `${surfacePath} L ${tankX + tankW} ${tankY + tankH} L ${tankX} ${tankY + tankH} Z`;

  const clipId = `enc-${agent}-${idx}`;
  const water = remaining > 0
    ? `<g clip-path="url(#${clipId})">` +
        `<path d="${bodyPath}" fill="${pal.water}"/>` +
        `<path d="${surfacePath}" fill="none" stroke="${pal.surface}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>` +
      `</g>`
    : '';

  const rimColor = critical ? RIM_CRITICAL : RIM;
  const reset = formatResetTime(tank.resetsAt);

  return (
    `<defs><clipPath id="${clipId}"><rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="7"/></clipPath></defs>` +
    emptyRect +
    water +
    `<rect x="${tankX}" y="${tankY}" width="${tankW}" height="${tankH}" rx="7" fill="none" stroke="${rimColor}" stroke-width="2"/>` +
    label +
    `<text x="${cx}" y="${tankY + tankH / 2 + 7}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${headColor}" stroke="${BG}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${Math.round(remaining)}%</text>` +
    (reset ? `<text x="${cx}" y="94" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="${COUNTDOWN}">${esc(reset)}</text>` : '')
  );
}

/** Render the SD+ usage encoder LCD: agent title + 5h/7d water tanks (or a note). */
export function renderUsageEncoderDual(data: UsageEncoderData): string {
  const agent = data.agent === 'codex' ? 'codex' : 'claude';
  const pal = PALETTE[agent];
  const muted = data.note != null;
  const title = `<text x="10" y="16" font-family="JetBrains Mono, monospace" font-size="12" font-weight="bold" fill="${muted ? LABEL_DIM : pal.water}">${esc(data.title)}</text>`;

  if (data.note != null) {
    return encSvgWrap(
      `<rect width="${ENC_W}" height="${ENC_H}" fill="${BG}"/>` +
      title +
      `<text x="${ENC_W / 2}" y="60" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" fill="${LABEL_DIM}">${esc(data.note)}</text>`,
    );
  }

  return encSvgWrap(
    `<rect width="${ENC_W}" height="${ENC_H}" fill="${BG}"/>` +
    title +
    drawEncoderTank(56, data.fiveHour, agent, 0) +
    drawEncoderTank(144, data.sevenDay, agent, 1),
  );
}
