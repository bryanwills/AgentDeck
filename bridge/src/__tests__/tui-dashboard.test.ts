import { describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import type { StateUpdateEvent } from '@agentdeck/shared';
import { renderDashboard } from '../tui/renderer.js';
import { applyStateUpdate, type DashboardState } from '../tui/dashboard.js';

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    state: 'idle',
    connectionStatus: 'connected',
    isStale: false,
    projectName: 'AgentDeck',
    modelName: 'opus-4',
    currentTool: null,
    sessions: [],
    usage: null,
    modelCatalog: [],
    timeline: [],
    helpVisible: false,
    currentPort: 9120,
    agentType: 'claude-code',
    gatewayAvailable: false,
    crayfishRouting: false,
    gatewayHasError: false,
    voiceAssistantState: 'disabled',
    voiceAssistantText: null,
    voiceAssistantResponseText: null,
    ...overrides,
  };
}

describe('TUI dashboard models', () => {
  it('stores modelCatalog from state_update', () => {
    const state = makeState({
      modelCatalog: [{ name: 'old-model', role: 'configured', available: true }],
    });

    applyStateUpdate(state, {
      type: 'state_update',
      state: 'idle',
      permissionMode: 'default',
      modelCatalog: [
        { name: 'opus-4', role: 'default', available: true },
        { name: 'sonnet-4', role: 'fallback-1', available: true },
      ],
    } as StateUpdateEvent);

    expect(state.modelCatalog.map((m) => m.name)).toEqual(['opus-4', 'sonnet-4']);
  });

  it('renders OAuth catalog and Ollama models in wide layout', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        usage: {
          type: 'usage_update',
          sessionDurationSec: 90,
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          oauthConnected: true,
          ollamaStatus: {
            available: true,
            models: [
              { name: 'qwen2.5:7b', size: 4_500_000_000, sizeVram: 4_500_000_000 },
              { name: 'llama3.2:3b', size: 2_000_000_000, sizeVram: 0 },
            ],
          },
        },
        modelCatalog: [
          { name: 'opus-4', role: 'default', available: true },
          { name: 'sonnet-4', role: 'fallback-1', available: true },
        ],
      }),
      140,
      28,
      [],
      0,
      0,
    ));

    expect(output).toContain('MODELS');
    expect(output).toContain('OAuth: opus-4, sonnet-4');
    expect(output).toContain('Ollama: qwen2.5:7b 4.5G');
    expect(output).toContain('Ollama: llama3.2:3b 2.0G');
  });

  it('renders disconnected OAuth state', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        usage: {
          type: 'usage_update',
          sessionDurationSec: 30,
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          oauthConnected: false,
          ollamaStatus: { available: false, models: [] },
        },
      }),
      100,
      24,
      [],
      0,
      0,
    ));

    expect(output).toContain('OAuth: disconnected');
    expect(output).toContain('Ollama: stopped');
  });

  it('shows current session summary and control hints', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        projectName: 'my-project',
        modelName: 'sonnet-4',
        state: 'processing',
        sessions: [{ id: 's1', port: 9121, projectName: 'other', alive: true, state: 'idle' }],
      }),
      100,
      24,
      [],
      0,
      0,
    ));

    expect(output).toContain('my-project · sonnet-4 · PROC');
    expect(output).toContain('q quit  ↑↓/j k scroll  1-9 switch session');
  });

  it('renders agent list secondary line as model dash compact state', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        projectName: 'my-project',
        modelName: 'sonnet-4',
        state: 'processing',
      }),
      120,
      28,
      [],
      0,
      0,
    ));

    expect(output).toContain('sonnet-4 - PROC');
  });

  it('renders sibling models in session bridge mode and omits uptime label', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        projectName: 'primary',
        modelName: 'opus-4',
        state: 'idle',
        sessions: [
          { id: 's1', port: 9121, projectName: 'other', alive: true, state: 'processing', modelName: 'codex-mini' },
        ],
        usage: {
          type: 'usage_update',
          sessionDurationSec: 90,
          inputTokens: 1200,
          outputTokens: 3400,
          toolCalls: 2,
        },
      }),
      120,
      28,
      [],
      0,
      0,
    ));

    expect(output).toContain('codex-mini - PROC');
    expect(output).not.toContain('Up:');
  });

  it('renders help overlay when helpVisible is on', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        helpVisible: true,
      }),
      100,
      30,
      [],
      0,
      0,
    ));

    expect(output).toContain('AgentDeck TUI Help');
    expect(output).toContain('? / h    toggle help');
    expect(output).toContain('Press ? or Esc to return');
  });

  it('shows numbered session badges', () => {
    const output = stripAnsi(renderDashboard(
      makeState({
        sessions: [
          { id: 's1', port: 9121, projectName: 'build', alive: true, state: 'processing' },
          { id: 's2', port: 9122, projectName: 'docs', alive: true, state: 'idle' },
        ],
      }),
      140,
      28,
      [],
      0,
      0,
    ));

    expect(output).toContain('[1]');
    expect(output).toContain('[2]');
  });
});
