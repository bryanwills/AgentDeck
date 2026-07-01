import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the renderer so we can hand the cache degraded (blank-fallback) frames
// deterministically — the real renderer only degrades when resvg throws.
vi.mock('../trmnl/image-renderer.js', () => ({
  renderTrmnlFrame: vi.fn(),
}));

import { renderTrmnlFrame, type TrmnlFrame } from '../trmnl/image-renderer.js';
import { refreshTrmnlFrame, getTrmnlFrame } from '../trmnl/frame-cache.js';

const mockRender = vi.mocked(renderTrmnlFrame);

function frame(tag: string, degraded = false): TrmnlFrame {
  const buffer = Buffer.from(`png:${tag}`);
  return {
    buffer,
    contentHash: tag.padEnd(16, '0'),
    width: 800,
    height: 480,
    contentType: 'image/png',
    ...(degraded ? { degraded: true } : {}),
  };
}

const state = (marker: string) => ({ state: 'PROCESSING', projectName: marker, allSessions: [] });

describe('frame cache — degraded render keeps the last good frame', () => {
  beforeEach(() => {
    mockRender.mockReset();
  });

  it('serves the previous good frame instead of a blank fallback, then recovers', () => {
    // Prime with a good frame.
    mockRender.mockReturnValue(frame('good-a'));
    refreshTrmnlFrame(state('a'));
    expect(getTrmnlFrame().buffer.toString()).toBe('png:good-a');

    // Next state renders degraded (blank fallback) → panel must keep frame A.
    mockRender.mockReturnValue(frame('blank', true));
    refreshTrmnlFrame(state('b'));
    expect(getTrmnlFrame().buffer.toString()).toBe('png:good-a');

    // Render works again on the following state change → serves the new frame.
    mockRender.mockReturnValue(frame('good-c'));
    refreshTrmnlFrame(state('c'));
    expect(getTrmnlFrame().buffer.toString()).toBe('png:good-c');
  });

  it('serves the degraded frame when there was never a good one (better than a 500)', () => {
    mockRender.mockReturnValue(frame('blank-only', true));
    const f = getTrmnlFrame(640, 384); // fresh resolution key — no prior frame
    expect(f.buffer.toString()).toBe('png:blank-only');
  });
});
