import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSyncCycleSquelch } from '../ble-sync-spawn.js';

/**
 * Repeated identical BLE sync respawn cycles (panel powered off, out of range,
 * nightly disconnect loop) must collapse into a summary instead of flooding
 * the daemon log, while any novel exit still logs immediately.
 */
describe('createSyncCycleSquelch', () => {
  let lines: string[];
  const log = (msg: string): void => {
    lines.push(msg);
  };

  // The iDotMatrix clean-cycle output tail as the ring buffer captures it:
  // python log timestamps and the BLE address vary per cycle.
  const cycleTail = (i: number): string =>
    `02.07.2026 08:${String(10 + i).padStart(2, '0')}:01 :: INFO :: idotmatrix.connectionManager :: ` +
    `disconnected from 98A0BE6C-E08A-775F-93A3-FDF25D5E1A6C`;
  const cycleLine = (i: number): string =>
    `BLE sync exited (code=0 signal=null); output: ${cycleTail(i)}; respawning in 60s`;

  beforeEach(() => {
    lines = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs the first two occurrences of a cycle, then suppresses identical repeats', () => {
    const squelch = createSyncCycleSquelch(log);
    squelch.logStart('Starting BLE sync');
    squelch.logExit(0, null, 31_000, cycleTail(0), cycleLine(0));
    squelch.logStart('Starting BLE sync'); // respawn after first exit still logs
    squelch.logExit(0, null, 31_000, cycleTail(1), cycleLine(1));
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('repeating cycle; suppressing');

    for (let i = 2; i < 30; i++) {
      squelch.logStart('Starting BLE sync');
      squelch.logExit(0, null, 31_000, cycleTail(i), cycleLine(i));
    }
    expect(lines).toHaveLength(4); // fully quiet while the cycle repeats
  });

  it('emits an hourly summary with the repeat count while suppressing', () => {
    const squelch = createSyncCycleSquelch(log);
    squelch.logExit(0, null, 31_000, cycleTail(0), cycleLine(0));
    squelch.logExit(0, null, 31_000, cycleTail(1), cycleLine(1)); // enters suppression
    for (let i = 2; i < 12; i++) {
      vi.advanceTimersByTime(90_000);
      squelch.logExit(0, null, 31_000, cycleTail(i), cycleLine(i));
    }
    expect(lines).toHaveLength(2); // 15 minutes in — no summary yet

    vi.advanceTimersByTime(60 * 60_000);
    squelch.logExit(0, null, 31_000, cycleTail(12), cycleLine(12));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/suppressed 11 repeats of the same sync cycle/);
    expect(lines[2]).toContain('latest:');
  });

  it('flushes and logs immediately when a different exit appears', () => {
    const squelch = createSyncCycleSquelch(log);
    squelch.logExit(0, null, 31_000, cycleTail(0), cycleLine(0));
    squelch.logExit(0, null, 31_000, cycleTail(1), cycleLine(1));
    squelch.logExit(0, null, 31_000, cycleTail(2), cycleLine(2));
    lines = [];

    const crashTail = 'ModuleNotFoundError: bleak';
    const crash = `BLE sync exited (code=1 signal=null); output: ${crashTail}; respawning in 5s`;
    squelch.logExit(1, null, 2_000, crashTail, crash);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/suppressed 1 repeats of the same sync cycle since/);
    expect(lines[1]).toBe(crash);

    // And the start line after a novel exit logs again.
    squelch.logStart('Starting BLE sync');
    expect(lines).toHaveLength(3);
  });

  it('treats 1x vs 2x captures of the same retry error as the same cycle', () => {
    // The output ring captures one or two copies of the same "device not
    // found" line depending on timing; the cycle identity must not flap.
    const notFound = 'BLE connection error: Device with address 7CF31CA8-84EE-36BB-52AB-CC5515910C34 was not found';
    const one = notFound;
    const two = `${notFound} | ${notFound}`;
    const squelch = createSyncCycleSquelch(log);
    squelch.logExit(0, null, 12_000, one, `sync exited; output: ${one}; respawning in 5s`);
    squelch.logExit(0, null, 12_000, two, `sync exited; output: ${two}; respawning in 10s`);
    squelch.logExit(0, null, 12_000, one, `sync exited; output: ${one}; respawning in 15s`);
    squelch.logExit(0, null, 12_000, two, `sync exited; output: ${two}; respawning in 20s`);
    expect(lines).toHaveLength(2); // first + "repeating cycle" note, then quiet
  });

  it('treats an exit after a long healthy run as a fresh incident', () => {
    const squelch = createSyncCycleSquelch(log);
    squelch.logExit(0, null, 31_000, cycleTail(0), cycleLine(0));
    squelch.logExit(0, null, 31_000, cycleTail(1), cycleLine(1));
    squelch.logExit(0, null, 31_000, cycleTail(2), cycleLine(2));
    lines = [];

    // Same exit text, but the child stayed up 6 minutes — the old loop ended.
    squelch.logExit(0, null, 6 * 60_000, cycleTail(3), cycleLine(3));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/suppressed 1 repeats/);
    expect(lines[1]).toBe(cycleLine(3));
  });
});
