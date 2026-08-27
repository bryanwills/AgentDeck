import { spawn } from 'child_process';
import {
  codexSnapshotMatchesAccountPlan,
  codexSnapshotOutranks,
  isModelScopedCodexLimit,
} from '@agentdeck/shared';
import type { CodexCredits, CodexRateLimits, CodexRateLimitWindow } from '@agentdeck/shared';

/**
 * Active Codex rate-limit read via the local `codex app-server` JSON-RPC.
 *
 * The passive reader (`codex-rate-limits.ts`) recovers usage from the
 * `rate_limits` block Codex embeds in every `token_count` rollout line. That
 * makes the reading a BYPRODUCT OF A SUCCESSFUL TURN — and the state a user most
 * wants to see, "the weekly quota is exhausted", is exactly the state in which no
 * turn can complete. So the passive number freezes one turn short of the wall
 * (observed 2026-08-05: rollouts stop at 94% at 03:38 KST while the account had
 * actually reached 100%) and cannot recover until the window resets days later.
 * Usage spent on another surface entirely — Codex Cloud tasks, another machine —
 * is likewise invisible, because no local rollout ever learns about it.
 *
 * The user's own Codex CLI answers the question directly:
 *
 *   $ codex app-server            # JSON-RPC over stdio
 *   → {"id":2,"result":{"rateLimits":{"limitId":"codex","primary":
 *       {"usedPercent":100,"windowDurationMins":10080,"resetsAt":1786459585},
 *       "secondary":null,"planType":"plus",
 *       "rateLimitReachedType":"rate_limit_reached", ...}}}
 *
 * Same posture as the rest of the Codex integration: the user's own local CLI
 * with the user's own credentials — AgentDeck contacts no OpenAI endpoint itself.
 *
 * Daemon-only and throttled: spawning a process is Node-daemon territory (session
 * bridges keep device/host modules off, and the sandboxed macOS App Store daemon
 * must never spawn anything — it keeps the passive read). While Codex is actively
 * working, the passive reading is free and exact, so the live query only fires
 * once the rollout snapshot has gone quiet.
 *
 * It is also the only source that says WHICH limit the numbers belong to. The
 * rollout's own `limit_id`/`limit_name` stopped answering that on 2026-08-27
 * (see `codexSnapshotsShareLimitFamily`), and `rateLimitsByLimitId` keys every
 * family correctly — which is why the passive-only daemon has no equivalent
 * defence and will report the per-model pool as the account's once the account
 * limit is reached.
 */

/** Hard ceiling on one query — the child is killed and the read reported as a
 *  miss rather than left to hang (external-peer await always carries a timeout). */
const QUERY_TIMEOUT_MS = 8000;
/** Never spawn more often than this, regardless of how often usage is built. */
const MIN_QUERY_INTERVAL_MS = 5 * 60 * 1000;
/** A passive snapshot younger than this means Codex is being used right now;
 *  the rollout is authoritative and cheaper, so skip the spawn. */
const PASSIVE_FRESH_MS = 2 * 60 * 1000;
/** After this many consecutive misses (no Codex CLI installed, not logged in,
 *  protocol changed), back off hard instead of spawning every interval. */
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;

const INITIALIZE_REQUEST_ID = 1;
const RATE_LIMITS_REQUEST_ID = 2;

interface RawLiveWindow {
  usedPercent?: number;
  /** The app-server spells the window length differently from the rollout
   *  (`windowDurationMins` vs `window_minutes`); accept both. */
  windowDurationMins?: number;
  windowMinutes?: number;
  resetsAt?: number;
}

interface RawLiveCredits {
  hasCredits?: boolean;
  unlimited?: boolean;
  balance?: string | number;
}

interface RawLiveRateLimits {
  primary?: RawLiveWindow | null;
  secondary?: RawLiveWindow | null;
  planType?: string;
  limitId?: string;
  /** Set only on a limit scoped to one model/feature — see `isModelScopedCodexLimit`. */
  limitName?: string | null;
  credits?: RawLiveCredits | null;
}

function toWindow(raw?: RawLiveWindow | null): CodexRateLimitWindow | undefined {
  if (!raw || typeof raw.usedPercent !== 'number') return undefined;
  const windowMinutes = typeof raw.windowDurationMins === 'number'
    ? raw.windowDurationMins
    : typeof raw.windowMinutes === 'number'
      ? raw.windowMinutes
      : undefined;
  if (typeof windowMinutes !== 'number') return undefined;
  return {
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    windowMinutes,
    resetsAt:
      typeof raw.resetsAt === 'number' && raw.resetsAt > 0
        ? new Date(raw.resetsAt * 1000).toISOString()
        : undefined,
  };
}

