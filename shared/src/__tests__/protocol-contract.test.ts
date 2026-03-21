/**
 * Protocol contract tests: validate BridgeEvent JSON shapes.
 *
 * These tests ensure that protocol messages contain all required fields
 * across all 5 client platforms (Plugin, Android, Apple, ESP32, TUI).
 * Catches cross-platform protocol drift when TypeScript types evolve.
 */
import { describe, it, expect } from 'vitest';
import { State, PermissionMode } from '../states.js';
import type {
  StateUpdateEvent,
  UsageEvent,
  ConnectionEvent,
  SessionsListEvent,
  ButtonStateEvent,
  EncoderStateEvent,
  DeckSlotMapEvent,
  DisplayStateEvent,
  TimelineEventMsg,
  TimelineHistoryMsg,
  VoiceStateEvent,
  BridgeEvent,
  PluginCommand,
} from '../protocol.js';
import type { TimelineEntry } from '../timeline.js';

// ─── Helpers ────────────────────────────────────────────────────────

/** Validate that a value is a valid hex color (#RRGGBB or #RGB) */
function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
}

// ─── Sample Event Factories ─────────────────────────────────────────

function sampleStateUpdate(): StateUpdateEvent {
  return {
    type: 'state_update',
    state: State.IDLE,
    permissionMode: PermissionMode.DEFAULT,
  };
}

function sampleFullStateUpdate(): StateUpdateEvent {
  return {
    type: 'state_update',
    state: State.AWAITING_PERMISSION,
    permissionMode: PermissionMode.DEFAULT,
    agentType: 'claude-code',
    currentTool: 'Read',
    toolInput: '/src/index.ts',
    toolProgress: 'Using Read',
    projectName: 'AgentDeck',
    modelName: 'opus-4',
    effortLevel: 'high',
    billingType: 'subscription',
    options: [
      { index: 0, label: 'Allow once', shortcut: 'y' },
      { index: 1, label: 'Always allow', shortcut: 'a' },
    ],
    promptType: 'yes_no_always',
    question: 'Allow Read?',
    navigable: true,
    cursorIndex: 0,
    suggestedPrompt: 'go on',
    ollamaStatus: { available: true, models: [{ name: 'qwen2.5:7b', size: 4_500_000_000, sizeVram: 4_500_000_000 }] },
    gatewayAvailable: false,
    gatewayHasError: false,
  };
}

function sampleUsageUpdate(): UsageEvent {
  return {
    type: 'usage_update',
    sessionDurationSec: 120,
    inputTokens: 5000,
    outputTokens: 2000,
    toolCalls: 15,
    estimatedCostUsd: 0.42,
    fiveHourPercent: 35,
    fiveHourResetsAt: '2026-03-21T15:00:00Z',
    sevenDayPercent: 12,
    sevenDayResetsAt: '2026-03-25T00:00:00Z',
    oauthConnected: true,
    ollamaStatus: { available: true, models: [] },
    tokenStatus: 'valid',
  };
}

function sampleSessionsList(): SessionsListEvent {
  return {
    type: 'sessions_list',
    sessions: [
      {
        id: 'abc-123',
        port: 9121,
        projectName: 'AgentDeck',
        agentType: 'claude-code',
        alive: true,
        state: 'idle',
      },
    ],
  };
}

function sampleButtonState(): ButtonStateEvent {
  return {
    type: 'button_state',
    buttons: [
      {
        slot: 0,
        title: 'DEFAULT',
        bgColor: '#1e293b',
        textColor: '#f8fafc',
        enabled: true,
        action: 'switch_mode',
      },
    ],
  };
}

function sampleEncoderState(): EncoderStateEvent {
  return {
    type: 'encoder_state',
    encoders: [
      {
        slot: 0,
        encoderType: 'utility',
        header: 'VOLUME',
        value: '65%',
        icon: '🔊',
        accentColor: '#3b82f6',
        progress: 0.65,
      },
    ],
    takeoverActive: false,
  };
}

