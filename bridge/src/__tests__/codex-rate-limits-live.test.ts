import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseLiveCodexRateLimits,
  pickAccountWideLiveLimits,
  pickBestCodexRateLimits,
  codexSnapshotsShareLimitFamily,
  liveRejectsPassiveFamily,
  codexBlockHasLiveFamilyAuthority,
  shouldQueryCodexRateLimitsLive,
  queryCodexRateLimitsLive,
  codexSpawnPlan,
  __resetCodexRateLimitsLiveForTest,
} from '../codex-rate-limits-live.js';

// The exact `account/rateLimits/read` result observed from codex-cli 0.146.0 on
// 2026-08-05, at the moment the weekly quota was exhausted — the reading the
// passive rollout path structurally cannot produce.
const liveResult = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1786459585 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'plus',
    rateLimitReachedType: 'rate_limit_reached',
  },
  rateLimitResetCredits: { availableCount: 0, credits: [] },
};

// Both halves of the 2026-08-27 reading, copied off `account/rateLimits/read`
// and the rollout tail written at the same minute. The account family is
// exhausted; `codex_bengalfox` ("GPT-5.3-Codex-Spark") is the per-model pool the
// turns were actually served from, and the rollout stamped it `limit_id:
// "codex"`, `limit_name: null` — identical to what the account family looks
// like. The reset instants are what tell them apart.
const ACCOUNT_EXHAUSTED = {
  primary: {
    usedPercent: 100,
    windowMinutes: 10080,
    resetsAt: new Date(1788274890 * 1000).toISOString(),
  },
  planType: 'prolite',
  limitId: 'codex',
  credits: { hasCredits: false, unlimited: false, balance: '0' },
};

const SPARK_MISLABELLED_AS_ACCOUNT = {
  primary: {
    usedPercent: 54,
    windowMinutes: 300,
    resetsAt: new Date(1787853688 * 1000).toISOString(),
  },
  secondary: {
    usedPercent: 24,
    windowMinutes: 10080,
    resetsAt: new Date(1788440488 * 1000).toISOString(),
  },
  planType: 'prolite',
  limitId: 'codex',
  credits: { hasCredits: false, unlimited: false, balance: '0' },
};

describe('parseLiveCodexRateLimits', () => {
  it('maps the app-server shape onto the wire shape', () => {
    const parsed = parseLiveCodexRateLimits(liveResult, '2026-08-05T12:00:00.000Z');
    expect(parsed).not.toBeNull();
    expect(parsed!.primary).toEqual({
      usedPercent: 100,
      windowMinutes: 10080,
      resetsAt: new Date(1786459585 * 1000).toISOString(),
    });
    expect(parsed!.secondary).toBeUndefined();
    expect(parsed!.planType).toBe('plus');
    expect(parsed!.limitId).toBe('codex');
    expect(parsed!.credits).toEqual({ hasCredits: false, unlimited: false, balance: '0' });
    // Stamped with the query instant, not a rollout timestamp — that is what
    // makes a live answer read as fresh downstream.
    expect(parsed!.capturedAt).toBe('2026-08-05T12:00:00.000Z');
  });

  it('accepts the rollout spelling of the window length', () => {
    const parsed = parseLiveCodexRateLimits(
      { rateLimits: { primary: { usedPercent: 8, windowMinutes: 300 } } },
      '2026-08-05T12:00:00.000Z',
    );
    expect(parsed!.primary).toEqual({ usedPercent: 8, windowMinutes: 300, resetsAt: undefined });
  });

  it('clamps out-of-range percentages', () => {
    const parsed = parseLiveCodexRateLimits(
      { rateLimits: { primary: { usedPercent: 143, windowDurationMins: 300 } } },
      '2026-08-05T12:00:00.000Z',
    );
    expect(parsed!.primary!.usedPercent).toBe(100);
  });

  it('returns null when the result carries no usable limits', () => {
    expect(parseLiveCodexRateLimits(null, 'x')).toBeNull();
    expect(parseLiveCodexRateLimits({}, 'x')).toBeNull();
    expect(parseLiveCodexRateLimits({ rateLimits: { primary: null, secondary: null } }, 'x')).toBeNull();
  });
});