function toCredits(raw?: RawLiveCredits | null): CodexCredits | undefined {
  if (!raw || (typeof raw.hasCredits !== 'boolean' && typeof raw.unlimited !== 'boolean' && raw.balance == null)) {
    return undefined;
  }
  return {
    hasCredits: raw.hasCredits === true,
    unlimited: raw.unlimited === true,
    balance: raw.balance != null ? String(raw.balance) : undefined,
  };
}

/**
 * Map an `account/rateLimits/read` result onto the wire shape. `capturedAt` is
 * the instant WE asked — unlike the passive read (which carries the rollout
 * line's own timestamp), a live answer is current by construction, and that is
 * what clears the age footnote downstream. Exported for unit testing.
 */
export function parseLiveCodexRateLimits(result: unknown, capturedAt: string): CodexRateLimits | null {
  const res = result as {
    rateLimits?: RawLiveRateLimits;
    rateLimitsByLimitId?: Record<string, RawLiveRateLimits>;
  } | null;
  // The top-level block is the account's today, and that is what the Codex CLI
  // itself presents. But the app-server also returns every family keyed by id,
  // so when the top level is scoped to one model there is still an account-wide
  // answer in the map — take it rather than reporting a single model's quota as
  // the account's. Reachable in two ways: a named top-level block, and a top
  // level whose weekly reset fingerprints as a pool this same response names.
  const rl = pickAccountWideLiveLimits(res?.rateLimits, res?.rateLimitsByLimitId);
  if (!rl || typeof rl !== 'object') return null;
  const primary = toWindow(rl.primary);
  const secondary = toWindow(rl.secondary);
  const credits = toCredits(rl.credits);
  const limitId = typeof rl.limitId === 'string' ? rl.limitId : undefined;
  if (!primary && !secondary && !credits && !limitId) return null;
  return {
    primary,
    secondary,
    planType: typeof rl.planType === 'string' ? rl.planType : undefined,
    limitId,
    credits,
    capturedAt,
  };
}

/** The limit ids this file knows to be account-wide. An allow-list, like every
 *  other family test here: a new model pool must not inherit the account's
 *  meaning by default, and the cost of being wrong the other way is a fallback
 *  to the rollout rather than a wrong number. */
const ACCOUNT_WIDE_LIVE_LIMIT_IDS = new Set(['codex', 'premium']);

/** The weekly window's reset instant on a raw live block — the same fingerprint
 *  `codexSnapshotsShareLimitFamily` uses, read off the app-server's spelling. */
function liveWeeklyResetsAt(rl?: RawLiveRateLimits | null): number | undefined {
  for (const window of [rl?.primary, rl?.secondary]) {
    const minutes =
      typeof window?.windowDurationMins === 'number'
        ? window.windowDurationMins
        : window?.windowMinutes;
    if (typeof minutes !== 'number' || minutes < WEEKLY_WINDOW_MIN_MINUTES) continue;
    if (typeof window?.resetsAt === 'number' && window.resetsAt > 0) return window.resetsAt;
  }
  return undefined;
}

/**
 * The account-wide limit block among what `account/rateLimits/read` returned.
 *
 * Prefers the top-level `rateLimits` (what the Codex CLI shows) and falls back
 * to an unnamed entry of `rateLimitsByLimitId`. Returns null when every family
 * is model-scoped: "no account-wide reading" is the honest answer, and the
 * caller then keeps whatever the rollout path found rather than adopting one
 * model's quota as the account's.
 *
 * `limit_name` alone is not enough here for the same reason it stopped being
 * enough on the rollout: it is the label, and the label is what went wrong. So a
 * candidate that carries the WEEKLY RESET of a family this very response names
 * as model-scoped is treated as that family whatever it calls itself — the
 * fingerprint outranks the name on both paths, or the live source could hand
 * back a pool reading and the guard built on it would invert.
 *
 * Measured 2026-08-27 the top level was correct (the account at 100% while the
 * pool sat under `rateLimitsByLimitId.codex_bengalfox`), so this is defence, not
 * a fix for an observed miss — which is why it degrades in one direction only.
 * A collision is possible without anything being wrong (two windows opened in
 * the same instant share a reset), so the ladder ends by keeping an unnamed
 * block rather than reporting nothing: a coincidence must not delete a real
 * reading. Exported for unit testing.
 */
