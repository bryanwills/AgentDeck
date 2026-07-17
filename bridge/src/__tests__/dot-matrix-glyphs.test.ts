import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_DOT_GLYPHS,
  OFFICIAL_DOT_GLYPH_SIZE,
  OFFICIAL_TIMEBOX_GLYPHS,
  OFFICIAL_TIMEBOX_GLYPH_SIZE,
  OFFICIAL_TC001_GLYPHS,
  OFFICIAL_TC001_GLYPH_SIZE,
} from '../pixoo/official-dot-glyphs.generated.js';
import { MICRO_SIZE, paintTimeboxBeacon, type MicroCreature } from '../pixoo/micro-glyphs.js';
import {
  PIXOO_PUSH_POLICY,
  pixooPushIntervalMs,
  resolvePixooPushMode,
} from '../pixoo/pixoo-bridge.js';

describe('canonical dot-matrix agent masks', () => {
  it('ships every official agent mark at Pixoo/iDotMatrix and TC001 resolutions', () => {
    expect(Object.keys(OFFICIAL_DOT_GLYPHS).sort()).toEqual([
      'antigravity', 'claudeCode', 'codex', 'openClaw', 'openCode',
    ]);
    for (const mask of Object.values(OFFICIAL_DOT_GLYPHS)) {
      expect(mask).toHaveLength(OFFICIAL_DOT_GLYPH_SIZE ** 2);
      expect(Math.max(...mask)).toBe(255);
    }
    for (const mask of Object.values(OFFICIAL_TIMEBOX_GLYPHS)) {
      expect(mask).toHaveLength(OFFICIAL_TIMEBOX_GLYPH_SIZE ** 2);
      expect(mask.some((alpha) => alpha > 0)).toBe(true);
    }
    for (const mask of Object.values(OFFICIAL_TC001_GLYPHS)) {
      expect(mask).toHaveLength(OFFICIAL_TC001_GLYPH_SIZE ** 2);
      expect(mask.some((alpha) => alpha > 0)).toBe(true);
    }
  });

  it('preserves the official negative-space features instead of filled approximations', () => {
    const px = (name: keyof typeof OFFICIAL_DOT_GLYPHS, x: number, y: number) =>
      OFFICIAL_DOT_GLYPHS[name][y * OFFICIAL_DOT_GLYPH_SIZE + x];

    // Claude Code: transparent eye inside a solid robot body.
    expect(px('claudeCode', 6, 9)).toBe(0);
    expect(px('claudeCode', 10, 9)).toBe(255);
    // OpenCode: hollow center inside the rectangular ring.
    expect(px('openCode', 12, 12)).toBe(0);
    expect(px('openCode', 12, 2)).toBe(255);
    // Codex: the > prompt cutout remains visibly lower-alpha than its body.
    expect(px('codex', 6, 9)).toBeLessThan(32);
    expect(px('codex', 10, 9)).toBe(255);
    // Antigravity: the lower arc remains open rather than becoming a triangle.
    expect(px('antigravity', 12, 22)).toBe(0);
    expect(px('antigravity', 1, 22)).toBeGreaterThan(200);
  });
});

describe('Timebox Mini Agent Beacon', () => {
  const creatures: MicroCreature[] = ['octopus', 'jellyfish', 'opencode', 'crayfish', 'antigravity'];
  const background = [2, 6, 10];
  const pixel = (frame: Uint8Array, x: number, y: number) =>
    [...frame.slice((y * MICRO_SIZE + x) * 3, (y * MICRO_SIZE + x) * 3 + 3)];

  it.each(creatures)('renders %s from a non-empty official 9×9 mask', (creature) => {
    const frame = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    paintTimeboxBeacon(frame, creature, 'idle', 0);
    let changed = 0;
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) {
      if (pixel(frame, x, y).some((v, i) => v !== background[i])) changed++;
    }
    expect(changed).toBeGreaterThan(8);
  });

  it('keeps OpenCode hollow and OpenClaw teal-eyed at physical resolution', () => {
    const openCode = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    const openClaw = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    paintTimeboxBeacon(openCode, 'opencode', 'idle', 0);
    paintTimeboxBeacon(openClaw, 'crayfish', 'idle', 0);
    expect(pixel(openCode, 5, 5)).toEqual(background);
    expect(pixel(openClaw, 4, 4)).toEqual([0, 188, 167]); // idle intensity 0.82
    expect(pixel(openClaw, 7, 4)).toEqual([0, 188, 167]);
  });

  it('keeps identity fixed and moves only the perimeter rail while processing', () => {
    const a = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    const b = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    paintTimeboxBeacon(a, 'jellyfish', 'processing', 0);
    paintTimeboxBeacon(b, 'jellyfish', 'processing', 12);
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) {
      expect(pixel(a, x, y)).toEqual(pixel(b, x, y));
    }
    const borderChanged = Array.from({ length: MICRO_SIZE }, (_, x) => x)
      .some((x) => pixel(a, x, 0).join() !== pixel(b, x, 0).join());
    expect(borderChanged).toBe(true);
  });

  it('renders a device-native standby tide when no agent exists', () => {
    const frame = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    paintTimeboxBeacon(frame, null, 'idle', 0);
    expect(pixel(frame, 5, 6)).not.toEqual(background);
  });
});

describe('Pixoo adaptive push policy', () => {
  it('separates state latency from stable animation cadence', () => {
    expect(pixooPushIntervalMs(true, 'animated')).toBe(PIXOO_PUSH_POLICY.stateChangeFloorMs);
    expect(pixooPushIntervalMs(false, 'animated')).toBe(PIXOO_PUSH_POLICY.stableAnimationRefreshMs);
    expect(pixooPushIntervalMs(false, 'idle')).toBe(PIXOO_PUSH_POLICY.idleRefreshMs);
  });

  it('uses bounded moving-frame recovery and retries animation after cooldown', () => {
    const now = 10_000;
    expect(resolvePixooPushMode(true, now + 1_000, now)).toBe('single-recovery');
    expect(pixooPushIntervalMs(false, 'single-recovery')).toBe(PIXOO_PUSH_POLICY.fallbackFrameRefreshMs);
    expect(resolvePixooPushMode(true, now - 1, now)).toBe('animated');
    expect(resolvePixooPushMode(false, now + 1_000, now)).toBe('idle');
  });
});