describe('pickAccountWideLiveLimits', () => {
  // Shapes from the real `account/rateLimits/read` result on 2026-08-22: the
  // top-level block is the account's, and `rateLimitsByLimitId` carries every
  // family including the per-model one.
  const account = { limitId: 'codex', limitName: null, primary: { usedPercent: 13, windowDurationMins: 10080 } };
  const spark = {
    limitId: 'codex_bengalfox',
    limitName: 'GPT-5.3-Codex-Spark',
    primary: { usedPercent: 0, windowDurationMins: 300 },
  };

  it('keeps the top-level block, which is what the Codex CLI itself shows', () => {
    expect(pickAccountWideLiveLimits(account, { codex: account, codex_bengalfox: spark })).toBe(account);
  });

  it('falls back to the unnamed family when the top level is scoped to one model', () => {
    expect(pickAccountWideLiveLimits(spark, { codex_bengalfox: spark, codex: account })).toBe(account);
  });

  it('answers null when every family is model-scoped', () => {
    // "No account-wide reading" is the honest answer: the caller then keeps what
    // the rollout path found instead of adopting one model's quota as the
    // account's. Same rule as the passive reader.
    expect(pickAccountWideLiveLimits(spark, { codex_bengalfox: spark })).toBeNull();
    expect(pickAccountWideLiveLimits(null, null)).toBeNull();
  });

  it('recognises a pool by its weekly reset even when the top level leaves it unnamed', () => {
    // The whole defect being fixed is that `limit_name` can be absent on a pool
    // reading. If the app-server's top level ever mirrors what the rollout does,
    // trusting the name here would make `cachedLive` the pool — and the guard
    // built on top of it would then prefer the pool over a correct rollout.
    const sparkWeekly = { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1788440488 };
    const accountWeekly = { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1788274890 };
    const unnamedPoolAtTop = { limitId: 'codex', limitName: null, primary: sparkWeekly };
    const namedPool = { limitId: 'codex_bengalfox', limitName: 'GPT-5.3-Codex-Spark', primary: sparkWeekly };
    const realAccount = { limitId: 'codex', limitName: null, primary: accountWeekly };
    expect(
      pickAccountWideLiveLimits(unnamedPoolAtTop, {
        codex_bengalfox: namedPool,
        codex: realAccount,
      }),
    ).toBe(realAccount);
  });

  it('does not answer a reset collision with an unrelated windowless entry', () => {
    // The ladder must not treat "not a known pool" as sufficient: a windowless
    // credit block qualifies precisely because it has no fingerprint to collide
    // with, so on a collision it could be returned ahead of the top-level block
    // purely on iteration order — and downstream it displaces the account's real
    // windows with a synthetic 100% credit gauge. Overriding the top level takes
    // positive evidence: an unnamed entry that carries a weekly window.
    const sharedWeekly = { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1788440488 };
    const collidingTop = { limitId: 'codex', limitName: null, primary: sharedWeekly };
    const namedPool = { limitId: 'codex_bengalfox', limitName: 'GPT-5.3-Codex-Spark', primary: sharedWeekly };
    const creditBlock = { limitId: 'premium', limitName: null, credits: { hasCredits: false, unlimited: false, balance: '0' } };
    expect(
      pickAccountWideLiveLimits(collidingTop, {
        premium: creditBlock,
        codex: collidingTop,
        codex_bengalfox: namedPool,
      }),
    ).toBe(collidingTop);
  });

  it('keeps an unnamed block when a reset collision is all it has to go on', () => {
    // Two windows opened in the same instant share a reset without anything
    // being wrong. Degrading to "no reading" there would delete a real one, so
    // the ladder ends by keeping the unnamed block.
    const shared = { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1788440488 };
    const onlyAccount = { limitId: 'codex', limitName: null, primary: shared };
    const namedPool = { limitId: 'codex_bengalfox', limitName: 'GPT-5.3-Codex-Spark', primary: shared };
    expect(
      pickAccountWideLiveLimits(onlyAccount, { codex: onlyAccount, codex_bengalfox: namedPool }),
    ).toBe(onlyAccount);
  });
});

