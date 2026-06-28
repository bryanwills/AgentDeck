import { describe, it, expect, beforeEach } from 'vitest';
import { ReconnectSupervisor, type SupervisorClock } from '../reconnect-supervisor.js';

/**
 * Deterministic discrete-event clock. `advance` fires due timers in
 * chronological order; `sleep` jumps wall-clock forward without running timers
 * mid-jump, then fires the coalesced tick on "wake" — exactly how a suspended
 * Node process behaves across macOS sleep.
 */
class FakeClock implements SupervisorClock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { due: number; fn: () => void; interval?: number }>();

  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { due: this.t + ms, fn }); return id; };
  clearTimer = (h: unknown) => { this.timers.delete(h as number); };
  setIntervalTimer = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { due: this.t + ms, fn, interval: ms }); return id; };
  clearIntervalTimer = (h: unknown) => { this.timers.delete(h as number); };

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextDue: number | null = null;
      let nextId = -1;
      for (const [id, timer] of this.timers) {
        if (timer.due <= target && (nextDue === null || timer.due < nextDue)) { nextDue = timer.due; nextId = id; }
      }
      if (nextId === -1) break;
      const timer = this.timers.get(nextId)!;
      this.t = timer.due;
      if (timer.interval !== undefined) timer.due = this.t + timer.interval;
      else this.timers.delete(nextId);
      timer.fn();
    }
    this.t = target;
  }

  /** Simulate macOS sleep: wall clock jumps; one-shots due during the jump and
   *  intervals (coalesced to one) fire on wake. */
  sleep(ms: number): void {
    this.t += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.interval === undefined && timer.due <= this.t) { this.timers.delete(id); timer.fn(); }
    }
    for (const [, timer] of [...this.timers]) {
      if (timer.interval !== undefined) { timer.due = this.t + timer.interval; timer.fn(); }
    }
  }
}

const BACKOFF = [100, 200, 400] as const;

function makeSupervisor(clock: FakeClock) {
  let connectCount = 0;
  let reconnectCount = 0;
  const sup = new ReconnectSupervisor({
    connect: () => { connectCount++; },
    backoffMs: BACKOFF,
    onReconnect: () => { reconnectCount++; },
    wakeGapMs: 20_000,
    watchdogMs: 10_000,
    connectTimeoutMs: 4_000,
    clock,
  });
  return { sup, counts: () => ({ connect: connectCount, reconnect: reconnectCount }) };
}

describe('ReconnectSupervisor', () => {
  let clock: FakeClock;
  beforeEach(() => { clock = new FakeClock(); });

  it('connects once on start and reports the first open without firing onReconnect', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    expect(counts().connect).toBe(1);
    expect(sup.getStatus()).toBe('connecting');
    sup.noteOpen();
    expect(sup.getStatus()).toBe('open');
    expect(counts().reconnect).toBe(0); // first open is not a "reconnect"
  });

  it('reconnects with backoff after a drop and fires onReconnect on re-open', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    sup.noteOpen();

    sup.noteClosed();                 // genuine drop while open
    expect(sup.getStatus()).toBe('waiting');
    expect(counts().connect).toBe(1); // not yet retried

    clock.advance(BACKOFF[0]);        // backoff elapses
    expect(counts().connect).toBe(2); // reconnect attempt fired
    sup.noteOpen();
    expect(counts().reconnect).toBe(1);
  });

  it('ignores the spurious close emitted while a connect is in flight', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();                      // status connecting
    // vendored connect() closing the previous socket emits a CLOSE — must not
    // stack a second reconnect.
    sup.noteClosed();
    expect(sup.getStatus()).toBe('connecting');
    sup.noteOpen();
    expect(sup.getStatus()).toBe('open');
    expect(counts().connect).toBe(1);
  });

  it('retries via connect-timeout when an attempt neither opens nor closes', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    expect(counts().connect).toBe(1);
    clock.advance(4_000);             // connect-timeout fires → schedule backoff
    clock.advance(BACKOFF[0]);        // backoff elapses → retry
    expect(counts().connect).toBe(2);
  });

  it('escalates the backoff ladder across consecutive failed attempts', () => {
    // Consecutive failures (attempts that never open) escalate the ladder; each
    // failure surfaces via the connect-timeout, then a backoff delay precedes
    // the next attempt. A successful open would reset the ladder (covered above).
    const { sup, counts } = makeSupervisor(clock);
    sup.start();                      // attempt #1
    expect(counts().connect).toBe(1);

    clock.advance(4_000);             // attempt #1 times out → backoff[0]=100
    clock.advance(BACKOFF[0]);
    expect(counts().connect).toBe(2); // attempt #2

    clock.advance(4_000);             // attempt #2 times out → backoff[1]=200
    clock.advance(BACKOFF[0]);        // 100ms not enough now
    expect(counts().connect).toBe(2);
    clock.advance(BACKOFF[1] - BACKOFF[0]);
    expect(counts().connect).toBe(3); // attempt #3 after the longer delay
  });

  it('forces a fresh connect on wake even when the socket looked open (half-open)', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    sup.noteOpen();
    expect(counts().connect).toBe(1);

    clock.sleep(60_000);              // macOS slept 60s; socket may be half-open
    expect(counts().connect).toBe(2); // watchdog forced a reconnect

    sup.noteOpen();
    expect(counts().reconnect).toBe(1);
  });

  it('reconnects immediately on wake while disconnected (backoff reset)', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    sup.noteOpen();
    sup.noteClosed();                 // dropped, waiting on backoff
    expect(sup.getStatus()).toBe('waiting');

    clock.sleep(60_000);              // wake → immediate forced connect
    expect(counts().connect).toBe(2);
    expect(sup.getStatus()).toBe('connecting');
  });

  it('stop() halts the watchdog so wake no longer reconnects', () => {
    const { sup, counts } = makeSupervisor(clock);
    sup.start();
    sup.noteOpen();
    sup.stop();
    clock.sleep(60_000);
    expect(counts().connect).toBe(1); // no reconnect after stop
  });
});
