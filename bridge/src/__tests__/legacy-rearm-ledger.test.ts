/**
 * The legacy WiFi-provision fallback must fire ONCE per board per token.
 *
 * Before this ledger existed the daemon kept only the in-flight timers, keyed
 * by port and deleted when the timer fired — so every subsequent `device_info`
 * (one per 30s poll, plus unprompted board reports) scheduled the same
 * re-provision again. Firmware that predates `auth_provision` can never send
 * the ack that cancels it, so for exactly the boards the fallback serves it ran
 * forever: 4,759 re-provisions across 9 ports were measured on 2026-08-23,
 * 1,504 on one board, each one costing that board a WiFi re-associate.
 */
import { describe, expect, it } from 'vitest';
import { LegacyRearmLedger } from '../legacy-rearm-ledger.js';

const PORT = '/dev/cu.wchusbserial58A90021441';
const OTHER = '/dev/cu.wchusbserial31150';
const TOKEN = 'b0037876410eb290bafaddb537f11450';
const ROTATED = '84b1f57c247a87b23a2b06ce7c446422';

describe('LegacyRearmLedger', () => {
  it('asks for the re-arm the first time and never again for that token', () => {
    const l = new LegacyRearmLedger();
    expect(l.needsRearm(PORT, TOKEN)).toBe(true);
    l.markRearmed(PORT, TOKEN);
    // The loop shape: a device_info every 30s would have re-asked each time.
    for (let i = 0; i < 100; i++) expect(l.needsRearm(PORT, TOKEN)).toBe(false);
  });

  it('re-arms once more when the token actually changes', () => {
    const l = new LegacyRearmLedger();
    l.markRearmed(PORT, TOKEN);
    expect(l.needsRearm(PORT, ROTATED)).toBe(true);
    l.markRearmed(PORT, ROTATED);
    expect(l.needsRearm(PORT, ROTATED)).toBe(false);
    // ...and does not resurrect the superseded one.
    expect(l.needsRearm(PORT, TOKEN)).toBe(true);
  });

  it('tracks each port independently', () => {
    const l = new LegacyRearmLedger();
    l.markRearmed(PORT, TOKEN);
    expect(l.needsRearm(OTHER, TOKEN)).toBe(true);
    expect(l.needsRearm(PORT, TOKEN)).toBe(false);
  });

  it('counts an ack as served, so a later device_info cannot reschedule it', () => {
    // A board that understands auth_provision must never take the legacy path.
    // Cancelling the in-flight timer alone left the next device_info free to
    // schedule another one behind it.
    const l = new LegacyRearmLedger();
    l.markUnderstood(PORT, TOKEN);
    expect(l.needsRearm(PORT, TOKEN)).toBe(false);
  });

  it('forgets a port on unplug so a replug is evaluated fresh', () => {
    const l = new LegacyRearmLedger();
    l.markRearmed(PORT, TOKEN);
    l.forget(PORT);
    expect(l.needsRearm(PORT, TOKEN)).toBe(true);
    expect(l.size).toBe(0);
  });

  it('records an ATTEMPT, not a delivery', () => {
    // The caller marks before sending on purpose: a board that is unreachable
    // right now is retried when the token changes or the daemon restarts, not
    // once per poll. This pins the polarity so a refactor cannot flip it to
    // "record only on success" and restore the loop.
    const l = new LegacyRearmLedger();
    l.markRearmed(PORT, TOKEN);            // send may have returned false
    expect(l.needsRearm(PORT, TOKEN)).toBe(false);
  });
});