export function pickAccountWideLiveLimits(
  top?: RawLiveRateLimits | null,
  byLimitId?: Record<string, RawLiveRateLimits> | null,
): RawLiveRateLimits | null {
  // Keep the KEYS. They are the one discriminator this response is trusted for
  // — CLAUDE.md's account of the incident identifies the pool as
  // `rateLimitsByLimitId.codex_bengalfox` — while `limitName` is the field this
  // whole change declares unreliable. Dropping them left the pool defence
  // resting entirely on a name the map values are not guaranteed to carry: null
  // there and `scopedWeeklyResets` is empty AND the pool reads as unnamed, so it
  // could be returned as the account block and become the authority that rejects
  // the real account rollout.
  const entries = Object.entries(byLimitId ?? {}).filter(
    (entry): entry is [string, RawLiveRateLimits] => !!entry[1],
  );
  const keyIsAccountWide = (key: string, candidate: RawLiveRateLimits): boolean =>
    ACCOUNT_WIDE_LIVE_LIMIT_IDS.has(candidate.limitId ?? key);
  const scopedWeeklyResets = entries
    .filter(([key, candidate]) => isModelScopedCodexLimit(candidate.limitName) || !keyIsAccountWide(key, candidate))
    .map(([, candidate]) => liveWeeklyResetsAt(candidate))
    .filter((resetsAt): resetsAt is number => typeof resetsAt === 'number');
  const unnamed = (candidate?: RawLiveRateLimits | null): candidate is RawLiveRateLimits =>
    !!candidate && !isModelScopedCodexLimit(candidate.limitName);
  const notAKnownPool = (candidate: RawLiveRateLimits): boolean => {
    const weekly = liveWeeklyResetsAt(candidate);
    if (typeof weekly !== 'number') return true;
    // Tolerant, like the passive-side comparison and for the same reason: the
    // instants jitter by seconds, so an exact set membership would answer "not a
    // pool" for a reading that is one.
    return !scopedWeeklyResets.some((pool) => sameWeeklyReset(weekly * 1000, pool * 1000));
  };

  if (unnamed(top) && notAKnownPool(top)) return top;
  // The key tightens the PREFERRED rungs only. An id this file has never seen is
  // excluded from them but still reachable by the last resort — OpenAI adds
  // families on its own schedule, and an allow-list that could return nothing at
  // all would turn a new account-wide id into a vanished gauge.
  // Overriding the top level is the strong move, so it takes positive evidence:
  // a replacement must be unnamed, unlike any pool this response names, AND
  // actually carry a weekly window. Without that last clause the ladder could
  // answer a fingerprint COLLISION — two windows opened in the same instant —
  // by returning whichever unnamed entry came first in iteration order, and a
  // windowless credit block qualifies precisely because it has no fingerprint to
  // collide with. `parseLiveCodexRateLimits` then accepts it on `limitId` alone
  // and, being the newest reading by construction, it displaces the account's
  // real windows with a synthetic 100% credit gauge.
  for (const [key, candidate] of entries) {
    if (
      unnamed(candidate) &&
      keyIsAccountWide(key, candidate) &&
      notAKnownPool(candidate) &&
      liveWeeklyResetsAt(candidate) != null
    ) {
      return candidate;
    }
  }
  if (unnamed(top)) return top;
  // Last resort, and it keeps the same preference: an unnamed entry that has a
  // window before one that has none. Reached when the top level is absent or
  // named-scoped, and without the ordering it returns whatever comes first in
  // key order — which is how a windowless `premium` credit block was picked
  // ahead of a real windowed `codex` entry sitting in the same map.
  for (const [, candidate] of entries) {
    if (unnamed(candidate) && liveWeeklyResetsAt(candidate) != null) return candidate;
  }
  for (const [, candidate] of entries) {
    if (unnamed(candidate)) return candidate;
  }
  return null;
}

function codexBinary(): string {
  return process.env.AGENTDECK_CODEX_BIN || (process.platform === 'win32' ? 'codex.cmd' : 'codex');
}

/**
 * How to hand the Codex binary to `spawn`.
 *
 * Windows ships the CLI as `codex.cmd`, and since the CVE-2024-27980 fix
 * (Node 18.20.2 / 20.12.2 / 21.7.3+, so every Node this repo supports) `spawn`
 * REFUSES a `.cmd`/`.bat` target unless `shell: true` — it throws EINVAL. Without
 * this the live query would fail on every Windows host, and because a miss is
 * indistinguishable from "no Codex installed" it would settle into the 30-minute
 * failure backoff and never say why. Under a shell the command line is re-parsed,
 * so a path containing spaces has to carry its own quotes.
 *
 * Exported for unit testing: the branch is unreachable on the CI platform.
 */
export function codexSpawnPlan(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; shell: boolean } {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(binary)) return { command: binary, shell: false };
  return { command: /\s/.test(binary) ? `"${binary}"` : binary, shell: true };
}

/**
 * Spawn `codex app-server`, ask for the account rate limits, kill it, and return
 * the parsed snapshot. Resolves null on any miss (binary absent, protocol
 * mismatch, timeout) — never rejects, so callers can treat it as best-effort.
 */
