import { describe, it, expect } from 'vitest';
import { trmnlStateHash } from '../trmnl/frame-cache.js';

const base = {
  state: 'IDLE',
  projectName: 'proj',
  modelName: 'claude-opus-4-8',
  usageKnown: true,
  fiveHourPercent: 42,
  sevenDayPercent: 18,
  allSessions: [],
};

describe('trmnlStateHash — Codex windows', () => {
  it('changes when only the Codex usage changes (Claude unchanged)', () => {
    // Without folding Codex into the hash, a Codex-only change would be masked by
    // the Claude-only key and the TRMNL would skip the redraw of its footer row.
    const a = trmnlStateHash({
      ...base,
      codexRateLimits: { primary: { usedPercent: 50 }, secondary: { usedPercent: 9 } },
    });
    const b = trmnlStateHash({
      ...base,
      codexRateLimits: { primary: { usedPercent: 67 }, secondary: { usedPercent: 9 } },
    });
    expect(a).not.toBe(b);
  });

  it('changes when a Codex reset window rolls over', () => {
    const a = trmnlStateHash({
      ...base,
      codexRateLimits: { primary: { usedPercent: 50, resetsAt: '2026-06-29T10:00:00Z' } },
    });
    const b = trmnlStateHash({
      ...base,
      codexRateLimits: { primary: { usedPercent: 50, resetsAt: '2026-06-29T15:00:00Z' } },
    });
    expect(a).not.toBe(b);
  });

  it('is stable when Codex data is absent and Claude usage is unchanged', () => {
    expect(trmnlStateHash(base)).toBe(trmnlStateHash({ ...base }));
  });

  it('differs between Codex-present and Codex-absent states', () => {
    const absent = trmnlStateHash(base);
    const present = trmnlStateHash({
      ...base,
      codexRateLimits: { primary: { usedPercent: 67 } },
    });
    expect(absent).not.toBe(present);
  });
});
