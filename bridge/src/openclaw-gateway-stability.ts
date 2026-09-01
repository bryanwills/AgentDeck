/**
 * OpenClaw Gateway instability — detect a restart storm and say why.
 *
 * A Gateway restart is invisible from inside the daemon: the socket closes,
 * `disconnectGatewayAdapter` tears the virtual session down, the probe finds
 * the port again a few seconds later and everything reconnects. Each cycle
 * looks like a healthy recovery, and a surface that watched it saw the
 * OpenClaw row flip to `gateway_not_found` and back. On 2026-09-02 that
 * happened eleven times in ninety minutes and nothing anywhere said so —
 * the daemon log carried eleven `connected` lines, every dashboard showed
 * a connected Gateway between flaps, and the cause (two OpenClaw installs
 * fighting over `~/.openclaw/state`, a launchd KeepAlive respawning a
 * Gateway whose startup migration could not run because the other copy
 * held the state, and a plugin install restarting it on top) was written
 * only in OpenClaw's own log, which no surface reads.
 *
 * Two pieces, both pure so a test can drive them with a clock and a string:
 *
 * - `GatewayFlapTracker` counts disconnects inside a rolling window. Three
 *   in ten minutes is the line between "a plugin install restarted it" and
 *   "something is wrong": a single deliberate restart never crosses it, and
 *   the measured storm crossed it inside four minutes.
 * - `diagnoseGatewayLog` reads the Gateway's own log tail for the sentences
 *   OpenClaw prints when it knows what is happening. Structural causes
 *   (another Gateway owns the state directory, the restart-loop breaker
 *   tripped, a startup migration refused to complete) outrank routine ones
 *   (a config-change restart, a plain SIGTERM) regardless of which line is
 *   newer, because the routine restart is usually the symptom that the
 *   structural cause produced.
 *
 * The daemon surfaces the result three ways so it cannot hide: a loud log
 * line, an `instability` field on `/status` and `/health`, and one `error`
 * timeline row per escalation on the virtual `openclaw-gateway` session —
 * the timeline is the one channel every surface already renders, Android
 * and e-ink included, without a protocol change.
 */

import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GATEWAY_FLAP_WINDOW_MS = 10 * 60_000;
export const GATEWAY_FLAP_THRESHOLD = 3;

/** Bytes read from the end of the Gateway log when diagnosing a storm. */
export const GATEWAY_LOG_TAIL_BYTES = 64 * 1024;

export type GatewayInstabilityKind =
  | 'state_owner_conflict'
  | 'restart_loop'
  | 'migration_failed'
  | 'config_restart'
  | 'external_sigterm';

export interface GatewayLogDiagnosis {
  kind: GatewayInstabilityKind;
  /** The Gateway log line that carries the reason, trimmed. */
  line: string;
  /** What an operator should do about it, one sentence. */
  hint: string;
}

export interface GatewayInstability {
  flapsInWindow: number;
  windowMs: number;
  /** Epoch ms of the oldest disconnect still inside the window. */
  since: number;
  /** Epoch ms of the disconnect that produced this assessment. */
  lastFlapAt: number;
  diagnosis: GatewayLogDiagnosis | null;
}

/**
 * Sentinels in priority order. The first kind found anywhere in the tail
 * wins, so a structural cause explains a storm even when the most recent
 * line is the routine restart it caused.
 */