describe('pickBestCodexRateLimits', () => {
  const at = (iso: string, usedPercent: number) => ({
    primary: { usedPercent, windowMinutes: 10080 },
    capturedAt: iso,
  });

  it('prefers the newer capture', () => {
    const passive = at('2026-08-04T18:38:42.076Z', 94);
    const live = at('2026-08-05T12:18:00.000Z', 100);
    expect(pickBestCodexRateLimits(passive, live)).toBe(live);
  });

  it('keeps a passive reading that is newer than the cached live one', () => {
    const passive = at('2026-08-05T13:00:00.000Z', 3);
    const live = at('2026-08-05T12:18:00.000Z', 100);
    expect(pickBestCodexRateLimits(passive, live)).toBe(passive);
  });

  it('handles either side being absent', () => {
    const live = at('2026-08-05T12:18:00.000Z', 100);
    expect(pickBestCodexRateLimits(null, live)).toBe(live);
    expect(pickBestCodexRateLimits(live, null)).toBe(live);
    expect(pickBestCodexRateLimits(null, null)).toBeNull();
  });

  it('lets a stamped snapshot beat an unstamped one', () => {
    const unstamped = { primary: { usedPercent: 94, windowMinutes: 10080 } };
    const live = at('2026-08-05T12:18:00.000Z', 100);
    expect(pickBestCodexRateLimits(unstamped, live)).toBe(live);
  });

  it('takes the live reading over a NEWER rollout minted under the old plan', () => {
    // The 2026-08-22 upgrade: a Codex session opened before the plan change kept
    // writing `plus` snapshots with the newest timestamps, so the live answer —
    // correct, current, and the only source carrying the new tier — lost every
    // comparison and was then voided as a mismatch. Recency picked the one
    // snapshot guaranteed to be discarded.
    const passive = { ...at('2026-08-21T16:40:29.100Z', 66), planType: 'plus' };
    const live = { ...at('2026-08-21T16:35:00.000Z', 0), planType: 'prolite' };
    expect(pickBestCodexRateLimits(passive, live, 'prolite')).toBe(live);
    // Without a known account tier nothing is reshuffled: recency still rules.
    expect(pickBestCodexRateLimits(passive, live, undefined)).toBe(passive);
  });

  it('still prefers a fresh passive reading once the rollout carries the new plan', () => {
    // The rescue must not become permanent: a rollout written by a session
    // started after the upgrade is the cheaper, more exact source again.
    const passive = { ...at('2026-08-22T01:43:09.000Z', 12), planType: 'prolite' };
    const live = { ...at('2026-08-22T01:35:00.000Z', 0), planType: 'prolite' };
    expect(pickBestCodexRateLimits(passive, live, 'prolite')).toBe(passive);
  });

  it('takes the live reading over a NEWER rollout describing a different limit family', () => {
    // Measured 2026-08-27. The account's weekly quota was exhausted, Codex began
    // serving turns from the per-model Spark pool, and the rollout recorded THAT
    // pool under `limit_id: "codex"` with no `limit_name` — so the name-based
    // filter admitted it and recency crowned it, every two seconds, for as long
    // as the session ran. Both snapshots carry the account's own plan, so no
    // existing axis separates them: only the weekly reset instant does
    // (1788440488 is the Spark window; 1788274890 is the account's).
    const passive = {
      ...SPARK_MISLABELLED_AS_ACCOUNT,
      capturedAt: '2026-08-27T13:09:40.628Z',
    };
    const live = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-08-27T13:05:00.000Z' };
    expect(pickBestCodexRateLimits(passive, live, 'prolite')).toBe(live);
  });

  it('does not let the family guard outrank the plan test', () => {
    // A plan change moves the weekly reset instant under the same `limit_id`
    // (both lines are verbatim fixtures in codex-rate-limits.test.ts), so ranked
    // above the plan test the family guard answers an upgrade by returning the
    // retired-plan live snapshot — which `normalizeCodexRateLimits` voids to a
    // windowless block, blanking every Codex gauge until a live query lands.
    const retiredPlanLive = {
      primary: {
        usedPercent: 100,
        windowMinutes: 10080,
        resetsAt: new Date(1787805401 * 1000).toISOString(),
      },
      planType: 'plus',
      limitId: 'codex',
      capturedAt: '2026-08-21T16:55:00.000Z',
    };
    const currentPlanPassive = {
      primary: {
        usedPercent: 0,
        windowMinutes: 10080,
        resetsAt: new Date(1787934975 * 1000).toISOString(),
      },
      planType: 'prolite',
      limitId: 'codex',
      capturedAt: '2026-08-21T16:43:09.009Z',
    };
    expect(codexSnapshotsShareLimitFamily(currentPlanPassive, retiredPlanLive)).toBe(false);
    // `nowMs` sits inside BOTH weekly windows on purpose. A retired plan's window
    // stays future-dated for up to seven days — that is the whole reason the plan
    // axis exists — so evaluating this at today's clock would let the elapsed-
    // window bound answer instead, and the ordering itself would go ungated:
    // hoisting the family guard above the plan test then leaves the suite green.
    const duringBothWindows = Date.parse('2026-08-21T17:00:00.000Z');
    expect(
      pickBestCodexRateLimits(currentPlanPassive, retiredPlanLive, 'prolite', duringBothWindows),
    ).toBe(currentPlanPassive);
  });

  it('ignores a family fingerprint whose own weekly window has already elapsed', () => {
    // The account's weekly rollover reaches the rollout first, and reads as a
    // family mismatch. An expired live snapshot describes a window that no
    // longer exists, so it is not evidence about the current one — and a live
    // query that starts missing would otherwise pin it for the whole backoff.
    const elapsedLive = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-09-01T14:00:00.000Z' };
    const rolledOverPassive = {
      primary: {
        usedPercent: 3,
        windowMinutes: 10080,
        resetsAt: '2026-09-08T15:01:30.000Z',
      },
      planType: 'prolite',
      limitId: 'codex',
      capturedAt: '2026-09-01T15:30:00.000Z',
    };
    const afterReset = Date.parse('2026-09-01T15:30:00.000Z');
    expect(codexSnapshotsShareLimitFamily(rolledOverPassive, elapsedLive)).toBe(false);
    expect(pickBestCodexRateLimits(rolledOverPassive, elapsedLive, 'prolite', afterReset)).toBe(
      rolledOverPassive,
    );
    // Before that window elapses the guard still holds — this bound is about an
    // expired fingerprint, not a licence to trust the rollout again.
    const beforeReset = Date.parse('2026-08-27T13:09:40.628Z');
    const stillRunningLive = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-08-27T13:05:00.000Z' };
    expect(
      pickBestCodexRateLimits(
        { ...SPARK_MISLABELLED_AS_ACCOUNT, capturedAt: '2026-08-27T13:09:40.628Z' },
        stillRunningLive,
        'prolite',
        beforeReset,
      ),
    ).toBe(stillRunningLive);
  });

  it('lets a caller with no live reading opt out of the family guard entirely', () => {
    // The guard's authority is the live answer. Where the second argument is not
    // one — the relay path hands it the daemon's last published block, which is
    // a rollout read whenever no live query has succeeded — a cross-family
    // disagreement would otherwise be settled by which process holds the block,
    // and with the roles reversed that inverts the fix.
    const passive = { ...SPARK_MISLABELLED_AS_ACCOUNT, capturedAt: '2026-08-27T13:09:40.628Z' };
    const other = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-08-27T13:05:00.000Z' };
    const now = Date.parse('2026-08-27T13:10:00.000Z');
    expect(pickBestCodexRateLimits(passive, other, 'prolite', now)).toBe(other);
    expect(
      pickBestCodexRateLimits(passive, other, 'prolite', now, { liveOwnsFamilyAuthority: false }),
    ).toBe(passive);
  });

  it('does not let a windowless live block veto a fully-windowed passive reading', () => {
    // `codexSnapshotsShareLimitFamily` answers on the ids alone here and never
    // reaches its own weekly check, so a credit-plan block (`limit_id:
    // "premium"`, no windows — a shape `parseLiveCodexRateLimits` admits on the
    // strength of `limitId` alone) counted as a mismatch AND as evidence. It
    // then displaced a reading captured seconds ago, and since consumers test
    // for a window rather than for the block, every Codex gauge blanked.
    const windowlessLive = {
      planType: 'prolite',
      limitId: 'premium',
      capturedAt: '2026-08-27T13:00:00.000Z',
      credits: { hasCredits: false, unlimited: false, balance: '0' },
    };
    const windowedPassive = {
      ...SPARK_MISLABELLED_AS_ACCOUNT,
      capturedAt: '2026-08-27T13:09:40.628Z',
    };
    const now = Date.parse('2026-08-27T13:10:00.000Z');
    expect(codexSnapshotsShareLimitFamily(windowedPassive, windowlessLive)).toBe(false);
    expect(liveRejectsPassiveFamily(windowedPassive, windowlessLive, now)).toBe(false);
    expect(pickBestCodexRateLimits(windowedPassive, windowlessLive, 'prolite', now)).toBe(
      windowedPassive,
    );
  });

  it('keeps preferring the fresher passive reading within the account family', () => {
    // The guard is about identity, not about distrusting the rollout: a passive
    // snapshot of the SAME weekly window stays the cheaper, more exact source.
    const passive = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-08-27T13:09:40.628Z' };
    const live = { ...ACCOUNT_EXHAUSTED, capturedAt: '2026-08-27T13:05:00.000Z' };
    expect(pickBestCodexRateLimits(passive, live, 'prolite')).toBe(passive);
  });
});