export async function queryCodexRateLimitsLive(
  opts: { binary?: string; args?: string[]; timeoutMs?: number } = {},
): Promise<CodexRateLimits | null> {
  const binary = opts.binary ?? codexBinary();
  const args = opts.args ?? ['app-server'];
  const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;

  const plan = codexSpawnPlan(binary);

  return new Promise<CodexRateLimits | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.command, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: plan.shell });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: CodexRateLimits | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
        // Under a shell the child is cmd.exe and the real server is its grandchild;
        // terminating the shell alone would orphan a Codex process every 5 minutes.
        if (plan.shell && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
        }
      } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    // The daemon must never be held open by a probe.
    if (typeof timer.unref === 'function') timer.unref();

    child.on('error', () => finish(null));
    // A server that exits on its own never answered us.
    child.on('exit', () => finish(null));
    child.stdin?.on('error', () => finish(null));

    let buffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: unknown; result?: unknown };
        try {
          msg = JSON.parse(line) as { id?: unknown; result?: unknown };
        } catch {
          continue; // notifications may interleave; keep reading
        }
        if (msg?.id === RATE_LIMITS_REQUEST_ID) {
          finish(parseLiveCodexRateLimits(msg.result, new Date().toISOString()));
          return;
        }
      }
    });

    const frames = [
      { jsonrpc: '2.0', id: INITIALIZE_REQUEST_ID, method: 'initialize', params: { clientInfo: { name: 'agentdeck', title: 'AgentDeck', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'initialized', params: {} },
      { jsonrpc: '2.0', id: RATE_LIMITS_REQUEST_ID, method: 'account/rateLimits/read', params: {} },
    ];
    try {
      child.stdin?.write(frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
    } catch {
      finish(null);
    }
  });
}

function capturedAtMs(rl?: CodexRateLimits | null): number {
  if (!rl?.capturedAt) return 0;
  const ms = new Date(rl.capturedAt).getTime();
  return isNaN(ms) ? 0 : ms;
}

/** A window this long or longer is the weekly one. The 5h window's `resetsAt`
 *  slides with every request, so only the weekly reset instant is stable enough
 *  to identify a limit family across snapshots. */
const WEEKLY_WINDOW_MIN_MINUTES = 1440;

function weeklyWindow(rl: CodexRateLimits): CodexRateLimitWindow | undefined {
  for (const window of [rl.primary, rl.secondary]) {
    if (!window || typeof window.windowMinutes !== 'number') continue;
    if (window.windowMinutes < WEEKLY_WINDOW_MIN_MINUTES) continue;
    // `continue`, not `return`: a weekly window can reach here with its reset
    // stripped (`normalizeCodexWindow` clears it once the window has elapsed),
    // and returning on the first long slot would then report "no fingerprint"
    // while the other slot still carries one. Its twin `liveWeeklyResetsAt`
    // reads the same way — two helpers documented as computing one fingerprint
    // must not disagree about which slot answers.
    if (window.resetsAt) return window;
  }
  return undefined;
}

/**
 * Whether a reading's weekly anchor is ROLLING — sitting a full window ahead of
 * its own capture — rather than pinned to a window that has already started.
 * Undefined when the reading carries no capture stamp: no claim either way.
 */
function weeklyAnchorIsRolling(rl: CodexRateLimits): boolean | undefined {
  const window = weeklyWindow(rl);
  const resetsMs = weeklyResetsAtMs(rl);
  const capturedMs = rl.capturedAt ? new Date(rl.capturedAt).getTime() : NaN;
  if (!window || resetsMs == null || isNaN(capturedMs)) return undefined;
  return resetsMs - capturedMs >= window.windowMinutes * 60 * 1000 - FAMILY_RESET_TOLERANCE_MS;
}

function weeklyResetsAtMs(rl: CodexRateLimits): number | undefined {
  const resetsAt = weeklyWindow(rl)?.resetsAt;
  if (!resetsAt) return undefined;
  const ms = new Date(resetsAt).getTime();
  return isNaN(ms) ? undefined : ms;
}

/**
 * How far two weekly reset instants may sit apart and still be the same window.
 *
 * Codex does not report a fixed instant. Measured over 32,753 weekly-bearing
 * `rate_limits` lines in a real store (14 days), the account family's 21 raw
 * values collapse to 10 windows, each carrying a few seconds of jitter — the
 * same window appears as `1788274878` and `1788274890`, twelve seconds apart —
 * while the passive and live readings are by construction taken at different
 * instants. Compared exactly, ~4% of same-family pairs read as a family change:
 * a correct rollout is discarded for a cached live snapshot up to five minutes
 * old, the mid-turn spawn skip is lifted for as long as Codex is in use, and the
 * relay guard's authority reads false in the ordinary good case.
 *
 * Ten minutes is the middle of a band that is narrower than it first looks.
 * Clustering the account family's 105 raw anchors at successive tolerances: at
 * 600s they collapse to 33 windows whose widest internal spread is 240s, and the
 * closest two DISTINCT windows sit 1,848s apart. So the floor is ~4 minutes of
 * jitter and the ceiling is ~31 minutes of real separation — an earlier draft of
 * this comment claimed the ceiling was 1.5 days, which was true only of the
 * 14-day sample it was measured on. 600s is ~2.5× the observed jitter and ~1/3
 * of the closest real gap.
 */
const FAMILY_RESET_TOLERANCE_MS = 10 * 60 * 1000;