function sampleTimelineEvent(): TimelineEventMsg {
  return {
    type: 'timeline_event',
    entry: {
      ts: 37800,
      type: 'tool_request',
      raw: 'Read /src/index.ts',
    } as TimelineEntry,
  };
}

function sampleConnection(): ConnectionEvent {
  return {
    type: 'connection',
    status: 'connected',
    sessionId: 'abc-123',
  };
}

function sampleDisplayState(): DisplayStateEvent {
  return {
    type: 'display_state',
    displayOn: true,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Protocol Contract — StateUpdateEvent', () => {
  it('minimal state_update has required fields', () => {
    const evt = sampleStateUpdate();
    expect(evt.type).toBe('state_update');
    expect(Object.values(State)).toContain(evt.state);
    expect(Object.values(PermissionMode)).toContain(evt.permissionMode);
  });

  it('full state_update has all optional fields as correct types', () => {
    const evt = sampleFullStateUpdate();

    // Required
    expect(evt.type).toBe('state_update');
    expect(typeof evt.state).toBe('string');
    expect(typeof evt.permissionMode).toBe('string');

    // Optional string fields
    for (const key of ['agentType', 'currentTool', 'toolInput', 'toolProgress',
      'projectName', 'modelName', 'effortLevel', 'billingType',
      'question', 'suggestedPrompt'] as const) {
      if (evt[key] !== undefined) {
        expect(typeof evt[key]).toBe('string');
      }
    }

    // Options array
    if (evt.options) {
      expect(Array.isArray(evt.options)).toBe(true);
      for (const opt of evt.options) {
        expect(typeof opt.label).toBe('string');
        expect(typeof opt.label).toBe('string');
      }
    }

    // Boolean fields
    for (const key of ['navigable', 'gatewayAvailable', 'gatewayHasError'] as const) {
      if (evt[key] !== undefined) {
        expect(typeof evt[key]).toBe('boolean');
      }
    }

    // Number field
    if (evt.cursorIndex !== undefined) {
      expect(typeof evt.cursorIndex).toBe('number');
    }

    // OllamaStatus
    if (evt.ollamaStatus) {
      expect(typeof evt.ollamaStatus.available).toBe('boolean');
      expect(Array.isArray(evt.ollamaStatus.models)).toBe(true);
    }
  });

  it('state_update serializes to valid JSON', () => {
    const evt = sampleFullStateUpdate();
    const json = JSON.stringify(evt);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('state_update');
    expect(parsed.state).toBe(evt.state);
  });

  it('state enum values are lowercase strings', () => {
    // ESP32 and Android parse state as lowercase
    for (const s of Object.values(State)) {
      expect(s).toMatch(/^[a-z_]+$/);
    }
  });

  it('promptType values match known set', () => {
    const validTypes = ['yes_no', 'yes_no_always', 'multi_select', 'diff_review'];
    const evt = sampleFullStateUpdate();
    if (evt.promptType) {
      expect(validTypes).toContain(evt.promptType);
    }
  });
});

describe('Protocol Contract — UsageEvent', () => {
  it('has all required numeric fields', () => {
    const evt = sampleUsageUpdate();
    expect(evt.type).toBe('usage_update');
    expect(typeof evt.sessionDurationSec).toBe('number');
    expect(typeof evt.inputTokens).toBe('number');
    expect(typeof evt.outputTokens).toBe('number');
    expect(typeof evt.toolCalls).toBe('number');
  });

  it('rate limit fields are present when available', () => {
    const evt = sampleUsageUpdate();
    if (evt.fiveHourPercent !== undefined) {
      expect(typeof evt.fiveHourPercent).toBe('number');
      expect(evt.fiveHourPercent).toBeGreaterThanOrEqual(0);
      expect(evt.fiveHourPercent).toBeLessThanOrEqual(100);
    }
    if (evt.fiveHourResetsAt !== undefined) {
      expect(typeof evt.fiveHourResetsAt).toBe('string');
      // Should be ISO date string
      expect(() => new Date(evt.fiveHourResetsAt!)).not.toThrow();
    }
  });

  it('tokenStatus matches known values', () => {
    const evt = sampleUsageUpdate();
    if (evt.tokenStatus) {
      expect(['valid', 'expired', 'missing', 'unknown']).toContain(evt.tokenStatus);
    }
  });
});