describe('codexSnapshotsShareLimitFamily', () => {
  it('separates the Spark pool from the account even when both claim `codex`', () => {
    expect(codexSnapshotsShareLimitFamily(SPARK_MISLABELLED_AS_ACCOUNT, ACCOUNT_EXHAUSTED)).toBe(false);
  });

  it('treats a missing side as no information rather than a mismatch', () => {
    // Absence must never manufacture a verdict: a pre-`limit_id` rollout and a
    // credit plan with no weekly window both land here, and refusing them would
    // drop real readings on the strength of a field that was never sent.
    expect(codexSnapshotsShareLimitFamily(ACCOUNT_EXHAUSTED, null)).toBe(true);
    expect(codexSnapshotsShareLimitFamily(null, ACCOUNT_EXHAUSTED)).toBe(true);
    expect(
      codexSnapshotsShareLimitFamily({ ...ACCOUNT_EXHAUSTED, limitId: undefined }, ACCOUNT_EXHAUSTED),
    ).toBe(true);
    expect(
      codexSnapshotsShareLimitFamily(
        { limitId: 'premium', credits: { hasCredits: false, unlimited: false, balance: '0' } },
        { limitId: 'premium', primary: { usedPercent: 4, windowMinutes: 10080, resetsAt: 'x' } },
      ),
    ).toBe(true);
  });

  it('tolerates the seconds of jitter Codex puts on the same weekly window', () => {
    // Measured over 32,753 weekly-bearing lines: the account family's 21 raw
    // reset values are 10 windows plus jitter — `1788274878` and `1788274890`
    // are the same window twelve seconds apart. Compared exactly, ~4% of
    // same-family pairs read as a family change, and the passive and live
    // readings are by construction taken at different instants.
    const at = (resetsAt: number) => ({
      limitId: 'codex',
      capturedAt: '2026-08-27T13:00:00.000Z',
      primary: {
        usedPercent: 100,
        windowMinutes: 10080,
        resetsAt: new Date(resetsAt * 1000).toISOString(),
      },
    });
    expect(codexSnapshotsShareLimitFamily(at(1788274878), at(1788274890))).toBe(true);
    // ...without blurring the windows apart. The closest genuinely different
    // ones in that store sit ~1.5 days apart.
    expect(codexSnapshotsShareLimitFamily(at(1788274890), at(1788440488))).toBe(false);
    expect(codexSnapshotsShareLimitFamily(at(1788137317), at(1788274890))).toBe(false);
  });

  it('ignores the 5h window, whose reset instant slides with every request', () => {
    // Observed within one minute of Spark traffic: resets_at 1787716807 →
    // 1787716837 → 1787716845. A fingerprint including it would report a new
    // family on every turn.
    const a = { ...SPARK_MISLABELLED_AS_ACCOUNT };
    const b = {
      ...SPARK_MISLABELLED_AS_ACCOUNT,
      primary: { usedPercent: 55, windowMinutes: 300, resetsAt: '2026-08-27T18:31:28.000Z' },
    };
    expect(codexSnapshotsShareLimitFamily(a, b)).toBe(true);
  });

  it('reads the weekly fingerprint off whichever slot still carries a reset', () => {
    // An elapsed weekly window has its reset stripped by `normalizeCodexWindow`,
    // so stopping at the first long slot reports "no fingerprint" while another
    // slot still holds one. The live-side twin already scanned on; these two are
    // documented as computing one fingerprint and must not disagree.
    const strippedFirstSlot = {
      limitId: 'codex',
      primary: { usedPercent: 100, windowMinutes: 10080 },
      secondary: { usedPercent: 24, windowMinutes: 10080, resetsAt: '2026-09-03T13:01:28.000Z' },
    };
    const otherFamily = {
      limitId: 'codex',
      primary: { usedPercent: 100, windowMinutes: 10080, resetsAt: '2026-09-01T15:01:30.000Z' },
    };
    expect(codexSnapshotsShareLimitFamily(strippedFirstSlot, otherFamily)).toBe(false);
  });

  it('reports a different id as a different family', () => {
    expect(
      codexSnapshotsShareLimitFamily({ limitId: 'premium' }, { limitId: 'codex' }),
    ).toBe(false);
  });
});