/** How long a live answer may speak for the account's current weekly window.
 *  Three query intervals: a healthy daemon refreshes every
 *  `MIN_QUERY_INTERVAL_MS`, so this survives a couple of skipped builds while
 *  still expiring long before a re-anchor could go unnoticed. */
const LIVE_FAMILY_AUTHORITY_MAX_AGE_MS = 3 * MIN_QUERY_INTERVAL_MS;

function sameWeeklyReset(aMs: number, bMs: number): boolean {
  return Math.abs(aMs - bMs) <= FAMILY_RESET_TOLERANCE_MS;
}

/**
 * Whether a snapshot's family fingerprint is good enough to REJECT another
 * reading — it must carry a weekly window, and that window must still be
 * running.
 *
 * Both halves are the same rule seen twice, and both directions were wrong
 * before. An ELAPSED window describes something that no longer exists, so it is
 * not evidence about the current family; the account's own weekly rollover
 * reaches the rollout first and reads as a mismatch, and without this bound a
 * live query that then starts missing pins an expired snapshot for the whole
 * backoff. An ABSENT window is not evidence either, and reading absence as "no
 * reason to doubt it" is how a windowless credit-plan block (`limit_id:
 * "premium"`, no windows — a shape `parseLiveCodexRateLimits` explicitly admits)
 * came to veto a fully-windowed passive reading captured seconds ago: the ids
 * differ, so `codexSnapshotsShareLimitFamily` answers before its own weekly
 * check ever runs, and every Codex gauge blanks because consumers test for a
 * window, not for the block. Rejecting is the strong move; only a fingerprint
 * that exists and is current may make it.
 */
function familyFingerprintCanReject(rl: CodexRateLimits, nowMs: number): boolean {
  const window = weeklyWindow(rl);
  const resetsMs = weeklyResetsAtMs(rl);
  if (!window || resetsMs == null) return false;
  if (resetsMs <= nowMs) return false;
  // An anchor is a discriminator, but it is never immutable, so authority has to
  // decay with the reading's own age. Measured over 45,743 account-family weekly
  // readings (2026-07-03 → 08-27): 104 distinct anchors, and in 103 of the 104
  // changes the OLD anchor was still 1.6–7.0 days in the future when the new one
  // first appeared. So window expiry cannot detect a re-anchor — at every one of
  // them a cached snapshot would go on vetoing the fresh rollout, indefinitely
  // once the query enters its 30-minute backoff or the `codex` binary goes away
  // after one good answer. A live answer refreshed at most every
  // MIN_QUERY_INTERVAL_MS may speak for the current window for a few intervals;
  // past that it is a claim about a window that may no longer be the one running,
  // and the fresh rollout is the better guess. An unstamped reading has no age
  // and therefore no authority.
  const capturedMs = rl.capturedAt ? new Date(rl.capturedAt).getTime() : NaN;
  if (isNaN(capturedMs)) return false;
  if (nowMs - capturedMs > LIVE_FAMILY_AUTHORITY_MAX_AGE_MS) return false;
  // A ROLLING window identifies nothing. Measured in the same store, the
  // per-model pool's weekly reset takes 749 distinct values — one per request,
  // sliding 43 minutes in step with the clock — because `resets_at` there is
  // always one full window ahead of the reading (`resets_at − timestamp` pinned
  // at ~604,790s of a 604,800s window). That is a countdown, not an anchor, and
  // an anchor is the entire job here: the elapsed-window escape can never
  // retire it, so left unchecked such a fingerprint could veto every passive
  // reading for as long as it stayed cached. A fixed window looks like this
  // only in its first minutes, where falling back to recency costs nothing.
  return weeklyAnchorIsRolling(rl) !== true;
}

/**
 * Whether the live reading contradicts the passive one about WHOSE quota it is.
 * The picker uses it to prefer the live snapshot; the throttle uses its negation
 * to decide whether the passive snapshot's freshness may suppress the next
 * query. One expression, because written as two they drifted immediately: the
 * throttle compared families against a cached live snapshot with no bound at
 * all, so once that snapshot's window elapsed the mid-turn skip was lifted
 * permanently while the picker had already stopped honouring the same
 * fingerprint.
 *
 * The two consumers still REACH it differently, and that is deliberate rather
 * than drift. The picker settles plan disagreement first and never asks this at
 * all when the classes differ; the throttle asks it regardless, because a cached
 * live snapshot minted under a retired plan is itself a reason to spend a query
 * — the answer that replaces it is the only thing that can end the disagreement.
 * The cost is bounded by the same spawn throttles as everything else here.
 *
 * The throttle must NOT reuse this predicate, and that is the whole point of
 * `liveCorroboratesPassiveFamily` below. Exported for unit testing.
 */
