import { describe, expect, it } from 'vitest';
import {
  GATEWAY_FLAP_THRESHOLD,
  GATEWAY_FLAP_WINDOW_MS,
  GatewayFlapTracker,
  describeKind,
  diagnoseGatewayLog,
  formatGatewayInstability,
} from '../openclaw-gateway-stability.js';

// Lines copied verbatim from ~/Library/Logs/openclaw/gateway.log on
// 2026-09-02, the storm this module exists for. A fixture composed from the
// matcher's own regexes would agree with it forever; these are what OpenClaw
// actually printed.
const OWNER_CONFLICT =
  '2026-09-02T01:21:51.000+09:00 [gateway] OpenClaw refused shared state schema mutation at ' +
  '/Users/x/.openclaw/state/openclaw.sqlite because another Gateway owns that state directory. St';
const BREAKER =
  '2026-09-02T00:35:22.000+09:00 [gateway] gateway restart-loop breaker tripped: 3 unclean boot(s) ' +
  'within 300000ms; suppressing channel/provider account auto-start. Inspect the stability bundle';
const MIGRATION =
  '2026-09-02T00:32:46.000+09:00 [gateway] OpenClaw startup migrations did not complete cleanly; ' +
  'refusing to report the gateway ready.';
const CONFIG_RESTART =
  '2026-09-02T01:55:00.000+09:00 [gateway] config change requires gateway restart (plugins.installs.line.spec)';
const SIGUSR1 = '2026-09-02T01:55:01.195+09:00 [gateway] received SIGUSR1; restarting';
const SIGTERM = '2026-09-02T01:56:36.638+09:00 [gateway] received SIGTERM; shutting down';
const LISTENING =
  '2026-09-02T01:56:49.820+09:00 [gateway] http server listening (16 plugins: bonjour, browser; 5.1s)';

describe('GatewayFlapTracker', () => {
  it('is quiet below the threshold and trips exactly at it', () => {
    const t = new GatewayFlapTracker();
    const t0 = 1_000_000;
    for (let i = 1; i < GATEWAY_FLAP_THRESHOLD; i++) {
      t.record(t0 + i * 1000);
      expect(t.assess(t0 + i * 1000).unstable).toBe(false);
    }
    t.record(t0 + GATEWAY_FLAP_THRESHOLD * 1000);
    const a = t.assess(t0 + GATEWAY_FLAP_THRESHOLD * 1000);
    expect(a.unstable).toBe(true);
    expect(a.flapsInWindow).toBe(GATEWAY_FLAP_THRESHOLD);
    expect(a.since).toBe(t0 + 1000);
  });

  it('forgets flaps older than the window, so one deliberate restart an hour never accumulates', () => {
    const t = new GatewayFlapTracker();
    const t0 = 5_000_000;
    t.record(t0);
    t.record(t0 + GATEWAY_FLAP_WINDOW_MS + 1);
    t.record(t0 + 2 * (GATEWAY_FLAP_WINDOW_MS + 1));
    const a = t.assess(t0 + 2 * (GATEWAY_FLAP_WINDOW_MS + 1));
    expect(a.flapsInWindow).toBe(1);
    expect(a.unstable).toBe(false);
  });

  it('matches the measured storm: eleven disconnects inside ninety minutes trip within the first four', () => {
    // Daemon-log timestamps from 2026-09-01 (UTC), minutes after 15:38.
    const minutes = [2, 4, 6, 25, 25.7, 28, 42, 77];
    const t = new GatewayFlapTracker();
    let trippedAtMinute: number | null = null;
    for (const m of minutes) {
      const now = m * 60_000;
      t.record(now);
      if (trippedAtMinute === null && t.assess(now).unstable) trippedAtMinute = m;
    }
    expect(trippedAtMinute).toBe(6);
  });
});

describe('diagnoseGatewayLog', () => {
  it('returns null on a clean tail — a storm without a reason is reported as exactly that', () => {
    expect(diagnoseGatewayLog(`${LISTENING}\n${LISTENING}`)).toBeNull();
    expect(diagnoseGatewayLog('')).toBeNull();
  });

  it('prefers a structural cause over the routine restart it produced, whichever is newer', () => {
    const tail = [OWNER_CONFLICT, LISTENING, CONFIG_RESTART, SIGUSR1, SIGTERM, LISTENING].join('\n');
    const d = diagnoseGatewayLog(tail);
    expect(d?.kind).toBe('state_owner_conflict');
    expect(d?.line).toContain('another Gateway owns that state directory');
    expect(d?.hint).toContain('~/.openclaw/bin/openclaw');
  });

  it('ranks restart-loop above migration above config above SIGTERM', () => {
    expect(diagnoseGatewayLog([SIGTERM, BREAKER, MIGRATION].join('\n'))?.kind).toBe('restart_loop');
    expect(diagnoseGatewayLog([SIGTERM, MIGRATION].join('\n'))?.kind).toBe('migration_failed');
    expect(diagnoseGatewayLog([SIGTERM, CONFIG_RESTART].join('\n'))?.kind).toBe('config_restart');
    expect(diagnoseGatewayLog([SIGUSR1].join('\n'))?.kind).toBe('config_restart');
    expect(diagnoseGatewayLog([LISTENING, SIGTERM].join('\n'))?.kind).toBe('external_sigterm');
  });

  it('carries the most recent line of the winning kind', () => {
    const older = SIGTERM.replace('01:56:36', '01:03:00');
    const d = diagnoseGatewayLog([older, LISTENING, SIGTERM].join('\n'));
    expect(d?.line).toContain('01:56:36');
  });
});

describe('formatGatewayInstability', () => {
  it('fits a timeline row and names the cause', () => {
    const line = formatGatewayInstability({
      flapsInWindow: 4, windowMs: GATEWAY_FLAP_WINDOW_MS,
      since: 0, lastFlapAt: 4 * 60_000,
      diagnosis: { kind: 'state_owner_conflict', line: OWNER_CONFLICT, hint: 'x' },
    });
    expect(line).toBe('OpenClaw Gateway unstable · 4 restarts in 4 min — two Gateways own ~/.openclaw/state (duplicate install?)');
    expect(line.length).toBeLessThan(180);
  });

  it('says so when the log had no reason', () => {
    const line = formatGatewayInstability({
      flapsInWindow: 3, windowMs: GATEWAY_FLAP_WINDOW_MS, since: 0, lastFlapAt: 30_000, diagnosis: null,
    });
    expect(line).toContain('reason not in the Gateway log');
    expect(line).toContain('1 min');
  });

  it('describes every kind', () => {
    for (const k of ['state_owner_conflict', 'restart_loop', 'migration_failed', 'config_restart', 'external_sigterm'] as const) {
      expect(describeKind(k).length).toBeGreaterThan(10);
    }
  });
});