describe('codexBlockHasLiveFamilyAuthority', () => {
  const now = Date.parse('2026-08-27T13:10:00.000Z');
  const live = {
    ...ACCOUNT_EXHAUSTED,
    primary: { usedPercent: 100, windowMinutes: 10080, resetsAt: '2026-09-01T15:01:30.000Z' },
  };

  it('holds for the fresher rollout the picker keeps, not only for the live block itself', () => {
    // Written as identity with the pick, this read false on every build while
    // Codex was working — the picker keeps the fresher rollout whenever the two
    // agree on family — and the relay guard switched off exactly where the
    // daemon did hold a verified baseline.
    const publishedPassive = {
      ...ACCOUNT_EXHAUSTED,
      primary: { usedPercent: 100, windowMinutes: 10080, resetsAt: '2026-09-01T15:01:30.000Z' },
      capturedAt: '2026-08-27T13:09:58.000Z',
    };
    expect(publishedPassive).not.toBe(live);
    expect(codexBlockHasLiveFamilyAuthority(publishedPassive, live, now)).toBe(true);
  });

  it('is false with no live reading, and false when the live one cannot reject', () => {
    expect(codexBlockHasLiveFamilyAuthority(live, null, now)).toBe(false);
    expect(codexBlockHasLiveFamilyAuthority(null, live, now)).toBe(false);
    // Windowless, and expired: neither is a fingerprint anything may rest on.
    expect(
      codexBlockHasLiveFamilyAuthority(live, { limitId: 'premium', planType: 'prolite' }, now),
    ).toBe(false);
    expect(
      codexBlockHasLiveFamilyAuthority(live, live, Date.parse('2026-09-02T00:00:00.000Z')),
    ).toBe(false);
  });

  it('refuses a rolling window, which is a countdown rather than an anchor', () => {
    // The per-model pool reports `resets_at` one full window ahead of every
    // reading (749 distinct values in 14 days, `resets_at - timestamp` pinned at
    // ~604,790s of 604,800). It never elapses, so the elapsed-window escape can
    // never retire it — left unchecked it could veto every passive reading for
    // as long as it stayed cached.
    const capturedAt = '2026-08-27T13:00:00.000Z';
    const rolling = {
      limitId: 'codex',
      capturedAt,
      primary: {
        usedPercent: 24,
        windowMinutes: 10080,
        resetsAt: new Date(Date.parse(capturedAt) + 604790 * 1000).toISOString(),
      },
    };
    const anchored = {
      limitId: 'codex',
      capturedAt,
      primary: {
        usedPercent: 100,
        windowMinutes: 10080,
        resetsAt: new Date(Date.parse(capturedAt) + 3 * 86400 * 1000).toISOString(),
      },
    };
    const now = Date.parse('2026-08-27T13:05:00.000Z');
    expect(codexBlockHasLiveFamilyAuthority(rolling, rolling, now)).toBe(false);
    expect(codexBlockHasLiveFamilyAuthority(anchored, anchored, now)).toBe(true);
    // And it cannot reject through the picker either.
    const passive = {
      limitId: 'codex',
      capturedAt: '2026-08-27T13:04:59.000Z',
      primary: {
        usedPercent: 7,
        windowMinutes: 10080,
        resetsAt: new Date(Date.parse(capturedAt) + 4 * 86400 * 1000).toISOString(),
      },
    };
    expect(codexSnapshotsShareLimitFamily(passive, rolling)).toBe(false);
    expect(pickBestCodexRateLimits(passive, rolling, undefined, now)).toBe(passive);
  });

  it('is false when what was published belongs to another family', () => {
    expect(
      codexBlockHasLiveFamilyAuthority(SPARK_MISLABELLED_AS_ACCOUNT, live, now),
    ).toBe(false);
  });
});

