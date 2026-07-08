import { describe, expect, it } from 'vitest';
import { resolveChatGptRenewalDate } from '../codex-auth.js';

// Codex embeds the login-time billing window `[active_start, active_until]` in
// auth.json's id_token and never recomputes it on silent token refresh. For an
// auto-renewing ChatGPT plan `active_until` therefore drifts into the past
// mid-cycle even though the subscription is alive — which the dashboard would
// otherwise misread as a false "renewal needed". `resolveChatGptRenewalDate`
// rolls the stale snapshot forward to the next real renewal boundary.
describe('resolveChatGptRenewalDate', () => {
  const now = new Date('2026-07-08T00:00:00Z');

  it('rolls a stale monthly window forward to the next renewal boundary', () => {
    // Real-world shape: window Jun 6 → Jul 6, today Jul 8 → next boundary Aug 5.
    const out = resolveChatGptRenewalDate(
      '2026-06-06T06:21:49+00:00',
      '2026-07-06T06:21:49+00:00',
      now,
    );
    expect(out).toBe('2026-08-05T06:21:49.000Z');
    expect(Date.parse(out!)).toBeGreaterThan(now.getTime());
  });

  it('rolls forward across many missed cycles in one step', () => {
    // Window Jan → Feb 2026 but "now" is months later — still lands future.
    const out = resolveChatGptRenewalDate(
      '2026-01-06T06:21:49+00:00',
      '2026-02-06T06:21:49+00:00',
      now,
    );
    expect(Date.parse(out!)).toBeGreaterThan(now.getTime());
  });

  it('rolls a stale annual window forward by a year', () => {
    const out = resolveChatGptRenewalDate(
      '2025-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      now,
    );
    expect(out).toBe('2027-01-01T00:00:00.000Z');
  });

  it('passes a future date through untouched', () => {
    const out = resolveChatGptRenewalDate('2026-06-06', '2026-08-01T00:00:00Z', now);
    expect(out).toBe('2026-08-01T00:00:00Z');
  });

  it('leaves a past date raw when there is no start to derive a period', () => {
    // Renderers still surface "renewal needed" as a genuine last resort.
    const out = resolveChatGptRenewalDate(undefined, '2026-07-06T06:21:49+00:00', now);
    expect(out).toBe('2026-07-06T06:21:49+00:00');
  });

  it('leaves an untrustworthy (too-short) window raw', () => {
    const out = resolveChatGptRenewalDate('2026-07-01', '2026-07-05T00:00:00Z', now);
    expect(out).toBe('2026-07-05T00:00:00Z');
  });

  it('passes malformed and empty inputs through', () => {
    expect(resolveChatGptRenewalDate('2026-06-06', 'not-a-date', now)).toBe('not-a-date');
    expect(resolveChatGptRenewalDate('2026-06-06', undefined, now)).toBeUndefined();
    expect(resolveChatGptRenewalDate('garbage', '2026-07-06T00:00:00Z', now)).toBe(
      '2026-07-06T00:00:00Z',
    );
  });
});
