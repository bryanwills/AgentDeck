import { describe, expect, it } from 'vitest';
import { deviceTransport, deviceId, type TimeboxDevice } from '../timebox/timebox-settings.js';
import { renderFrame } from '../pixoo/pixoo-renderer.js';
import { State } from '../types.js';
import type { SessionInfo } from '@agentdeck/shared/protocol';

describe('Timebox transport helpers', () => {
  // deviceTransport is what timebox-daemon-sync.ts branches on to pick
  // sync_ble.py (BLE) vs sync.py (SPP), so it must reflect which field is set.
  it('classifies a BLE device (address) as ble', () => {
    const d: TimeboxDevice = { address: '7CF31CA8-84EE-36BB-52AB-CC5515910C34', name: 'x' };
    expect(deviceTransport(d)).toBe('ble');
    expect(deviceId(d)).toBe('7CF31CA8-84EE-36BB-52AB-CC5515910C34');
  });

  it('classifies an SPP device (port) as spp', () => {
    const d: TimeboxDevice = { port: '/dev/cu.TimeBox-Light-SPPDev' };
    expect(deviceTransport(d)).toBe('spp');
    expect(deviceId(d)).toBe('/dev/cu.TimeBox-Light-SPPDev');
  });

  it('prefers the BLE address when (defensively) both are present', () => {
    const d: TimeboxDevice = { address: 'AA', port: '/dev/cu.x' };
    expect(deviceTransport(d)).toBe('ble');
    expect(deviceId(d)).toBe('AA');
  });
});

describe('micro layout (Timebox 11×11)', () => {
  const claudeSession = (state: string): SessionInfo[] =>
    [{ id: 's1', alive: true, agentType: 'claude-code', state } as unknown as SessionInfo];

  it('returns a size²·3 RGB buffer', () => {
    const buf = renderFrame(null, null, [], 1000, 32, 'micro');
    expect(buf.length).toBe(32 * 32 * 3);
  });

  it('draws a bright dominant creature for a processing session', () => {
    const buf = renderFrame(
      { state: State.PROCESSING, agentType: 'claude-code' } as never,
      null, claudeSession('processing'), 1000, 32, 'micro',
    );
    let bright = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] > 120) bright++;
    expect(bright).toBeGreaterThan(50); // a sizeable creature, not just a status field
  });

  it('shows only the status field (no bright creature) when no sessions exist', () => {
    const buf = renderFrame(null, null, [], 1000, 32, 'micro');
    let bright = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] > 120) bright++;
    expect(bright).toBe(0);
    // Dark idle-green field: green channel of the center pixel dominates.
    const c = (16 * 32 + 16) * 3;
    expect(buf[c + 1]).toBeGreaterThan(buf[c]);
    expect(buf[c + 1]).toBeGreaterThan(buf[c + 2]);
  });

  it('tints the field red on critical usage (≥90%)', () => {
    const buf = renderFrame(
      null, { fiveHourPercent: 95 } as never, [], 1000, 32, 'micro',
    );
    const c = (16 * 32 + 16) * 3;
    expect(buf[c]).toBeGreaterThan(buf[c + 1]); // red channel dominates
    expect(buf[c]).toBeGreaterThan(buf[c + 2]);
  });
});