describe('shouldQueryCodexRateLimitsLive', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');

  it('queries when the passive snapshot has gone quiet', () => {
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: 0,
        consecutiveFailures: 0,
        passiveCapturedAtMs: now - 17 * 60 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it('skips while Codex is mid-turn (the rollout is writing fresh readings)', () => {
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: now - 6 * 60 * 1000,
        consecutiveFailures: 0,
        passiveCapturedAtMs: now - 30 * 1000,
      }),
    ).toBe(false);
  });

  it('always asks once, even mid-turn, when nothing has been asked yet', () => {
    // The first query is what establishes which limit family belongs to the
    // account. Skipping it because the rollout is busy means the family guard
    // never has a baseline on precisely the machine that needs it.
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: 0,
        consecutiveFailures: 0,
        passiveCapturedAtMs: now - 2 * 1000,
      }),
    ).toBe(true);
  });

  it('queries a fresh passive snapshot when its plan is one the account no longer holds', () => {
    // "The rollout is writing fresh readings" is only a reason to skip if those
    // readings are usable. A snapshot stamped with a retired plan is voided
    // downstream, so honouring its freshness suppressed the one source that
    // still had a number — precisely while Codex was being used hardest.
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: 0,
        consecutiveFailures: 0,
        passiveCapturedAtMs: now - 30 * 1000,
        passivePlanMatchesAccount: false,
      }),
    ).toBe(true);
  });

  it('does not let a plan mismatch defeat the spawn throttles', () => {
    // A mismatch is a reason to PREFER the live read, never a licence to spawn a
    // subprocess on every usage build (they are built several times a minute).
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: now - 60 * 1000,
        consecutiveFailures: 0,
        passiveCapturedAtMs: now - 30 * 1000,
        passivePlanMatchesAccount: false,
      }),
    ).toBe(false);
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: now - 6 * 60 * 1000,
        consecutiveFailures: 3,
        passiveCapturedAtMs: now - 30 * 1000,
        passivePlanMatchesAccount: false,
      }),
    ).toBe(false);
  });

  it('queries a fresh passive snapshot that describes a different limit family', () => {
    // A rollout pouring out per-model pool readings every two seconds is the
    // state in which the account's own number is least visible and most wanted.
    // Skipping on its freshness suppresses the only source that can report it.
    //
    // `lastAttemptMs` must be past the interval but non-zero, or neither branch
    // under test is the one that answers: at 0 the baseline rule returns true on
    // its own, and inside the interval the throttle returns false on its own.
    // Written the vacuous way, deleting the flag from the skip left the suite
    // green.
    const midTurn = {
      nowMs: now,
      lastAttemptMs: now - 6 * 60 * 1000,
      consecutiveFailures: 0,
      passiveCapturedAtMs: now - 2 * 1000,
    };
    expect(shouldQueryCodexRateLimitsLive({ ...midTurn, passiveMatchesAccountFamily: false })).toBe(
      true,
    );
    expect(shouldQueryCodexRateLimitsLive({ ...midTurn, passiveMatchesAccountFamily: true })).toBe(
      false,
    );
    // ...but it is still not a licence to spawn on every usage build.
    expect(
      shouldQueryCodexRateLimitsLive({
        ...midTurn,
        lastAttemptMs: now - 60 * 1000,
        passiveMatchesAccountFamily: false,
      }),
    ).toBe(false);
  });

  it('stops treating an elapsed live fingerprint as a family mismatch', () => {
    // The throttle asks the same question as the picker and must get the same
    // answer. Compared without a bound, a cached live snapshot whose weekly
    // window has elapsed mismatches every passive read forever — lifting the
    // mid-turn skip permanently instead of while the account's number is
    // genuinely unreachable.
    const passive = {
      limitId: 'codex',
      primary: { usedPercent: 3, windowMinutes: 10080, resetsAt: '2026-09-08T15:01:30.000Z' },
    };
    const elapsedLive = {
      limitId: 'codex',
      primary: { usedPercent: 100, windowMinutes: 10080, resetsAt: '2026-09-01T15:01:30.000Z' },
    };
    const beforeReset = Date.parse('2026-08-31T00:00:00.000Z');
    const afterReset = Date.parse('2026-09-01T16:00:00.000Z');
    expect(liveRejectsPassiveFamily(passive, elapsedLive, beforeReset)).toBe(true);
    expect(liveRejectsPassiveFamily(passive, elapsedLive, afterReset)).toBe(false);
    expect(liveRejectsPassiveFamily(passive, null, beforeReset)).toBe(false);
  });

  it('honours the minimum interval between spawns', () => {
    expect(
      shouldQueryCodexRateLimitsLive({
        nowMs: now,
        lastAttemptMs: now - 60 * 1000,
        consecutiveFailures: 0,
        passiveCapturedAtMs: 0,
      }),
    ).toBe(false);
  });

  it('backs off hard after repeated misses (no Codex CLI installed)', () => {
    const input = {
      nowMs: now,
      lastAttemptMs: now - 6 * 60 * 1000,
      consecutiveFailures: 3,
      passiveCapturedAtMs: 0,
    };
    expect(shouldQueryCodexRateLimitsLive(input)).toBe(false);
    expect(shouldQueryCodexRateLimitsLive({ ...input, lastAttemptMs: now - 31 * 60 * 1000 })).toBe(true);
  });
});

