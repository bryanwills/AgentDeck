/**
 * The serial-suspend lease: "nobody but the flasher may open a serial port
 * until <when>".
 *
 * WHY IT IS A FILE AND NOT A VARIABLE. The recorded failure this exists to fix
 * was not the daemon we asked to stand down — it was the daemon that came back.
 * An in-process pause dies with the process; a respawn (LaunchAgent, a user
 * re-running `daemon start`, the app relaunching) opens every port again and
 * DTR-resets the board mid-write. A lease on disk survives that, because the
 * respawned daemon reads it before its first poll.
 *
 * WHY EXPIRY IS ENFORCED ON READ, NEVER BY A TIMER. Same rule the pairing
 * window follows. A timer on a laptop that sleeps fires late, and a late timer
 * extends the suspension past what was promised — the daemon stays deaf to
 * every board for as long as the machine was asleep. Reading the clock at the
 * point of use cannot do that, and it also self-heals when the CLI is killed
 * mid-flash: nothing has to run to end the lease, it simply stops being true.
 *
 * HONEST GAP: the sandboxed Swift daemon cannot read `~/.agentdeck`, so a lease
 * written here does not stop it. That is why the CLI also runs an `lsof`
 * pre-check and refuses to start when a non-AgentDeck process holds the port,
 * and why it verifies after writing rather than trusting the suspension.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getDataDir } from './session-registry.js';
import { debug } from './logger.js';

export interface FlashLease {
  /** epoch ms after which the lease means nothing */
  until: number;
  /** who asked, for a human reading the file or the log */
  reason: string;
  /** pid of the requester, informational only — never a liveness test */
  pid?: number;
  board?: string;
}

/** Clamp, so a caller cannot suspend the daemon's device layer indefinitely. */
export const LEASE_MIN_SECONDS = 1;
export const LEASE_MAX_SECONDS = 900;

export function leaseFile(): string {
  return join(getDataDir(), 'esp32-flash-lease.json');
}

export function clampLeaseSeconds(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return LEASE_MIN_SECONDS;
  return Math.max(LEASE_MIN_SECONDS, Math.min(LEASE_MAX_SECONDS, Math.floor(n)));
}

/**
 * The lease, or null. Expiry is applied HERE — the only place that reads it —
 * so no caller can observe an expired lease as active.
 */
export function readLease(now = Date.now(), file = leaseFile()): FlashLease | null {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FlashLease>;
    const until = Number(raw.until);
    if (!Number.isFinite(until) || until <= now) return null;
    return { until, reason: String(raw.reason ?? 'unknown'), pid: raw.pid, board: raw.board };
  } catch {
    // A corrupt lease means "no lease". Failing open is correct: the cost is a
    // reset board during a flash that is probably not running; failing closed
    // would leave every device permanently unreachable behind a bad file.
    return null;
  }
}

export function serialSuspended(now = Date.now()): boolean {
  return readLease(now) !== null;
}

export function writeLease(lease: FlashLease, file = leaseFile()): FlashLease {
  mkdirSync(dirname(file), { recursive: true });
  // tmp+rename, like every other file this daemon owns: a torn lease read as
  // corrupt is a lease that silently is not protecting the write in flight.
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lease, null, 2)}\n`);
  renameSync(tmp, file);
  debug('ESP32', `flash lease until ${new Date(lease.until).toISOString()} (${lease.reason})`);
  return lease;
}

/** Idempotent: resuming when nothing is suspended is a success, not an error. */
export function clearLease(file = leaseFile()): void {
  try {
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // Best effort. An unremovable lease still expires on its own clock.
  }
}
