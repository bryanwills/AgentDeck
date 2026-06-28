import { describe, it, expect } from 'vitest';
import { parseCodexRateLimitsFromText } from '../codex-rate-limits.js';

// A realistic token_count line as Codex CLI writes it to a rollout file.
const tokenCountLine = JSON.stringify({
  timestamp: '2026-06-27T09:59:09.566Z',
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { total_tokens: 18390 }, model_context_window: 258400 },
    rate_limits: {
      limit_id: 'codex',
      primary: { used_percent: 8.0, window_minutes: 300, resets_at: 1782570990 },
      secondary: { used_percent: 1.0, window_minutes: 10080, resets_at: 1783157790 },
      credits: null,
      plan_type: 'plus',
      rate_limit_reached_type: null,
    },
  },
});

describe('parseCodexRateLimitsFromText', () => {
  it('parses primary/secondary windows and converts resets_at to ISO', () => {
    const result = parseCodexRateLimitsFromText(tokenCountLine);
    expect(result).not.toBeNull();
    expect(result!.planType).toBe('plus');
    expect(result!.primary).toEqual({
      usedPercent: 8.0,
      windowMinutes: 300,
      resetsAt: new Date(1782570990 * 1000).toISOString(),
    });
    expect(result!.secondary).toEqual({
      usedPercent: 1.0,
      windowMinutes: 10080,
      resetsAt: new Date(1783157790 * 1000).toISOString(),
    });
  });

  it('returns the most recent snapshot when multiple lines are present', () => {
    const older = JSON.parse(tokenCountLine);
    older.payload.rate_limits.primary.used_percent = 2.0;
    const newer = JSON.parse(tokenCountLine);
    newer.payload.rate_limits.primary.used_percent = 42.0;
    const text = [JSON.stringify(older), JSON.stringify(newer)].join('\n');
    const result = parseCodexRateLimitsFromText(text);
    expect(result!.primary!.usedPercent).toBe(42.0);
  });

  it('clamps used_percent into 0..100', () => {
    const over = JSON.parse(tokenCountLine);
    over.payload.rate_limits.primary.used_percent = 150;
    over.payload.rate_limits.secondary.used_percent = -5;
    const result = parseCodexRateLimitsFromText(JSON.stringify(over));
    expect(result!.primary!.usedPercent).toBe(100);
    expect(result!.secondary!.usedPercent).toBe(0);
  });

  it('tolerates a truncated leading line (tail window cut mid-line)', () => {
    const text = ['{"payload":{"type":"token_co', tokenCountLine].join('\n');
    const result = parseCodexRateLimitsFromText(text);
    expect(result!.primary!.usedPercent).toBe(8.0);
  });

  it('returns null when no rate_limits line exists', () => {
    expect(parseCodexRateLimitsFromText('{"type":"message"}\n{"foo":1}')).toBeNull();
  });

  it('omits a window missing required fields', () => {
    const partial = JSON.parse(tokenCountLine);
    delete partial.payload.rate_limits.secondary.window_minutes;
    const result = parseCodexRateLimitsFromText(JSON.stringify(partial));
    expect(result!.primary).toBeDefined();
    expect(result!.secondary).toBeUndefined();
  });

  // Credit-based plans report null 5h/7d windows and a `credits` block instead.
  // Verbatim shape from a live rollout after the account moved to "premium".
  const creditsLine = JSON.stringify({
    timestamp: '2026-06-28T03:38:23.141Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: null,
      rate_limits: {
        limit_id: 'premium',
        limit_name: null,
        primary: null,
        secondary: null,
        credits: { has_credits: false, unlimited: false, balance: '0' },
        individual_limit: null,
        plan_type: null,
        rate_limit_reached_type: null,
      },
    },
  });

  it('keeps a credit-based snapshot when windows are null', () => {
    const result = parseCodexRateLimitsFromText(creditsLine);
    expect(result).not.toBeNull();
    expect(result!.primary).toBeUndefined();
    expect(result!.secondary).toBeUndefined();
    expect(result!.limitId).toBe('premium');
    expect(result!.credits).toEqual({ hasCredits: false, unlimited: false, balance: '0' });
  });

  it('prefers a windowed snapshot over an older credits-only one', () => {
    const text = [creditsLine, tokenCountLine].join('\n');
    const result = parseCodexRateLimitsFromText(text);
    expect(result!.primary!.usedPercent).toBe(8.0);
  });

  it('still returns null when neither windows, credits, nor limitId are present', () => {
    const bare = JSON.stringify({
      payload: { type: 'token_count', rate_limits: { primary: null, secondary: null } },
    });
    expect(parseCodexRateLimitsFromText(bare)).toBeNull();
  });
});