describe('codexSpawnPlan', () => {
  it('runs a plain binary directly on posix', () => {
    expect(codexSpawnPlan('codex', 'darwin')).toEqual({ command: 'codex', shell: false });
    expect(codexSpawnPlan('/usr/local/bin/codex', 'linux')).toEqual({
      command: '/usr/local/bin/codex',
      shell: false,
    });
  });

  it('asks for a shell on Windows .cmd/.bat shims, which spawn refuses to run bare', () => {
    expect(codexSpawnPlan('codex.cmd', 'win32')).toEqual({ command: 'codex.cmd', shell: true });
    expect(codexSpawnPlan('CODEX.BAT', 'win32')).toEqual({ command: 'CODEX.BAT', shell: true });
  });

  it('quotes a shim path with spaces, since the shell re-parses the command line', () => {
    expect(codexSpawnPlan('C:\\Program Files\\nodejs\\codex.cmd', 'win32')).toEqual({
      command: '"C:\\Program Files\\nodejs\\codex.cmd"',
      shell: true,
    });
  });

  it('leaves a real Windows executable alone — the shell is only for the shims', () => {
    expect(codexSpawnPlan('C:\\tools\\codex.exe', 'win32')).toEqual({
      command: 'C:\\tools\\codex.exe',
      shell: false,
    });
  });

  it('never asks for a shell on posix, even for a file that happens to end in .cmd', () => {
    expect(codexSpawnPlan('/opt/codex.cmd', 'darwin')).toEqual({
      command: '/opt/codex.cmd',
      shell: false,
    });
  });
});

