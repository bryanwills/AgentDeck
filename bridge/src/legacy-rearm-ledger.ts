/**
 * Remembers which serial-attached boards have already been re-armed over the
 * legacy WiFi-provision path, so that fallback fires once per board per token
 * instead of forever.
 *
 * ## Why this is a module and not three lines inline
 *
 * The fallback exists for firmware that predates `auth_provision`: such a board
 * silently drops the message, so the daemon cannot tell "understood" from
 * "ignored" except by the ack not arriving. After a grace period it re-sends
 * the one message that firmware does understand — `wifi_provision`, which
 * carries the credential but **costs a WiFi re-associate**.
 *
 * The original implementation kept only the in-flight timers, keyed by port and
 * deleted when the timer FIRED. Nothing recorded that the port had already been
 * served. So the next `device_info` — one every 30s from the daemon's own poll,
 * plus whatever the board sends unprompted — scheduled the same re-provision
 * again, and for exactly the boards this path exists to serve (the ones that can
 * never ack) it repeated for as long as the daemon ran.
 *
 * Measured on this repo's fleet before the fix (2026-08-23): **4,759** legacy
 * re-provisions across 9 ports, 1,504 on a single board, at a steady 60-120s
 * cadence. A board on old firmware was therefore dragged off its WiFi
 * association about once a minute, indefinitely — it could never hold a
 * WebSocket — and the churn burned 2.4GHz airtime that the WiFi-only boards on
 * the same band depend on.
 *
 * ## The two properties worth keeping
 *
 * - **Keyed by token value, not by a boolean.** A rotation or a cross-daemon
 *   handover adoption is a real change that must reach the fleet, so a new
 *   token legitimately buys one more re-arm and then goes quiet again. A plain
 *   "already done" flag would strand every board on the superseded credential.
 * - **An attempt counts even if the write failed.** Recording only successes
 *   turns an unreachable board back into the loop this ledger removes. A board
 *   that stays unreachable is retried when the token next changes or when the
 *   daemon restarts — both real events, unlike a 30-second poll.
 */
export class LegacyRearmLedger {
  private readonly byPort = new Map<string, string>();

  /** True when this port still needs the legacy re-arm for this token. */
  needsRearm(port: string, token: string): boolean {
    return this.byPort.get(port) !== token;
  }

  /** Record that `port` has been served for `token` — attempted, not necessarily delivered. */
  markRearmed(port: string, token: string): void {
    this.byPort.set(port, token);
  }

  /**
   * The board answered `auth_provision`, so it never needs the legacy path for
   * this token. Recorded the same way as an attempt: cancelling the in-flight
   * timer alone would leave the next `device_info` free to schedule another.
   */
  markUnderstood(port: string, token: string): void {
    this.byPort.set(port, token);
  }

  /** Board unplugged. Drop it so a replug re-evaluates from scratch. */
  forget(port: string): void {
    this.byPort.delete(port);
  }

  /** Test/diagnostic view: how many ports are recorded. */
  get size(): number {
    return this.byPort.size;
  }
}
