/**
 * Phase 2 SD+ usage-encoder data builders.
 *
 * The Claude (E2) and Codex (E3) encoders map the shared usage snapshot onto the
 * 200×100 dual-tank renderer. These tests pin the mapping: Claude rides the
 * top-level 5h/7d fields, Codex rides `codexRateLimits`, "waiting" vs "no data"
 * notes are distinct, and stale data suppresses the tanks.
 */
import { describe, it, expect } from 'vitest';
import { buildClaudeUsageEncoder, buildCodexUsageEncoder } from '../utility-modes/usage.js';

const CODEX_LIMITS = {
  primary: { usedPercent: 30, windowMinutes: 300, resetsAt: '2099-01-01T00:00:00Z' },
  secondary: { usedPercent: 12, windowMinutes: 10080, resetsAt: '2099-01-08T00:00:00Z' },
};

describe('buildClaudeUsageEncoder', () => {
  it('maps the top-level 5h/7d quota to two known tanks', () => {
    const enc = buildClaudeUsageEncoder({ fiveHourPercent: 30, sevenDayPercent: 12 }, true);
    expect(enc.agent).toBe('claude');
    expect(enc.title).toBe('CLAUDE');
    expect(enc.note).toBeUndefined();
    expect(enc.fiveHour).toMatchObject({ label: '5H', usedPercent: 30, known: true });
    expect(enc.sevenDay).toMatchObject({ label: '7D', usedPercent: 12, known: true });
  });

  it('shows "Waiting…" before the first payload', () => {
    const enc = buildClaudeUsageEncoder({}, false);
    expect(enc.note).toBe('Waiting…');
  });

  it('shows "No usage data" when data arrived but the quota is absent', () => {
    const enc = buildClaudeUsageEncoder({}, true);
    expect(enc.note).toBe('No usage data');
    expect(enc.fiveHour.known).toBe(false);
    expect(enc.sevenDay.known).toBe(false);
  });

  it('treats stale data as unknown (suppresses the tanks)', () => {
    const enc = buildClaudeUsageEncoder({ fiveHourPercent: 30, sevenDayPercent: 12, usageStale: true }, true);
    expect(enc.note).toBe('No usage data');
    expect(enc.fiveHour.known).toBe(false);
  });
});

describe('buildCodexUsageEncoder', () => {
  it('maps codexRateLimits primary→5h, secondary→7d', () => {
    const enc = buildCodexUsageEncoder({ codexRateLimits: CODEX_LIMITS }, true);
    expect(enc.agent).toBe('codex');
    expect(enc.title).toBe('CODEX');
    expect(enc.note).toBeUndefined();
    expect(enc.fiveHour).toMatchObject({ label: '5H', usedPercent: 30, known: true });
    expect(enc.sevenDay).toMatchObject({ label: '7D', usedPercent: 12, known: true });
  });

  it('falls back to a muted note when Codex reports no rate limits', () => {
    const enc = buildCodexUsageEncoder({ fiveHourPercent: 50 }, true);
    expect(enc.note).toBe('No Codex usage');
    expect(enc.fiveHour.known).toBe(false);
    expect(enc.sevenDay.known).toBe(false);
  });

  it('shows "Waiting…" before the first payload', () => {
    const enc = buildCodexUsageEncoder({}, false);
    expect(enc.note).toBe('Waiting…');
  });

  it('renders only the windows Codex actually reports (partial)', () => {
    const enc = buildCodexUsageEncoder({ codexRateLimits: { primary: CODEX_LIMITS.primary } }, true);
    expect(enc.note).toBeUndefined();
    expect(enc.fiveHour.known).toBe(true);
    expect(enc.sevenDay.known).toBe(false);
  });
});
