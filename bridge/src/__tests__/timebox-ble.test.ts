import { describe, expect, it } from 'vitest';
import { deviceId, type TimeboxDevice } from '../timebox/timebox-settings.js';
import { renderFrame } from '../pixoo/pixoo-renderer.js';
import { State } from '../types.js';
import type { SessionInfo } from '@agentdeck/shared/protocol';

describe('Timebox device identity', () => {
  // Timebox Mini is BLE-only (the legacy SPP variant was removed); deviceId is
  // the BLE address used as the stable key for sync_ble.py.
  it('uses the BLE address as the device id', () => {
    const d: TimeboxDevice = { address: '7CF31CA8-84EE-36BB-52AB-CC5515910C34', name: 'x' };
    expect(deviceId(d)).toBe('7CF31CA8-84EE-36BB-52AB-CC5515910C34');
  });
});

describe('micro layout (Timebox 11×11)', () => {
  const claudeSession = (state: string): SessionInfo[] =>
    [{ id: 's1', alive: true, agentType: 'claude-code', state } as unknown as SessionInfo];
  const antigravitySession = (state: string): SessionInfo[] =>
    [{ id: 'ag1', alive: true, agentType: 'antigravity', state } as unknown as SessionInfo];

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

  it('draws the Antigravity rainbow peak with a black center cutout', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'antigravity' } as never,
      null, antigravitySession('idle'), 1000, 11, 'micro',
    );
    const pixel = (x: number, y: number) => {
      const i = (y * 11 + x) * 3;
      return [buf[i], buf[i + 1], buf[i + 2]];
    };
    expect(pixel(4, 0)).toEqual([245, 203, 36]);  // yellow peak
    expect(pixel(5, 0)).toEqual([255, 132, 16]);  // orange peak
    expect(pixel(3, 2)).toEqual([92, 214, 77]);   // green left slope
    expect(pixel(4, 5)).toEqual([0, 0, 0]);       // central hollow
    expect(pixel(9, 8)).toEqual([36, 126, 255]);  // blue right foot
  });
});
