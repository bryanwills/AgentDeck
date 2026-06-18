import { describe, expect, it } from 'vitest';
import { COLORS, creatureCellSize, getOctopusPaletteForSession } from '../pixoo/pixoo-sprites.js';
import { quantizeCameraPixels, type Camera } from '../pixoo/pixoo-camera.js';

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

describe('creatureCellSize', () => {
  // The eye sits at a fixed sprite column, so a cell size that oscillates 1↔2px
  // as the zoom lerps jumps the eye by `eyeCol` pixels (shimmer). Sweeping zoom
  // continuously, the size must only ever step up — never bounce down and back.
  it.each([24, 14, 12, 8])('is monotonic non-decreasing across a zoom sweep (cols=%i, 32px)', (cols) => {
    let prev = 0;
    for (let zoom = 0.8; zoom <= 3.5; zoom += 0.01) {
      const sz = creatureCellSize(zoom, 32, cols);
      expect(sz).toBeGreaterThanOrEqual(prev);
      prev = sz;
    }
  });

  it.each([24, 14, 12, 8])('is monotonic non-decreasing across a zoom sweep (cols=%i, 64px)', (cols) => {
    let prev = 0;
    for (let zoom = 0.8; zoom <= 3.5; zoom += 0.01) {
      const sz = creatureCellSize(zoom, 64, cols);
      expect(sz).toBeGreaterThanOrEqual(prev);
      prev = sz;
    }
  });

  it('is stable for sub-0.25 zoom jitter around a value (no flicker)', () => {
    // A creature settling at zoom 3.2 still has the lerp nudging zoom by tiny
    // amounts; quantizing to 0.25 steps means cellSz must not change.
    const base = creatureCellSize(3.2, 32, 24);
    for (const z of [3.18, 3.19, 3.2, 3.21, 3.23, 3.24]) {
      expect(creatureCellSize(z, 32, 24)).toBe(base);
    }
  });

  it('never returns less than 1', () => {
    expect(creatureCellSize(0.1, 32, 24)).toBeGreaterThanOrEqual(1);
  });
});

describe('quantizeCameraPixels', () => {
  const cam: Camera = { cx: 0.3736, cy: 0.5219, zoom: 3.2, width: 32 };

  it('snaps the center onto the device-pixel grid', () => {
    const q = quantizeCameraPixels(cam);
    const s = (q.width ?? 64) * q.zoom;
    expect(q.cx * s).toBeCloseTo(Math.round(q.cx * s), 9);
    expect(q.cy * s).toBeCloseTo(Math.round(q.cy * s), 9);
  });

  it('is idempotent', () => {
    const once = quantizeCameraPixels(cam);
    const twice = quantizeCameraPixels(once);
    expect(twice.cx).toBeCloseTo(once.cx, 9);
    expect(twice.cy).toBeCloseTo(once.cy, 9);
  });

  it('preserves zoom and width', () => {
    const q = quantizeCameraPixels(cam);
    expect(q.zoom).toBe(cam.zoom);
    expect(q.width).toBe(cam.width);
  });

  it('defaults width to 64 and tolerates degenerate scale', () => {
    expect(quantizeCameraPixels({ cx: 0.5, cy: 0.5, zoom: 1 }).width).toBeUndefined();
    const degenerate: Camera = { cx: 0.5, cy: 0.5, zoom: 0 };
    expect(quantizeCameraPixels(degenerate)).toEqual(degenerate);
  });
});