export function liveRejectsPassiveFamily(
  passive?: CodexRateLimits | null,
  live?: CodexRateLimits | null,
  nowMs: number = Date.now(),
): boolean {
  if (!passive || !live) return false;
  if (codexSnapshotsShareLimitFamily(passive, live)) return false;
  return familyFingerprintCanReject(live, nowMs);
}

/**
 * True when two snapshots describe the same limit FAMILY — or when there is not
 * enough information to say they do not.
 *
 * `isModelScopedCodexLimit` reads the family off the snapshot's own `limit_name`,
 * and that discriminator stopped being reliable on the rollout path. Measured
 * 2026-08-27, inside a single rollout file, after the account's weekly quota was
 * exhausted:
 *
 *   ...T20:59:45Z  limit_id "codex"    limit_name null   weekly resets 1788274890   (the account)
 *   ...T20:59:46Z  limit_id "premium"  limit_name null   no windows at all
 *   ...T13:01:31Z  limit_id "codex"    limit_name null   5h + weekly resets 1788440488
 *
 * That third shape is `codex_bengalfox` ("GPT-5.3-Codex-Spark") wearing the
 * account's id: `account/rateLimits/read` returned the SAME two reset instants
 * under `rateLimitsByLimitId.codex_bengalfox` at that moment, while the account
 * family sat at 100% with `rateLimitReachedType: "rate_limit_reached"`. So once
 * the account limit is reached and Codex serves the turn from a per-model pool,
 * the rollout records that pool's numbers under an unnamed `codex` label and the
 * name-based filter admits them: the deck read 54% / 24% for an exhausted week.
 *
 * The live read is the only source that keys families correctly, so it is what
 * the passive reading is checked against. Two rules keep the check honest:
 * an unknown on either side is "no information" and matches (a pre-`limit_id`
 * rollout, a credit plan with no weekly window), and a mismatch is resolved by
 * preferring the LIVE snapshot rather than by dropping both — the mismatch also
 * arises legitimately for a few minutes after the account's weekly window rolls
 * over, and there the live answer is merely stale, never wrong about whose
 * quota it is. Exported for unit testing.
 */
export function codexSnapshotsShareLimitFamily(
  a?: CodexRateLimits | null,
  b?: CodexRateLimits | null,
): boolean {
  if (!a || !b) return true;
  if (!a.limitId || !b.limitId) return true;
  if (a.limitId !== b.limitId) return false;
  const aWeekly = weeklyResetsAtMs(a);
  const bWeekly = weeklyResetsAtMs(b);
  if (aWeekly == null || bWeekly == null) return true;
  // KNOWN BLIND SPOT, stated rather than papered over. The pool's anchor slides a
  // second per second, so once a week it sweeps THROUGH the account's fixed
  // anchor and spends ~20 minutes inside the tolerance, during which a pool
  // reading is indistinguishable from the account's here. Two things that look
  // like fixes are not. Shrinking the tolerance cannot close it — the floor is
  // 240s of measured jitter. And "one anchor is rolling, the other is pinned"
  // cannot either: the sweep instant is by construction the account window's own
  // start (the pool's anchor equals A exactly when captured at A − 7d, which is
  // when the account's window beginning at A − 7d starts), so at that moment BOTH
  // readings sit a full window ahead of their capture and the shape test answers
  // "same" too. What bounds the damage is that the account has just reset there,
  // so the reading being shadowed is the one at ~0%.
  return sameWeeklyReset(aWeekly, bWeekly);
}

/**
 * Choose between the passive rollout reading and the live app-server reading.
 *
 * Plan agreement first, capture time second (`codexSnapshotOutranks`). Recency
 * alone let the wrong one win in exactly the case the live query exists to
 * cover: a Codex session opened before a plan change keeps writing old-plan
 * rollout snapshots with ever-newer timestamps, so the live answer — correct,
 * current, and the ONLY source carrying the new tier — lost every comparison and
 * was then voided as a mismatch. A snapshot with no `capturedAt` at all loses to
 * a stamped one within its match class; ties keep the passive reading, which is
 * the on-disk ground truth.
 *
 * Family agreement is a tie-break WITHIN the plan class, and settled before
 * recency, which cannot see it: the rollout is appended every couple of seconds
 * while Codex works, so a snapshot describing a per-model pool under the
 * account's id (see `codexSnapshotsShareLimitFamily`) wins every recency
 * comparison for as long as the session runs, and the true account reading only
 * surfaces in the gaps where the live query gets to fire. That is the
 * oscillation this guard removes — the same gauge alternating between an
 * exhausted week and a half-used one depending on which source answered last.
 *
 * It must stay UNDER the plan test, because a plan change moves the weekly reset
 * instant too (`1787805401` under `plus` → `1787934975` under `prolite`, same
 * `limit_id: "codex"`, both verbatim in `codex-rate-limits.test.ts`). Ranked
 * above it, the family guard would answer a plan change by handing back the
 * retired-plan live snapshot — which `normalizeCodexRateLimits` then voids to a
 * windowless block, blanking every Codex gauge for up to the failure backoff.
 * That is precisely the regression `codexSnapshotOutranks` exists to prevent,
 * reintroduced through the door next to it.
 *
 * Only a live snapshot whose own weekly window exists AND is still running gets
 * to reject anything (`familyFingerprintCanReject`) — an expired or absent
 * fingerprint is not evidence about which family the current window belongs to.
 * Exported for unit testing; `nowMs` is injectable for the same reason.
 */
