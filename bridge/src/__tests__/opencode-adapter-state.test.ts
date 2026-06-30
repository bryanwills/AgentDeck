import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { OpenCodeAdapter } from '../adapters/opencode-adapter.js';
import type { AdapterEvent } from '../types.js';

/**
 * Regression guard for the "active OpenCode session shows idle" bug: OpenCode
 * derives run-state purely from SSE (PTY parser is a no-op), and current
 * OpenCode builds do not reliably emit a `session.status:busy` start event.
 * Work-start must therefore be armed from the events OpenCode actually emits
 * (message.part.updated / message.part.delta / message.updated), each of which
 * fires `spinner_start` → StateMachine IDLE → PROCESSING.
 */
describe('OpenCodeAdapter run-state arming', () => {
  let adapter: OpenCodeAdapter;
  let client: EventEmitter;
  let events: AdapterEvent[];

  const sse = (type: string, properties: Record<string, unknown>) =>
    client.emit('sse', { payload: { type, properties } });
  const parserEvents = (name: string) =>
    events.filter((e) => e.source === 'parser' && (e as { event?: string }).event === name);

  beforeEach(() => {
    adapter = new OpenCodeAdapter();
    client = new EventEmitter();
    // Inject the fake SSE client and wire the handlers without spawning a PTY.
    (adapter as unknown as { client: EventEmitter }).client = client;
    (adapter as unknown as { wireSSEEvents(): void }).wireSSEEvents();
    events = [];
    adapter.on('event', (e: AdapterEvent) => events.push(e));
  });

  it('arms processing on the first message.part.updated and latches once per turn', () => {
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';

    sse('message.part.updated', {
      part: { type: 'tool', tool: 'bash', sessionID: 'ses_test', state: { status: 'running' } },
    });
    sse('message.part.updated', {
      part: { type: 'tool', tool: 'read', sessionID: 'ses_test', state: { status: 'running' } },
    });

    // Latched: exactly one spinner_start for the turn despite two parts.
    expect(parserEvents('spinner_start')).toHaveLength(1);
  });

  it('emits idle on session.idle and re-arms on the next turn', () => {
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';

    sse('message.part.delta', { delta: 'hello' });
    expect(parserEvents('spinner_start')).toHaveLength(1);

    sse('session.idle', { sessionID: 'ses_test' });
    expect(parserEvents('idle')).toHaveLength(1);

    // Latch reset → next turn arms again.
    sse('message.part.delta', { delta: 'world' });
    expect(parserEvents('spinner_start')).toHaveLength(2);
  });

  it('auto-tracks the session and arms when no active session was resolved at connect', () => {
    // activeSessionID intentionally left null (listSessions missed it).
    sse('message.part.updated', {
      part: { type: 'text', text: 'hi', sessionID: 'ses_late' },
    });

    expect((adapter as unknown as { activeSessionID: string | null }).activeSessionID).toBe('ses_late');
    expect(parserEvents('spinner_start')).toHaveLength(1);
  });

  it('arms when an assistant message is still generating (no time.completed)', () => {
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';

    sse('message.updated', {
      info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_test', modelID: 'gpt', time: { created: 1 } },
    });

    expect(parserEvents('spinner_start')).toHaveLength(1);
  });

  it('does not arm on a completed assistant message alone', () => {
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';

    sse('message.updated', {
      info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_test', modelID: 'gpt', time: { created: 1, completed: 2 } },
    });

    expect(parserEvents('spinner_start')).toHaveLength(0);
  });

  it('drops parts for a different active session', () => {
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';

    sse('message.part.updated', {
      part: { type: 'tool', tool: 'bash', sessionID: 'ses_other', state: { status: 'running' } },
    });

    expect(parserEvents('spinner_start')).toHaveLength(0);
  });
});