const SENTINELS: ReadonlyArray<{
  kind: GatewayInstabilityKind;
  pattern: RegExp;
  hint: string;
}> = [
  {
    kind: 'state_owner_conflict',
    pattern: /another Gateway owns that state directory/i,
    hint:
      'Two OpenClaw Gateways are using one ~/.openclaw/state — usually two installs ' +
      '(a global npm/pnpm copy beside the app-managed ~/.openclaw/tools runtime). ' +
      'Keep one; make sure `openclaw` on PATH is ~/.openclaw/bin/openclaw.',
  },
  {
    kind: 'restart_loop',
    pattern: /restart-loop breaker tripped/i,
    hint:
      'OpenClaw\'s own breaker saw repeated unclean boots; launchd KeepAlive is ' +
      'respawning a Gateway that cannot come up. Read ~/Library/Logs/openclaw/gateway.log.',
  },
  {
    kind: 'migration_failed',
    pattern: /startup migrations did not complete cleanly|migration requires stopped-writer maintenance/i,
    hint:
      'A startup migration refused to run because another writer holds the state. ' +
      'Stop every other Gateway, then restart this one once.',
  },
  {
    kind: 'config_restart',
    pattern: /config change requires gateway restart|received SIGUSR1; restarting|Restart the gateway to (apply|load)/i,
    hint: 'A config or plugin change asked the Gateway to restart. Expected once; a storm of these is not.',
  },
  {
    kind: 'external_sigterm',
    pattern: /received SIGTERM; shutting down/i,
    hint: 'Something sent the Gateway SIGTERM (a CLI restart, an updater, or launchd). Check who.',
  },
];

export class GatewayFlapTracker {
  private stamps: number[] = [];

  constructor(
    private readonly windowMs: number = GATEWAY_FLAP_WINDOW_MS,
    private readonly threshold: number = GATEWAY_FLAP_THRESHOLD,
  ) {}

  /** Record a disconnect at `nowMs`; returns the count inside the window including it. */
  record(nowMs: number): number {
    this.stamps.push(nowMs);
    this.prune(nowMs);
    return this.stamps.length;
  }

  /**
   * How many disconnects are inside the window, and whether that crosses the
   * line. `since` is the oldest one still counted — the start of the storm.
   */
  assess(nowMs: number): { flapsInWindow: number; unstable: boolean; since: number | null } {
    this.prune(nowMs);
    return {
      flapsInWindow: this.stamps.length,
      unstable: this.stamps.length >= this.threshold,
      since: this.stamps.length > 0 ? this.stamps[0] : null,
    };
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0] < cutoff) this.stamps.shift();
  }
}

/**
 * Scan a Gateway log tail for the sentence that explains a restart storm.
 * Returns the highest-priority kind present, carrying its most recent line.
 * `null` means the tail has no known sentinel — the storm is real but the
 * log does not say why, and the surfaces should say exactly that.
 */
export function diagnoseGatewayLog(text: string): GatewayLogDiagnosis | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (const sentinel of SENTINELS) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (sentinel.pattern.test(lines[i])) {
        return { kind: sentinel.kind, line: lines[i].trim().slice(0, 300), hint: sentinel.hint };
      }
    }
  }
  return null;
}

/** Default locations of the Gateway's launchd stdout log, most likely first. */
export function defaultGatewayLogPaths(home: string = homedir()): string[] {
  return [join(home, 'Library', 'Logs', 'openclaw', 'gateway.log')];
}

/**
 * Read the last `maxBytes` of the first readable log path. Best-effort:
 * an unreadable or absent log yields an empty string, never a throw —
 * the storm is still reported, only without a reason.
 */
export async function readGatewayLogTail(
  paths: string[] = defaultGatewayLogPaths(),
  maxBytes: number = GATEWAY_LOG_TAIL_BYTES,
): Promise<string> {
  for (const path of paths) {
    let handle;
    try {
      handle = await open(path, 'r');
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } catch {
      continue;
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return '';
}

/** One line for the timeline row and the daemon log; ≤ ~180 chars. */
export function formatGatewayInstability(i: GatewayInstability): string {
  const minutes = Math.max(1, Math.round((i.lastFlapAt - i.since) / 60_000));
  const head = `OpenClaw Gateway unstable · ${i.flapsInWindow} restarts in ${minutes} min`;
  const why = i.diagnosis ? describeKind(i.diagnosis.kind) : 'reason not in the Gateway log';
  return `${head} — ${why}`;
}

export function describeKind(kind: GatewayInstabilityKind): string {
  switch (kind) {
    case 'state_owner_conflict': return 'two Gateways own ~/.openclaw/state (duplicate install?)';
    case 'restart_loop': return 'OpenClaw restart-loop breaker tripped';
    case 'migration_failed': return 'startup migration blocked by another writer';
    case 'config_restart': return 'config/plugin change restarts';
    case 'external_sigterm': return 'repeated external SIGTERM';
  }
}
