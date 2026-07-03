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
  const codexSession = (state: string): SessionInfo[] =>
    [{ id: 'cx1', alive: true, agentType: 'codex-cli', state } as unknown as SessionInfo];
  const openCodeSession = (state: string): SessionInfo[] =>
    [{ id: 'oc1', alive: true, agentType: 'opencode', state } as unknown as SessionInfo];
  const openClawSession = (state: string): SessionInfo[] =>
    [{ id: 'gw1', alive: true, agentType: 'openclaw', state } as unknown as SessionInfo];
  const antigravitySession = (state: string): SessionInfo[] =>
    [{ id: 'ag1', alive: true, agentType: 'antigravity', state } as unknown as SessionInfo];
  const pixel = (buf: Uint8Array, x: number, y: number) => {
    const i = (y * 11 + x) * 3;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };

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

  it('draws the Claude robot as a block mark with dark cutout eyes', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'claude-code' } as never,
      null, claudeSession('idle'), 1000, 11, 'micro',
    );
    expect(pixel(buf, 3, 3)).toEqual([0, 0, 0]);
    expect(pixel(buf, 3, 4)).toEqual([0, 0, 0]);
    expect(pixel(buf, 7, 3)).toEqual([0, 0, 0]);
    expect(pixel(buf, 7, 4)).toEqual([0, 0, 0]);
    expect(pixel(buf, 0, 5)).toEqual([235, 130, 90]); // full-width side arm
    expect(pixel(buf, 10, 5)).toEqual([235, 130, 90]);
    expect(pixel(buf, 2, 8)).toEqual([235, 130, 90]); // straight vertical legs
    expect(pixel(buf, 2, 9)).toEqual([235, 130, 90]);
    expect(pixel(buf, 8, 8)).toEqual([235, 130, 90]);
    expect(pixel(buf, 8, 9)).toEqual([235, 130, 90]);
    expect(pixel(buf, 5, 9)).toEqual([16, 56, 28]); // separated legs, not a blob
  });

  it('draws the Codex cloud with a visible prompt mark', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'codex-cli' } as never,
      null, codexSession('idle'), 1000, 11, 'micro',
    );
    expect(pixel(buf, 0, 0)).toEqual([16, 56, 28]); // rounded/lumpy top, not a rectangle
    expect(pixel(buf, 3, 1)).toEqual([86, 92, 220]); // deeper indigo body so white pops
    expect(pixel(buf, 2, 4)).toEqual([255, 255, 255]); // pure-white ">" chevron (bold)
    expect(pixel(buf, 4, 5)).toEqual([255, 255, 255]);
    expect(pixel(buf, 5, 8)).toEqual([255, 255, 255]); // full-width "_" cursor
    expect(pixel(buf, 3, 10)).toEqual([86, 92, 220]); // bottom cloud lobe, not dangling legs
    expect(pixel(buf, 5, 10)).toEqual([86, 92, 220]);
  });

  it('draws OpenCode as one tall hollow ring', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'opencode' } as never,
      null, openCodeSession('idle'), 1000, 11, 'micro',
    );
    expect(pixel(buf, 2, 1)).toEqual([232, 232, 232]);
    expect(pixel(buf, 8, 9)).toEqual([232, 232, 232]);
    expect(pixel(buf, 5, 4)).toEqual([16, 56, 28]); // hollow center
    expect(pixel(buf, 1, 1)).toEqual([16, 56, 28]); // not an offset second square
  });

  it('draws OpenClaw with side claws and teal eyes', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'openclaw' } as never,
      null, openClawSession('idle'), 1000, 11, 'micro',
    );
    expect(pixel(buf, 0, 0)).toEqual([16, 56, 28]); // no oversized top claws on 11px
    expect(pixel(buf, 10, 0)).toEqual([16, 56, 28]);
    expect(pixel(buf, 4, 3)).toEqual([0, 229, 204]);
    expect(pixel(buf, 6, 3)).toEqual([0, 229, 204]);
    expect(pixel(buf, 0, 4)).toEqual([210, 52, 52]); // side claw silhouette
    expect(pixel(buf, 10, 4)).toEqual([210, 52, 52]);
  });

  it('draws the Antigravity rainbow peak with transparent center hollow', () => {
    const buf = renderFrame(
      { state: State.IDLE, agentType: 'antigravity' } as never,
      null, antigravitySession('idle'), 1000, 11, 'micro',
    );
    expect(pixel(buf, 5, 0)).toEqual([255, 132, 16]);  // orange tip
    expect(pixel(buf, 3, 3)).toEqual([92, 214, 77]);   // green left slope
    expect(pixel(buf, 2, 6)).toEqual([31, 198, 179]);  // teal left leg
    expect(pixel(buf, 7, 3)).toEqual([183, 92, 182]);  // magenta right slope
    expect(pixel(buf, 5, 7)).toEqual([16, 56, 28]);    // transparent central hollow
    expect(pixel(buf, 10, 9)).toEqual([36, 126, 255]); // blue right foot
  });
});