describe('Protocol Contract — SessionsListEvent', () => {
  it('sessions have required fields', () => {
    const evt = sampleSessionsList();
    expect(evt.type).toBe('sessions_list');
    expect(Array.isArray(evt.sessions)).toBe(true);

    for (const s of evt.sessions) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.port).toBe('number');
      expect(typeof s.projectName).toBe('string');
      expect(typeof s.alive).toBe('boolean');
    }
  });

  it('agentType is optional string', () => {
    const evt = sampleSessionsList();
    for (const s of evt.sessions) {
      if (s.agentType !== undefined) {
        expect(typeof s.agentType).toBe('string');
      }
    }
  });
});

describe('Protocol Contract — ButtonStateEvent', () => {
  it('buttons have required fields', () => {
    const evt = sampleButtonState();
    expect(evt.type).toBe('button_state');
    expect(Array.isArray(evt.buttons)).toBe(true);

    for (const btn of evt.buttons) {
      expect(typeof btn.slot).toBe('number');
      expect(btn.slot).toBeGreaterThanOrEqual(0);
      expect(btn.slot).toBeLessThanOrEqual(7);
      expect(typeof btn.title).toBe('string');
      expect(isHexColor(btn.bgColor)).toBe(true);
      expect(isHexColor(btn.textColor)).toBe(true);
      expect(typeof btn.enabled).toBe('boolean');
    }
  });
});

describe('Protocol Contract — EncoderStateEvent', () => {
  it('encoders have required fields', () => {
    const evt = sampleEncoderState();
    expect(evt.type).toBe('encoder_state');
    expect(typeof evt.takeoverActive).toBe('boolean');
    expect(Array.isArray(evt.encoders)).toBe(true);

    for (const enc of evt.encoders) {
      expect(typeof enc.slot).toBe('number');
      expect(enc.slot).toBeGreaterThanOrEqual(0);
      expect(enc.slot).toBeLessThanOrEqual(3);
      expect(['utility', 'action', 'terminal', 'voice']).toContain(enc.encoderType);
      expect(typeof enc.header).toBe('string');
      expect(isHexColor(enc.accentColor)).toBe(true);
    }
  });
});

describe('Protocol Contract — TimelineEventMsg', () => {
  it('entry has required fields', () => {
    const evt = sampleTimelineEvent();
    expect(evt.type).toBe('timeline_event');
    expect(typeof evt.entry.ts).toBe('number');
    expect(typeof evt.entry.type).toBe('string');
    expect(typeof evt.entry.raw).toBe('string');
  });
});

describe('Protocol Contract — ConnectionEvent', () => {
  it('has required fields', () => {
    const evt = sampleConnection();
    expect(evt.type).toBe('connection');
    expect(['connected', 'reconnecting', 'disconnected']).toContain(evt.status);
  });
});

describe('Protocol Contract — DisplayStateEvent', () => {
  it('has boolean displayOn', () => {
    const evt = sampleDisplayState();
    expect(evt.type).toBe('display_state');
    expect(typeof evt.displayOn).toBe('boolean');
  });
});