export function pickBestCodexRateLimits(
  passive: CodexRateLimits | null,
  live: CodexRateLimits | null,
  accountPlan?: string,
  nowMs: number = Date.now(),
  opts: { liveOwnsFamilyAuthority?: boolean } = {},
): CodexRateLimits | null {
  if (!live) return passive;
  if (!passive) return live;
  const livePlanMatches = codexSnapshotMatchesAccountPlan(live.planType, accountPlan);
  const passivePlanMatches = codexSnapshotMatchesAccountPlan(passive.planType, accountPlan);
  if (livePlanMatches !== passivePlanMatches) return livePlanMatches ? live : passive;
  if (opts.liveOwnsFamilyAuthority !== false && liveRejectsPassiveFamily(passive, live, nowMs)) {
    return live;
  }
  return codexSnapshotOutranks(
    { planType: live.planType, capturedAtMs: capturedAtMs(live) },
    { planType: passive.planType, capturedAtMs: capturedAtMs(passive) },
    accountPlan,
  )
    ? live
    : passive;
}

/** Throttle policy, kept pure so the cadence is testable without spawning. */
export function shouldQueryCodexRateLimitsLive(input: {
  nowMs: number;
  lastAttemptMs: number;
  consecutiveFailures: number;
  passiveCapturedAtMs: number;
  /** False when the passive snapshot is stamped with a plan the account no
   *  longer holds — i.e. it is about to be voided and carries no usable number.
   *  Defaults to true so callers that know no account tier behave as before. */
  passivePlanMatchesAccount?: boolean;
  /** False when the passive snapshot describes a different limit family from the
   *  last live answer — it is then a different QUANTITY, not a fresher reading of
   *  the same one, so its freshness must not suppress the query that carries the
   *  account's number. Defaults to true (no live answer yet ⇒ nothing to compare
   *  against). */
  passiveMatchesAccountFamily?: boolean;
}): boolean {
  const {
    nowMs,
    lastAttemptMs,
    consecutiveFailures,
    passiveCapturedAtMs,
    passivePlanMatchesAccount = true,
    passiveMatchesAccountFamily = true,
  } = input;
  const interval =
    consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? FAILURE_BACKOFF_MS : MIN_QUERY_INTERVAL_MS;
  // Spawn throttles are unconditional: a mismatch is a reason to prefer the live
  // read, never a licence to spawn a subprocess on every usage build.
  if (lastAttemptMs > 0 && nowMs - lastAttemptMs < interval) return false;
  // Nothing has ever been asked. There is no baseline to compare a passive
  // snapshot's limit family against, and on a machine where Codex is in constant
  // use the freshness skip below would keep it that way for as long as the
  // daemon lives — the family guard would then never engage, which is exactly
  // the busy machine it exists for. One spawn per daemon start buys the
  // baseline; the throttles govern every query after it.
  if (lastAttemptMs === 0) return true;
  // Codex is mid-turn: the rollout is already writing fresh readings — but only
  // if those readings are usable at all. A snapshot stamped with a retired plan
  // is voided downstream, so "the passive read is fresh" would suppress the one
  // source that still has a number, precisely while Codex is being used hardest.
  // The same reasoning covers the family axis: a rollout pouring out per-model
  // pool readings every two seconds is the state in which the account's own
  // number is least visible and most wanted, so it must not throttle the only
  // source that can still report it.
  if (
    passivePlanMatchesAccount &&
    passiveMatchesAccountFamily &&
    passiveCapturedAtMs > 0 &&
    nowMs - passiveCapturedAtMs < PASSIVE_FRESH_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Whether a published Codex block may speak for the account's limit FAMILY —
 * the question the relay path has to answer before it lets that block reject a
 * session bridge's.
 *
 * It is deliberately NOT "did the live snapshot win the last pick". Identity
 * with the pick is false in the ordinary good case: when the two readings agree
 * on family the picker keeps the fresher rollout, which while Codex is working
 * is every single build. Read that way, the guard switched itself off exactly
 * when the daemon did hold a verified baseline — and a bridge sampling a
 * mislabelled pool line a second later then won on recency, which is the
 * oscillation this whole change removes, surviving at the one call site that
 * had no other defence.
 *
 * The real question is whether a live answer exists, carries a fingerprint that
 * may reject (`familyFingerprintCanReject`), and agrees with what was published.
 * A plan-voided live snapshot fails the second test rather than lending its
 * authority to a passive block that outranked it for unrelated reasons.
 *
 * Takes the live block rather than reading the module cache, so the rule can be
 * driven directly instead of only through a spawn.
 */
export function codexBlockHasLiveFamilyAuthority(
  published?: CodexRateLimits | null,
  live?: CodexRateLimits | null,
  nowMs: number = Date.now(),
): boolean {
  if (!published || !live) return false;
  if (!familyFingerprintCanReject(live, nowMs)) return false;
  return codexSnapshotsShareLimitFamily(published, live);
}

/**
 * Whether the cached live answer positively vouches for the passive reading's
 * family — the THROTTLE's question, and deliberately not the picker's.
 *
 * Routing the throttle through `liveRejectsPassiveFamily` deadlocked the two
 * bounds against each other on exactly the busy machine this change is for. The
 * skip suppresses queries while the rollout is fresh, so under continuous Codex
 * use the cached answer is never refreshed; fifteen minutes in it loses its
 * authority; and from then on a disagreement could no longer be REPORTED as one,
 * because the age bound lives inside the rejection test. `passiveMatchesAccountFamily`
 * stayed true, the skip stayed engaged, no query ever fired, and the picker fell
 * through to recency — publishing the mislabelled pool reading for the rest of
 * the run.
 *
 * So the polarity is inverted here on purpose: the skip is earned by a live
 * answer that is present, still able to arbitrate, and in agreement. Anything
 * else — no answer, a stale one, a disagreeing one — is a REASON to spend a
 * query, never a reason to skip one. The spawn throttles bound the cost either
 * way. Exported for unit testing.
 */
export function liveCorroboratesPassiveFamily(
  passive?: CodexRateLimits | null,
  live?: CodexRateLimits | null,
  nowMs: number = Date.now(),
): boolean {
  if (!passive || !live) return false;
  if (!codexSnapshotsShareLimitFamily(passive, live)) return false;
  return familyFingerprintCanReject(live, nowMs);
}

let cachedLive: CodexRateLimits | null = null;
let lastAttemptMs = 0;
let consecutiveFailures = 0;
let inFlight = false;

/** Last live snapshot, or null if none has been obtained. */
export function getLiveCodexRateLimits(): CodexRateLimits | null {
  return cachedLive;
}

/**
 * Daemon entry point: return the better of the passive and live readings, and
 * kick off a throttled background refresh when the passive one has gone quiet
 * OR has been minted under a plan the account no longer holds. Fire-and-forget
 * by design — the current call is answered from cache so usage building never
 * awaits a subprocess.
 *
 * `accountPlan` is the live tier from `auth.json`. Passing it is what lets both
 * halves of this function tell "old" from "void"; omitting it keeps the previous
 * newest-wins behaviour.
 *
 * The third axis needs no argument: the last live answer is itself the record of
 * which limit family belongs to the account, so a passive snapshot describing a
 * different one is neither preferred nor allowed to throttle the next query
 * (`codexSnapshotsShareLimitFamily`).
 */
export function codexRateLimitsWithLiveRefresh(
  passive: CodexRateLimits | null,
  accountPlan?: string,
): CodexRateLimits | null {
  if (process.env.AGENTDECK_CODEX_LIVE_USAGE !== '0') {
    const nowMs = Date.now();
    if (
      !inFlight &&
      shouldQueryCodexRateLimitsLive({
        nowMs,
        lastAttemptMs,
        consecutiveFailures,
        passiveCapturedAtMs: capturedAtMs(passive),
        passivePlanMatchesAccount: codexSnapshotMatchesAccountPlan(passive?.planType, accountPlan),
        passiveMatchesAccountFamily: liveCorroboratesPassiveFamily(passive, cachedLive, nowMs),
      })
    ) {
      inFlight = true;
      lastAttemptMs = nowMs;
      void queryCodexRateLimitsLive()
        .then((live) => {
          if (live) {
            cachedLive = live;
            consecutiveFailures = 0;
          } else {
            consecutiveFailures += 1;
          }
        })
        .catch(() => {
          consecutiveFailures += 1;
        })
        .finally(() => {
          inFlight = false;
        });
    }
  }
  return pickBestCodexRateLimits(passive, cachedLive, accountPlan);
}

/** Test hook — clears the module-level cache and throttle state. */
export function __resetCodexRateLimitsLiveForTest(seed?: {
  cachedLive?: CodexRateLimits | null;
  lastAttemptMs?: number;
}): void {
  cachedLive = seed?.cachedLive ?? null;
  lastAttemptMs = seed?.lastAttemptMs ?? 0;
  consecutiveFailures = 0;
  inFlight = false;
}

/** Throttle state, so a test can tell "a query was spent" from "the skip held".
 *  `lastAttemptMs` moves synchronously, before any subprocess exists. */
export function __peekCodexRateLimitsLiveForTest(): { lastAttemptMs: number } {
  return { lastAttemptMs };
}
