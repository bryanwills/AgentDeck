import { describe, it, expect } from 'vitest';
import { buildButtonCommandMap } from '../d200h/image-renderer.js';

// Physical key index == row * 5 + col. These tests lock the layout-derived
// command map (the single source of truth for D200H button input) against the
// behaviour of the old hand-maintained SINGLE/MULTI_SESSION_COMMANDS dicts, so
// any future change to computeLayout that would silently desync input fails CI.

const session = (id: string, agentType = 'claude-code') => ({
  id,
  agentType,
  projectName: `proj-${id}`,
  modelName: 'claude-opus-4-8',
  state: 'awaiting_input',
  alive: true,
  port: 9121,
});

describe('D200H buildButtonCommandMap', () => {
  it('single-session AWAITING: mode/focus/options/usage/interrupt at expected keys', () => {
    const m = buildButtonCommandMap({
      state: 'AWAITING_INPUT',
      mode: 'plan',
      modelName: 'claude-opus-4-8',
      options: [{ label: 'Yes' }, { label: 'No' }, { label: 'Maybe' }, { label: 'Later' }],
      allSessions: [session('s1')],
    });
    // index = row*5 + col
    expect(m.get(0)).toEqual({ type: 'mode_toggle' });            // (0,0) MODE
    expect(m.get(1)).toEqual({ type: 'focus_session', sessionId: 's1' }); // (1,0) hero session
    expect(m.get(2)).toBeUndefined();                              // (2,0) detail = inert
    expect(m.get(3)).toEqual({ type: 'select_option', index: 0 }); // (3,0)
    expect(m.get(4)).toEqual({ type: 'select_option', index: 1 }); // (4,0)
    expect(m.get(5)).toEqual({ type: 'select_option', index: 2 }); // (0,1)
    expect(m.get(6)).toEqual({ type: 'select_option', index: 3 }); // (1,1)
    expect(m.get(7)).toBeUndefined();                              // (2,1) MODEL = inert
    expect(m.get(8)).toEqual({ type: 'usage_toggle' });            // (3,1) 5H
    expect(m.get(9)).toEqual({ type: 'usage_toggle' });            // (4,1) 7D
    expect(m.get(10)).toEqual({ type: 'interrupt' });              // (0,2) ESC
    expect(m.get(11)).toBeUndefined();                             // (1,2) TOKENS
    expect(m.get(12)).toBeUndefined();                             // (2,2) COST
  });

  it('multi-session AWAITING: sessions focus by real id, options on row 1', () => {
    const m = buildButtonCommandMap({
      state: 'AWAITING_INPUT',
      mode: 'default',
      modelName: 'claude-opus-4-8',
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      allSessions: [session('a'), session('b', 'codex'), session('c'), session('d')],
    });
    expect(m.get(0)).toEqual({ type: 'mode_toggle' });
    expect(m.get(1)).toEqual({ type: 'focus_session', sessionId: 'a' }); // (1,0)
    expect(m.get(2)).toEqual({ type: 'focus_session', sessionId: 'b' }); // (2,0)
    expect(m.get(3)).toEqual({ type: 'focus_session', sessionId: 'c' }); // (3,0)
    expect(m.get(4)).toEqual({ type: 'focus_session', sessionId: 'd' }); // (4,0)
    expect(m.get(5)).toEqual({ type: 'select_option', index: 0 }); // (0,1)
    expect(m.get(6)).toEqual({ type: 'select_option', index: 1 }); // (1,1)
    expect(m.get(7)).toEqual({ type: 'select_option', index: 2 }); // (2,1)
    expect(m.get(8)).toEqual({ type: 'select_option', index: 3 }); // (3,1)
    expect(m.get(9)).toBeUndefined();                              // (4,1) MODEL = inert
    expect(m.get(10)).toEqual({ type: 'interrupt' });              // (0,2)
  });

  it('options are inert unless AWAITING', () => {
    const m = buildButtonCommandMap({
      state: 'PROCESSING',
      mode: 'plan',
      options: [{ label: 'Yes' }],
      allSessions: [session('s1')],
    });
    expect(m.get(3)).toBeUndefined(); // option slot not actionable while processing
    expect(m.get(10)).toEqual({ type: 'interrupt' }); // STOP still works
    expect(m.get(0)).toEqual({ type: 'mode_toggle' });
  });

  it('no real session: hero focus is inert (no synthetic id dispatched)', () => {
    const m = buildButtonCommandMap({ state: 'IDLE', mode: 'default', allSessions: [] });
    expect(m.get(1)).toBeUndefined(); // would have been focus_session 'local'
    expect(m.get(0)).toEqual({ type: 'mode_toggle' });
  });

  it('DISCONNECTED frame has no actionable keys', () => {
    const m = buildButtonCommandMap({ state: 'DISCONNECTED', allSessions: [] });
    expect(m.size).toBe(0);
  });
});
