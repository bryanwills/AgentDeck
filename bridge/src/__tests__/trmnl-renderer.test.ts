import { describe, it, expect, beforeAll } from 'vitest';
import { renderTrmnlFrame, initTrmnlRenderer, isTrmnlResvgLoaded } from '../trmnl/image-renderer.js';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parseIhdr(buf: Buffer) {
  // PNG: 8-byte sig, then IHDR chunk (length 13) at offset 8: 4 len + 'IHDR' + data.
  const type = buf.toString('ascii', 12, 16);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  return { type, width, height, bitDepth, colorType };
}

describe('renderTrmnlFrame', () => {
  beforeAll(async () => {
    await initTrmnlRenderer();
  });

  it('emits a valid 1-bit grayscale PNG sized 800×480 under the 90KB cap', () => {
    const frame = renderTrmnlFrame({ state: 'IDLE', allSessions: [] });
    expect(frame.contentType).toBe('image/png');
    expect(frame.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);

    const ihdr = parseIhdr(frame.buffer);
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.width).toBe(800);
    expect(ihdr.height).toBe(480);
    expect(ihdr.bitDepth).toBe(1); // 1-bit
    expect(ihdr.colorType).toBe(0); // grayscale

    expect(frame.buffer.length).toBeLessThanOrEqual(90_000);
    expect(frame.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces a stable content hash for identical state', () => {
    const a = renderTrmnlFrame({ state: 'IDLE', allSessions: [] });
    const b = renderTrmnlFrame({ state: 'IDLE', allSessions: [] });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it('changes the content hash when the dashboard differs (requires resvg)', () => {
    // Without resvg the renderer emits a blank frame regardless of state, so the
    // distinguishing assertion only holds when rasterization is available.
    if (!isTrmnlResvgLoaded()) {
      expect(isTrmnlResvgLoaded()).toBe(false);
      return;
    }
    const idle = renderTrmnlFrame({ state: 'IDLE', allSessions: [] });
    const busy = renderTrmnlFrame({
      state: 'PROCESSING',
      allSessions: [
        { id: 'a', agentType: 'claude-code', projectName: 'demo', modelName: 'claude-opus-4-8', state: 'processing', alive: true, port: 9121 },
      ],
    });
    expect(idle.contentHash).not.toBe(busy.contentHash);
  });

  it('rasterizes at a device-reported resolution', () => {
    const frame = renderTrmnlFrame({ state: 'IDLE', allSessions: [] }, undefined, { width: 480, height: 800 });
    expect(frame.width).toBe(480);
    expect(frame.height).toBe(800);
    const ihdr = parseIhdr(frame.buffer);
    expect(ihdr.width).toBe(480);
    expect(ihdr.height).toBe(800);
    expect(ihdr.bitDepth).toBe(1);
    expect(ihdr.colorType).toBe(0);
    expect(frame.buffer.length).toBeLessThanOrEqual(90_000);
  });

  it('renders a tiny panel without throwing (compact fallback)', () => {
    const frame = renderTrmnlFrame({ state: 'IDLE', allSessions: [] }, undefined, { width: 200, height: 120 });
    const ihdr = parseIhdr(frame.buffer);
    expect(ihdr.width).toBe(200);
    expect(ihdr.height).toBe(120);
    expect(frame.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });
});

describe('renderTrmnlFrame — hostile session text', () => {
  beforeAll(async () => {
    await initTrmnlRenderer();
  });

  const withGoal = (goal: string) => ({
    state: 'PROCESSING',
    projectName: 'AgentDeck',
    modelName: 'claude-opus-4-8',
    usageKnown: true,
    fiveHourPercent: 8,
    sevenDayPercent: 78,
    allSessions: [
      { id: 's1', agentType: 'claude-code', state: 'processing', projectName: 'AgentDeck', modelName: 'claude-opus-4-8', goal, alive: true },
    ],
  });

  it('renders a real (non-blank, non-degraded) frame when the goal carries ANSI escapes', () => {
    if (!isTrmnlResvgLoaded()) return;
    // Regression: a raw ESC in a PTY-derived goal made resvg reject the whole
    // SVG and the panel silently received a blank white frame.
    const frame = renderTrmnlFrame(withGoal('Fix \x1b[31mred\x1b[0m bug'));
    expect(frame.degraded).toBeUndefined();
    // A rendered dashboard deflates far larger than the ~250-byte blank frame.
    expect(frame.buffer.length).toBeGreaterThan(1500);
  });

  it('renders a real frame when the goal carries raw control characters', () => {
    if (!isTrmnlResvgLoaded()) return;
    const frame = renderTrmnlFrame(withGoal('line1\x08\x00\x0bbad'));
    expect(frame.degraded).toBeUndefined();
    expect(frame.buffer.length).toBeGreaterThan(1500);
  });

  it('renders a real frame when the goal ends in a lone surrogate half', () => {
    if (!isTrmnlResvgLoaded()) return;
    const frame = renderTrmnlFrame(withGoal('emoji cut \ud83d'));
    expect(frame.degraded).toBeUndefined();
    expect(frame.buffer.length).toBeGreaterThan(1500);
  });
});
