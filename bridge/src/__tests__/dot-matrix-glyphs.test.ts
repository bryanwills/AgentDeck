import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_DOT_GLYPHS,
  OFFICIAL_DOT_GLYPH_SIZE,
  OFFICIAL_TC001_GLYPHS,
  OFFICIAL_TC001_GLYPH_SIZE,
} from '../pixoo/official-dot-glyphs.generated.js';
import { MICRO_SIZE, microStatusBg, paintMicroGlyph, type MicroCreature } from '../pixoo/micro-glyphs.js';

describe('canonical dot-matrix agent masks', () => {
  it('ships every official agent mark at Pixoo/iDotMatrix and TC001 resolutions', () => {
    expect(Object.keys(OFFICIAL_DOT_GLYPHS).sort()).toEqual([
      'antigravity', 'claudeCode', 'codex', 'openClaw', 'openCode',
    ]);
    for (const mask of Object.values(OFFICIAL_DOT_GLYPHS)) {
      expect(mask).toHaveLength(OFFICIAL_DOT_GLYPH_SIZE ** 2);
      expect(Math.max(...mask)).toBe(255);
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

describe('Timebox Mini official-mark signatures', () => {
  const creatures: MicroCreature[] = ['octopus', 'jellyfish', 'opencode', 'crayfish', 'antigravity'];

  it.each(creatures)('renders %s as a non-empty native 11×11 glyph', (creature) => {
    const bg = microStatusBg('idle', 0);
    const frame = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    for (let i = 0; i < MICRO_SIZE * MICRO_SIZE; i++) frame.set(bg, i * 3);
    paintMicroGlyph(frame, creature, 'idle', 0);
    let changed = 0;
    for (let i = 0; i < MICRO_SIZE * MICRO_SIZE; i++) {
      if (frame[i * 3] !== bg[0] || frame[i * 3 + 1] !== bg[1] || frame[i * 3 + 2] !== bg[2]) changed++;
    }
    expect(changed).toBeGreaterThan(12);
  });

  it('keeps OpenCode hollow and OpenClaw teal-eyed at 1:1 panel resolution', () => {
    const bg = microStatusBg('idle', 0);
    const openCode = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    const openClaw = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
    for (let i = 0; i < MICRO_SIZE * MICRO_SIZE; i++) {
      openCode.set(bg, i * 3);
      openClaw.set(bg, i * 3);
    }
    paintMicroGlyph(openCode, 'opencode', 'idle', 0);
    paintMicroGlyph(openClaw, 'crayfish', 'idle', 0);
    expect([...openCode.slice((5 * MICRO_SIZE + 5) * 3, (5 * MICRO_SIZE + 5) * 3 + 3)]).toEqual([...bg]);
    expect([...openClaw.slice((3 * MICRO_SIZE + 4) * 3, (3 * MICRO_SIZE + 4) * 3 + 3)]).toEqual([0, 229, 204]);
  });
});
