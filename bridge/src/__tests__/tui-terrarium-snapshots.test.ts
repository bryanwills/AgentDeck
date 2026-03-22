/**
 * Snapshot tests for TUI terrarium braille rendering.
 * Tests the exported API functions: initTerrarium, setOctopi, setCrayfish,
 * setJellyfish, updateTerrarium, renderTerrariumFrame.
 *
 * Math.random is mocked for deterministic bubble/school initialization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initTerrarium,
  setOctopi,
  setCrayfish,
  setJellyfish,
  updateTerrarium,
  renderTerrariumFrame,
} from '../tui/terrarium.js';

let randomIndex = 0;
const RANDOM_SEQ = [
  0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.15,
  0.55, 0.35, 0.75, 0.25, 0.65, 0.45, 0.85, 0.95, 0.05, 0.50,
  0.33, 0.66, 0.11, 0.88, 0.44, 0.77, 0.22, 0.99, 0.01, 0.51,
  0.42, 0.58, 0.31, 0.69, 0.18, 0.82, 0.37, 0.63, 0.29, 0.71,
  0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.15,
  0.55, 0.35, 0.75, 0.25, 0.65, 0.45, 0.85, 0.95, 0.05, 0.50,
];

let randomSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  randomIndex = 0;
  randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
    const val = RANDOM_SEQ[randomIndex % RANDOM_SEQ.length];
    randomIndex++;
    return val;
  });
});

afterEach(() => {
  randomSpy.mockRestore();
});

describe('TUI terrarium snapshots', () => {
  it('initTerrarium creates context with expected structure', () => {
    const ctx = initTerrarium();
    expect(ctx.octopi).toHaveLength(0);
    expect(ctx.jellyfish).toHaveLength(0);
    expect(ctx.crayfish.visible).toBe(false);
    expect(ctx.bubbles.length).toBeGreaterThan(0);
    expect(ctx.schools).toHaveLength(2);
  });

  it('setOctopi configures octopus instances', () => {
    const ctx = initTerrarium();
    setOctopi(ctx, [
      { id: 'a', state: 'idle', name: 'TestProject' },
      { id: 'b', state: 'processing', name: 'AgentDeck' },
    ]);
    expect(ctx.octopi).toHaveLength(2);
    expect(ctx.octopi[0].name).toBe('TestProject');
    expect(ctx.octopi[1].state).toBe('processing');
  });

  it('setCrayfish configures crayfish state', () => {
    const ctx = initTerrarium();
    setCrayfish(ctx, true, true, 'Gateway', false);
    expect(ctx.crayfish.visible).toBe(true);
    expect(ctx.crayfish.routing).toBe(true);
  });

  it('setJellyfish configures jellyfish instances', () => {
    const ctx = initTerrarium();
    setJellyfish(ctx, [
      { id: 'j1', state: 'idle', name: 'Codex', agentType: 'codex-cli' },
    ]);
    expect(ctx.jellyfish).toHaveLength(1);
    expect(ctx.jellyfish[0].name).toBe('Codex');
  });

  it('renderTerrariumFrame empty terrarium (small)', () => {
    const ctx = initTerrarium();
    updateTerrarium(ctx, 0);
    const lines = renderTerrariumFrame(ctx, 60, 15, 0);
    expect(lines).toHaveLength(15);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame empty terrarium (large)', () => {
    const ctx = initTerrarium();
    updateTerrarium(ctx, 0);
    const lines = renderTerrariumFrame(ctx, 120, 25, 0);
    expect(lines).toHaveLength(25);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame with idle octopus', () => {
    const ctx = initTerrarium();
    setOctopi(ctx, [{ id: 'a', state: 'idle', name: 'Test' }]);
    updateTerrarium(ctx, 0);
    const lines = renderTerrariumFrame(ctx, 80, 20, 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame with processing octopus', () => {
    const ctx = initTerrarium();
    setOctopi(ctx, [{ id: 'a', state: 'processing', name: 'AgentDeck' }]);
    updateTerrarium(ctx, 10);
    const lines = renderTerrariumFrame(ctx, 80, 20, 10);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame with routing crayfish', () => {
    const ctx = initTerrarium();
    setCrayfish(ctx, true, true, 'OpenClaw');
    updateTerrarium(ctx, 5);
    const lines = renderTerrariumFrame(ctx, 80, 20, 5);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame with sick crayfish', () => {
    const ctx = initTerrarium();
    setCrayfish(ctx, true, false, 'Gateway', true);
    updateTerrarium(ctx, 0);
    const lines = renderTerrariumFrame(ctx, 80, 20, 0);
    expect(lines).toMatchSnapshot();
  });

  it('renderTerrariumFrame too small returns empty', () => {
    const ctx = initTerrarium();
    const lines = renderTerrariumFrame(ctx, 10, 2, 0);
    expect(lines).toHaveLength(0);
  });

  it('updateTerrarium advances bubble positions', () => {
    const ctx = initTerrarium();
    const y0 = ctx.bubbles[0].y;
    updateTerrarium(ctx, 0);
    updateTerrarium(ctx, 1);
    // Bubbles should move up (y decreases)
    expect(ctx.bubbles[0].y).toBeLessThan(y0);
  });
});
