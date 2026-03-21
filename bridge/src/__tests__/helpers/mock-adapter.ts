/**
 * Test helper: mock AgentAdapter that emits scripted AdapterEvent sequences.
 * Used for integration tests that need adapter events without real PTY.
 */
import { EventEmitter } from 'events';
import type {
  AgentCapabilities,
  AdapterEvent,
  PluginCommand,
} from '../../types.js';
import { CLAUDE_CODE_CAPABILITIES } from '@agentdeck/shared';

export class MockAdapter extends EventEmitter {
  capabilities: AgentCapabilities = { ...CLAUDE_CODE_CAPABILITIES };
  started = false;
  commands: PluginCommand[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  async handleCommand(cmd: PluginCommand): Promise<void> {
    this.commands.push(cmd);
  }

  async shutdown(): Promise<void> {
    this.started = false;
  }

  isAlive(): boolean {
    return this.started;
  }

  getDiagnostics(): Record<string, unknown> {
    return { mock: true };
  }

  /** Emit an adapter event (convenience method for tests) */
  emitAdapterEvent(evt: AdapterEvent): void {
    this.emit('event', evt);
  }

  /** Simulate a hook event sequence */
  emitHookEvent(event: string, data: Record<string, unknown> = {}): void {
    this.emitAdapterEvent({ source: 'hook', event, data });
  }

  /** Simulate a parser event */
  emitParserEvent(event: string, data?: Record<string, unknown>): void {
    this.emitAdapterEvent({ source: 'parser', event, data } as AdapterEvent);
  }
}
