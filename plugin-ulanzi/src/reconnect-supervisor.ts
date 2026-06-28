/**
 * Transport reconnect supervisor for the Ulanzi Studio bridge.
 *
 * The vendored UlanziDeckPlugin-SDK (`vendor/ulanzi-api`) opens its Studio
 * WebSocket exactly once and never reconnects — `onclose` only re-emits a CLOSE
 * event. After macOS sleep the D200H USB device detaches, Ulanzi Studio drops
 * the plugin's Studio socket, and on wake the plugin process resumes but that
 * socket stays dead forever (no key presses arrive, icon pushes hit a dead
 * socket). The daemon link (`daemon-client.ts`) already has wake-watchdog +
 * backoff reconnect; this supervisor gives the Studio bridge the same recovery.
 *
 * It mirrors the proven `daemon-client.ts` discipline:
 *  - backoff reconnect (`RECONNECT_BACKOFF_MS`) on drop;
 *  - a wake-watchdog (gap between ticks > `wakeGapMs` ⇒ system woke) that forces
 *    a fresh connect, covering the half-open case where `onclose` never fires;
 *  - an in-flight guard via a connect-timeout so the spurious CLOSE that the
 *    vendored `connect()` emits when it closes the previous socket can't stack a
 *    second reconnect, and a stuck connect attempt is retried.
 *
 * Timers and clock are injectable so the state machine is deterministically
 * unit-testable without real time or a real socket.
 */

export interface SupervisorClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  setIntervalTimer: (fn: () => void, ms: number) => unknown;
  clearIntervalTimer: (handle: unknown) => void;
}

const realClock: SupervisorClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setIntervalTimer: (fn, ms) => setInterval(fn, ms),
  clearIntervalTimer: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface SupervisorOptions {
  /** (Re)establish the underlying transport. Must be safe to call repeatedly;
   *  the vendored `connect()` closes any existing socket before opening. */
  connect: () => void;
  /** Backoff ladder in ms (reuse `RECONNECT_BACKOFF_MS` from @agentdeck/shared). */
  backoffMs: readonly number[];
  /** Fired after the transport re-opens following a drop/wake (not the first
   *  open) — use to resync state (e.g. force a full re-render). */
  onReconnect?: () => void;
  /** Tick gap above this ⇒ treated as a sleep/wake jump. Default 20s. */
  wakeGapMs?: number;
  /** Wake-watchdog interval. Default 10s. */
  watchdogMs?: number;
  /** A connect attempt that neither opens nor closes within this window is
   *  retried with backoff. Default 4s. */
  connectTimeoutMs?: number;
  log?: (msg: string) => void;
  clock?: SupervisorClock;
}

type Status = 'idle' | 'connecting' | 'open' | 'waiting';

export class ReconnectSupervisor {
  private readonly connectFn: () => void;
  private readonly backoffMs: readonly number[];
  private readonly onReconnect?: () => void;
  private readonly wakeGapMs: number;
  private readonly watchdogMs: number;
  private readonly connectTimeoutMs: number;
  private readonly log: (msg: string) => void;
  private readonly clock: SupervisorClock;

  private status: Status = 'idle';
  private backoffIdx = 0;
  private everOpened = false;
  private reconnectTimer: unknown = null;
  private connectTimer: unknown = null;
  private watchdog: unknown = null;
  private lastTick = 0;
  private lastConnectAt = -1;

  constructor(opts: SupervisorOptions) {
    this.connectFn = opts.connect;
    this.backoffMs = opts.backoffMs;
    this.onReconnect = opts.onReconnect;
    this.wakeGapMs = opts.wakeGapMs ?? 20_000;
    this.watchdogMs = opts.watchdogMs ?? 10_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 4_000;
    this.log = opts.log ?? (() => {});
    this.clock = opts.clock ?? realClock;
  }

  /** Begin: first connect + start the wake-watchdog. */
  start(): void {
    this.startWatchdog();
    this.doConnect();
  }

  /** Call from the transport's "open"/"connected" event. */
  noteOpen(): void {
    this.clearConnectTimer();
    this.status = 'open';
    this.backoffIdx = 0;
    if (this.everOpened) {
      this.log('studio bridge reconnected');
      this.onReconnect?.();
    } else {
      this.everOpened = true;
    }
  }

  /** Call from the transport's "close"/"error" event. */
  noteClosed(): void {
    // A connect attempt is in flight — the connect-timeout is the authority for
    // it. This close is either the previous socket dying (vendored connect()
    // closes it) or this attempt failing; either way let the timeout decide so
    // we don't stack a second reconnect.
    if (this.status === 'connecting') return;
    if (this.status === 'waiting') return; // already scheduled
    this.scheduleReconnect();
  }

  stop(): void {
    this.clearReconnectTimer();
    this.clearConnectTimer();
    if (this.watchdog != null) { this.clock.clearIntervalTimer(this.watchdog); this.watchdog = null; }
    this.status = 'idle';
  }

  /** @internal exposed for tests. */
  getStatus(): Status { return this.status; }

  private doConnect(): void {
    // Collapse a duplicate connect within the same instant: on wake an overdue
    // backoff timer and the wake-watchdog can both fire at the same clock value;
    // without this the second would needlessly tear down the socket the first
    // just opened.
    if (this.status === 'connecting' && this.clock.now() === this.lastConnectAt) return;
    this.lastConnectAt = this.clock.now();
    this.clearReconnectTimer();
    this.clearConnectTimer();
    this.status = 'connecting';
    this.connectTimer = this.clock.setTimer(() => {
      this.connectTimer = null;
      // Attempt produced neither open nor close — treat as failed, back off.
      this.log('studio bridge connect timed out — retrying');
      this.status = 'waiting'; // allow scheduleReconnect to proceed
      this.scheduleReconnect();
    }, this.connectTimeoutMs);
    try {
      this.connectFn();
    } catch (err) {
      this.log(`studio bridge connect threw: ${err}`);
      this.clearConnectTimer();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    const delay = this.backoffMs[Math.min(this.backoffIdx, this.backoffMs.length - 1)];
    if (this.backoffIdx < this.backoffMs.length - 1) this.backoffIdx++;
    this.status = 'waiting';
    this.reconnectTimer = this.clock.setTimer(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private startWatchdog(): void {
    if (this.watchdog != null) this.clock.clearIntervalTimer(this.watchdog);
    this.lastTick = this.clock.now();
    this.watchdog = this.clock.setIntervalTimer(() => {
      const now = this.clock.now();
      const gap = now - this.lastTick;
      this.lastTick = now;
      if (gap > this.wakeGapMs) {
        // System woke. The Studio socket may be silently half-open (no close
        // event), so force a fresh connect regardless of current status.
        this.log(`wake detected (gap ${gap}ms) — forcing studio bridge reconnect`);
        this.backoffIdx = 0;
        this.doConnect();
      }
    }, this.watchdogMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) { this.clock.clearTimer(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer != null) { this.clock.clearTimer(this.connectTimer); this.connectTimer = null; }
  }
}