describe('queryCodexRateLimitsLive', () => {
  let dir: string;

  beforeEach(() => {
    __resetCodexRateLimitsLiveForTest();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-live-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write a stand-in app-server that speaks the same stdio JSON-RPC framing. */
  const fakeServer = (body: string): string => {
    const file = path.join(dir, `server-${Math.random().toString(36).slice(2)}.mjs`);
    fs.writeFileSync(file, body);
    return file;
  };

  it('reads the rate limits out of the JSON-RPC stream', async () => {
    const server = fakeServer(`
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({ id: msg.id, result: { codexHome: '/tmp' } }) + '\\n');
            // An unsolicited notification lands between the two replies.
            process.stdout.write(JSON.stringify({ method: 'remoteControl/status/changed', params: {} }) + '\\n');
          } else if (msg.method === 'account/rateLimits/read') {
            process.stdout.write(JSON.stringify({ id: msg.id, result: ${JSON.stringify(liveResult)} }) + '\\n');
          }
        }
      });
      setTimeout(() => {}, 60000);
    `);
    const rl = await queryCodexRateLimitsLive({
      binary: process.execPath,
      args: [server],
      timeoutMs: 10000,
    });
    expect(rl).not.toBeNull();
    expect(rl!.primary).toEqual({
      usedPercent: 100,
      windowMinutes: 10080,
      resetsAt: new Date(1786459585 * 1000).toISOString(),
    });
    expect(Date.parse(rl!.capturedAt!)).toBeGreaterThan(0);
  });

  it('resolves null when the server never answers, without hanging', async () => {
    const server = fakeServer(`setTimeout(() => {}, 60000);`);
    const started = Date.now();
    const rl = await queryCodexRateLimitsLive({
      binary: process.execPath,
      args: [server],
      timeoutMs: 300,
    });
    expect(rl).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('resolves null when the binary does not exist', async () => {
    const rl = await queryCodexRateLimitsLive({
      binary: path.join(dir, 'definitely-not-a-binary'),
      timeoutMs: 2000,
    });
    expect(rl).toBeNull();
  });

  it('resolves null when the server exits before replying', async () => {
    const server = fakeServer(`process.exit(1);`);
    const rl = await queryCodexRateLimitsLive({
      binary: process.execPath,
      args: [server],
      timeoutMs: 5000,
    });
    expect(rl).toBeNull();
  });
});
