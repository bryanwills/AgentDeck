import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-pty before any imports that use it
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _pty: '/dev/ttys042',
  })),
}));

// Mock express/http for HookServer
vi.mock('express', () => {
  const app = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  };
  const fn = Object.assign(vi.fn(() => app), {
    json: vi.fn(() => vi.fn()),
  });
  return { default: fn };
});

vi.mock('http', async () => {
  const actual = await vi.importActual<typeof import('http')>('http');
  const mockServer = {
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn(),
  };
  return {
    ...actual,
    createServer: vi.fn(() => mockServer),
  };
});

import { createAdapter, ClaudeCodeAdapter } from '../adapters/index.js';
import type { AgentAdapter, AdapterEvent, PluginCommand } from '../types.js';

describe('createAdapter factory', () => {
  it('creates ClaudeCodeAdapter for "claude-code"', () => {
    const adapter = createAdapter('claude-code');
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.capabilities.type).toBe('claude-code');
    expect(adapter.capabilities.displayName).toBe('Claude Code');
  });

  it('throws for "openclaw" (not yet implemented)', () => {
    expect(() => createAdapter('openclaw')).toThrow('not yet implemented');
  });

  it('throws for unknown agent type', () => {
    expect(() => createAdapter('unknown' as any)).toThrow('Unknown agent type');
  });
});

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
  });

  describe('capabilities', () => {
    it('reports all Claude Code capabilities as true', () => {
      const caps = adapter.capabilities;
      expect(caps.hasTerminal).toBe(true);
      expect(caps.hasModeSwitching).toBe(true);
      expect(caps.hasDiffReview).toBe(true);
      expect(caps.hasOptionLists).toBe(true);
      expect(caps.hasNavigablePrompts).toBe(true);
      expect(caps.hasSuggestedPrompts).toBe(true);
      expect(caps.hasApiUsage).toBe(true);
    });
  });

  describe('handleCommand routing', () => {
    it('handles respond → returns true', () => {
      const cmd: PluginCommand = { type: 'respond', value: 'y' };
      expect(adapter.handleCommand(cmd)).toBe(true);
    });

    it('handles switch_mode → returns true', () => {
      const cmd: PluginCommand = { type: 'switch_mode' };
      expect(adapter.handleCommand(cmd)).toBe(true);
    });

    it('handles interrupt → returns true', () => {
      const cmd: PluginCommand = { type: 'interrupt' };
      expect(adapter.handleCommand(cmd)).toBe(true);
    });

    it('handles escape → returns true', () => {
      const cmd: PluginCommand = { type: 'escape' };
      expect(adapter.handleCommand(cmd)).toBe(true);
    });

    it('defers select_option to bridge → returns false', () => {
      const cmd: PluginCommand = { type: 'select_option', index: 0 };
      expect(adapter.handleCommand(cmd)).toBe(false);
    });

    it('defers navigate_option to bridge → returns false', () => {
      const cmd: PluginCommand = { type: 'navigate_option', direction: 'up' };
      expect(adapter.handleCommand(cmd)).toBe(false);
    });

    it('defers send_prompt to bridge → returns false', () => {
      const cmd: PluginCommand = { type: 'send_prompt', text: 'hello' };
      expect(adapter.handleCommand(cmd)).toBe(false);
    });

    it('defers voice to bridge → returns false', () => {
      const cmd: PluginCommand = { type: 'voice', action: 'start' };
      expect(adapter.handleCommand(cmd)).toBe(false);
    });

    it('defers query_usage to bridge → returns false', () => {
      const cmd: PluginCommand = { type: 'query_usage' };
      expect(adapter.handleCommand(cmd)).toBe(false);
    });
  });

  describe('switch_mode debounce', () => {
    it('debounces rapid switch_mode calls (< 100ms apart)', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const cmd: PluginCommand = { type: 'switch_mode' };
      expect(adapter.handleCommand(cmd)).toBe(true);

      // Call again within 100ms
      vi.spyOn(Date, 'now').mockReturnValue(now + 50);
      expect(adapter.handleCommand(cmd)).toBe(true); // Still returns true (handled = debounced)

      vi.restoreAllMocks();
    });
  });

  describe('lifecycle', () => {
    it('isAlive returns false before start', () => {
      expect(adapter.isAlive()).toBe(false);
    });

    it('getTtyPath returns undefined before start', () => {
      expect(adapter.getTtyPath()).toBeUndefined();
    });

    it('getProjectName returns null before start', () => {
      expect(adapter.getProjectName()).toBeNull();
    });

    it('getHttpServer returns an object', () => {
      // Even before start, the HookServer creates the HTTP server in constructor
      expect(adapter.getHttpServer()).toBeDefined();
    });
  });

  describe('onRawData callback', () => {
    it('can register callback without error', () => {
      const cb = vi.fn();
      expect(() => adapter.onRawData(cb)).not.toThrow();
    });
  });

  describe('onDiag handler', () => {
    it('can register handler without error', () => {
      const handler = vi.fn();
      expect(() => adapter.onDiag(handler)).not.toThrow();
    });
  });
});
