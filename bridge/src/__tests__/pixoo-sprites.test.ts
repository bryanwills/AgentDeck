import { describe, expect, it } from 'vitest';
import { COLORS, getOctopusPaletteForSession } from '../pixoo/pixoo-sprites.js';

describe('getOctopusPaletteForSession', () => {
  it('keeps the first additional session near the original terracotta tone', () => {
    const palette = getOctopusPaletteForSession(1);
    expect(palette.body).toEqual(COLORS.octopusBody);
    expect(palette.starburst).toEqual(COLORS.octopusStarburst);
  });

  it('darkens later sessions while preserving channel ordering', () => {
    const base = getOctopusPaletteForSession(1);
    const darker = getOctopusPaletteForSession(3);
    expect(darker.body[0]).toBeLessThan(base.body[0]);
    expect(darker.body[1]).toBeLessThan(base.body[1]);
    expect(darker.body[2]).toBeLessThan(base.body[2]);
    expect(darker.leg[0]).toBeLessThan(base.leg[0]);
    expect(darker.starburst[0]).toBeLessThan(base.starburst[0]);
  });

  it('clamps very large session indices to the darkest supported tone', () => {
    expect(getOctopusPaletteForSession(5)).toEqual(getOctopusPaletteForSession(99));
  });
});
