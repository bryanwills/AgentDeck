import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CodexCredits, CodexRateLimits, CodexRateLimitWindow } from '@agentdeck/shared';

/**
 * Read Codex (ChatGPT) usage limits from the user's own local session rollout
 * files. Codex CLI persists a `rate_limits` snapshot inside every `token_count`
 * event it writes to `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`:
 *
 *   { "type":"event_msg", "payload": { "type":"token_count",
 *       "rate_limits": { "primary":{"used_percent":8,"window_minutes":300,"resets_at":...},
 *                        "secondary":{"used_percent":1,"window_minutes":10080,"resets_at":...},
 *                        "plan_type":"plus" } } }
 *
 * This mirrors the Claude 5h/7d quota the dashboard already shows. Reading the
 * user's own local files (the same posture as `readCodexAuthStatus` reading
 * `~/.codex/auth.json`) — no Codex/OpenAI API is contacted.
 *
 * Credit-based plans report a different shape — the 5h/7d windows are null and
 * a `credits` block + `limit_id` carry the metering instead:
 *
 *   { "rate_limits": { "limit_id":"premium", "primary":null, "secondary":null,
 *       "credits":{"has_credits":false,"unlimited":false,"balance":"0"} } }
 *
 * The parser keeps these snapshots so the dashboard can show a credits readout
 * rather than silently dropping the Codex gauge.
 */

interface RawWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}
interface RawCredits {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string | number;
}
interface RawRateLimits {
  primary?: RawWindow;
  secondary?: RawWindow;
  plan_type?: string;
  limit_id?: string;
  credits?: RawCredits;
}

const sessionsRoot = (): string => path.join(os.homedir(), '.codex', 'sessions');

/** Descend year → month → day choosing the newest directory at each level,
 *  then return the most-recently-modified rollout file there. */
function newestRolloutFile(): string | null {
  let dir = sessionsRoot();
  if (!fs.existsSync(dir)) return null;
  try {
    for (let depth = 0; depth < 3; depth++) {
      const subdirs = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (subdirs.length === 0) return null;
      dir = path.join(dir, subdirs[0]);
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
    let best: { full: string; mtime: number } | null = null;
    for (const f of files) {
      const full = path.join(dir, f);
      const mtime = fs.statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { full, mtime };
    }
    return best?.full ?? null;
  } catch {
    return null;
  }
}

/** Read the trailing bytes of a file without slurping the whole rollout (these
 *  can grow to many MB). The newest `rate_limits` line is always near the end. */
function readTail(file: string, maxBytes = 262144): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function toCredits(raw?: RawCredits): CodexCredits | undefined {
  if (!raw || (typeof raw.has_credits !== 'boolean' && typeof raw.unlimited !== 'boolean' && raw.balance == null)) {
    return undefined;
  }
  return {
    hasCredits: raw.has_credits === true,
    unlimited: raw.unlimited === true,
    balance: raw.balance != null ? String(raw.balance) : undefined,
  };
}

function toWindow(raw?: RawWindow): CodexRateLimitWindow | undefined {
  if (!raw || typeof raw.used_percent !== 'number' || typeof raw.window_minutes !== 'number') {
    return undefined;
  }
  const resetsAt =
    typeof raw.resets_at === 'number' && raw.resets_at > 0
      ? new Date(raw.resets_at * 1000).toISOString()
      : undefined;
  return {
    usedPercent: Math.min(100, Math.max(0, raw.used_percent)),
    windowMinutes: raw.window_minutes,
    resetsAt,
  };
}

/**
 * Parse the newest `rate_limits` snapshot out of a chunk of rollout JSONL text
 * (typically the file tail). Scans lines from the end so the most recent
 * snapshot wins. Exported for unit testing. Returns null when no usable
 * rate-limit line is found.
 */
export function parseCodexRateLimitsFromText(text: string): CodexRateLimits | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes('rate_limits')) continue;
    try {
      const obj = JSON.parse(line) as { payload?: { type?: string; rate_limits?: RawRateLimits } };
      const rl = obj?.payload?.rate_limits;
      if (!rl) continue;
      const primary = toWindow(rl.primary);
      const secondary = toWindow(rl.secondary);
      const credits = toCredits(rl.credits);
      const limitId = typeof rl.limit_id === 'string' ? rl.limit_id : undefined;
      // Credit-based plans (e.g. limit_id "premium") report null windows and
      // convey usage via the credits block instead — keep those snapshots too.
      if (!primary && !secondary && !credits && !limitId) continue;
      return {
        primary,
        secondary,
        planType: typeof rl.plan_type === 'string' ? rl.plan_type : undefined,
        limitId,
        credits,
      };
    } catch {
      // Possibly a truncated first line from the tail window; keep scanning.
    }
  }
  return null;
}

// Cache keyed on the active rollout path + its mtime so repeated usage polls
// don't re-read an unchanged file.
let cacheKey = '';
let cacheValue: CodexRateLimits | null = null;

export function readCodexRateLimits(): CodexRateLimits | null {
  const file = newestRolloutFile();
  if (!file) return null;

  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const key = `${file}:${mtime}`;
  if (key === cacheKey) return cacheValue;

  const tail = readTail(file);
  const parsed = tail ? parseCodexRateLimitsFromText(tail) : null;
  // Stamp the rollout mtime as a secondary freshness anchor (the per-window
  // `stale` flag set in buildUsageEvent is authoritative).
  if (parsed) parsed.capturedAt = new Date(mtime).toISOString();

  cacheKey = key;
  cacheValue = parsed;
  return parsed;
}
