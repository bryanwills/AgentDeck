import { describe, expect, it } from 'vitest';
import { createSigabrtCircuitBreaker, SIGABRT_HALT_THRESHOLD } from '../ble-sync-spawn.js';

describe('SIGABRT circuit breaker', () => {
  it('halts after the threshold of consecutive SIGABRT kills, naming the device', () => {
    const breaker = createSigabrtCircuitBreaker('Timebox BLE sync for X');
    for (let i = 0; i < SIGABRT_HALT_THRESHOLD - 1; i++) {
      expect(breaker.noteExit('SIGABRT')).toBeNull();
    }
    const halt = breaker.noteExit('SIGABRT');
    expect(halt).toContain('Timebox BLE sync for X');
    expect(halt).toContain('SIGABRT');
    expect(halt).toContain('daemon restart');
  });

  it('keeps reporting the halt on further exits instead of silently re-arming', () => {
    const breaker = createSigabrtCircuitBreaker('sync');
    for (let i = 0; i < SIGABRT_HALT_THRESHOLD; i++) breaker.noteExit('SIGABRT');
    expect(breaker.noteExit('SIGABRT')).not.toBeNull();
  });

  it('resets on any non-SIGABRT exit so a powered-off panel never trips it', () => {
    const breaker = createSigabrtCircuitBreaker('sync');
    // Clean "device not found" scan exits interleave with kills all day; only
    // an uninterrupted kill streak may halt the loop.
    for (let round = 0; round < 5; round++) {
      expect(breaker.noteExit('SIGABRT')).toBeNull();
      expect(breaker.noteExit('SIGABRT')).toBeNull();
      expect(breaker.noteExit(null)).toBeNull(); // clean exit resets
    }
    expect(breaker.noteExit('SIGTERM')).toBeNull();
  });
});