describe('Protocol Contract — PluginCommand shapes', () => {
  it('respond command has value', () => {
    const cmd: PluginCommand = { type: 'respond', value: 'y' };
    expect(cmd.type).toBe('respond');
    expect(typeof (cmd as { value: string }).value).toBe('string');
  });

  it('select_option has numeric index', () => {
    const cmd: PluginCommand = { type: 'select_option', index: 2 };
    expect(typeof (cmd as { index: number }).index).toBe('number');
  });

  it('navigate_option has direction', () => {
    const cmd: PluginCommand = { type: 'navigate_option', direction: 'up' };
    expect(['up', 'down']).toContain((cmd as { direction: string }).direction);
  });

  it('send_prompt has text', () => {
    const cmd: PluginCommand = { type: 'send_prompt', text: 'go on' };
    expect(typeof (cmd as { text: string }).text).toBe('string');
  });

  it('utility command has action', () => {
    const cmd: PluginCommand = { type: 'utility', action: 'adjust_volume', value: 3 };
    const validActions = ['adjust_volume', 'toggle_mute', 'adjust_brightness',
      'media_play_pause', 'media_next', 'media_prev'];
    expect(validActions).toContain((cmd as { action: string }).action);
  });
});

describe('Protocol Contract — BridgeEvent discriminated union', () => {
  it('all event types in union have type field', () => {
    const samples: BridgeEvent[] = [
      sampleStateUpdate(),
      sampleUsageUpdate(),
      sampleConnection(),
      sampleSessionsList(),
      sampleButtonState(),
      sampleEncoderState(),
      sampleTimelineEvent(),
      sampleDisplayState(),
      { type: 'voice_state', state: 'idle' } as VoiceStateEvent,
      { type: 'timeline_history', entries: [] } as TimelineHistoryMsg,
    ];

    for (const evt of samples) {
      expect(typeof evt.type).toBe('string');
      expect(evt.type.length).toBeGreaterThan(0);
      // Verify JSON round-trip preserves type
      const parsed = JSON.parse(JSON.stringify(evt));
      expect(parsed.type).toBe(evt.type);
    }
  });

  it('SERIAL_FORWARDED_EVENTS covers expected types', async () => {
    const { SERIAL_FORWARDED_EVENTS, DISPLAY_FORWARDED_EVENTS } = await import('../protocol.js');

    // Serial must include all display events
    for (const evt of DISPLAY_FORWARDED_EVENTS) {
      expect(SERIAL_FORWARDED_EVENTS.has(evt)).toBe(true);
    }

    // Serial adds timeline events
    expect(SERIAL_FORWARDED_EVENTS.has('timeline_event')).toBe(true);
    expect(SERIAL_FORWARDED_EVENTS.has('timeline_history')).toBe(true);

    // Core events must be present
    expect(SERIAL_FORWARDED_EVENTS.has('state_update')).toBe(true);
    expect(SERIAL_FORWARDED_EVENTS.has('usage_update')).toBe(true);
    expect(SERIAL_FORWARDED_EVENTS.has('sessions_list')).toBe(true);
    expect(SERIAL_FORWARDED_EVENTS.has('connection')).toBe(true);
    expect(SERIAL_FORWARDED_EVENTS.has('display_state')).toBe(true);
  });
});

describe('Protocol Contract — Backward Compatibility', () => {
  it('state_update can be parsed with only required fields (old client)', () => {
    // An old client should be able to parse a minimal state_update
    const minimal: Record<string, unknown> = {
      type: 'state_update',
      state: 'idle',
      permissionMode: 'default',
    };

    // Required fields present
    expect(minimal.type).toBe('state_update');
    expect(typeof minimal.state).toBe('string');
    expect(typeof minimal.permissionMode).toBe('string');

    // Optional fields gracefully absent
    expect(minimal.ollamaStatus).toBeUndefined();
    expect(minimal.gatewayAvailable).toBeUndefined();
    expect(minimal.voiceAssistantState).toBeUndefined();
  });

  it('usage_update required fields are sufficient for display', () => {
    // Minimum viable usage event for any client
    const minimal: UsageEvent = {
      type: 'usage_update',
      sessionDurationSec: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
    };

    // Numeric fields needed for gauges
    expect(typeof minimal.sessionDurationSec).toBe('number');
    expect(typeof minimal.inputTokens).toBe('number');
    expect(typeof minimal.outputTokens).toBe('number');
    expect(typeof minimal.toolCalls).toBe('number');
  });
});
