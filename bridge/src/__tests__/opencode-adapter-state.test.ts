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

/**
 * Turn-shape parity with the Claude / OpenClaw timeline pattern:
 *   chat_start carries the user prompt (upserted once it surfaces),
 *   chat_response IS the completion row when a response exists, and
 *   chat_end appears ONLY for response-less turns — never both.
 * The old shape (generic "Processing" chat_start + chat_response + paired
 * chat_end) fragmented every OpenCode turn into three rows on the flat
 * surfaces and never showed what was asked.
 */
describe('OpenCodeAdapter timeline turn shape', () => {
  let adapter: OpenCodeAdapter;
  let client: EventEmitter;
  let events: AdapterEvent[];

  const sse = (type: string, properties: Record<string, unknown>) =>
    client.emit('sse', { payload: { type, properties } });
  type TimelineEvt = { source: 'timeline'; entry: { type: string; raw: string; startedAt?: number; endedAt?: number }; upsert?: boolean };
  const timelineEvents = (type?: string) =>
    (events.filter((e) => e.source === 'timeline') as unknown as TimelineEvt[])
      .filter((e) => !type || e.entry.type === type);

  beforeEach(() => {
    adapter = new OpenCodeAdapter();
    client = new EventEmitter();
    (adapter as unknown as { client: EventEmitter }).client = client;
    (adapter as unknown as { wireSSEEvents(): void }).wireSSEEvents();
    (adapter as unknown as { activeSessionID: string }).activeSessionID = 'ses_test';
    events = [];
    adapter.on('event', (e: AdapterEvent) => events.push(e));
  });

  it('upserts the user prompt into chat_start when the user message carries text', () => {
    sse('message.updated', {
      info: { id: 'msg_u1', role: 'user', sessionID: 'ses_test', time: { created: 1 }, text: 'fix the login bug' },
    });

    const starts = timelineEvents('chat_start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
    const upsert = starts.find((e) => e.upsert);
    expect(upsert?.entry.raw).toBe('fix the login bug');
  });

  it('routes user text parts to the prompt, not the response', () => {
    sse('message.updated', {
      info: { id: 'msg_u1', role: 'user', sessionID: 'ses_test', time: { created: 1 } },
    });
    sse('message.part.updated', {
      part: { type: 'text', text: 'refactor the parser', sessionID: 'ses_test', messageID: 'msg_u1', id: 'p1' },
    });
    sse('message.part.updated', {
      part: { type: 'text', text: 'Done — parser refactored into three passes and covered by tests.', sessionID: 'ses_test', messageID: 'msg_a1', id: 'p2' },
    });
    sse('session.idle', { sessionID: 'ses_test' });

    const upsert = timelineEvents('chat_start').find((e) => e.upsert);
    expect(upsert?.entry.raw).toBe('refactor the parser');
    const responses = timelineEvents('chat_response');
    expect(responses).toHaveLength(1);
    expect(responses[0].entry.raw).toContain('parser refactored');
    // Echo guard: the user's own words never become the response row.
    expect(responses[0].entry.raw).not.toBe('refactor the parser');
  });

  it('emits chat_response XOR chat_end — response turns produce no chat_end', () => {
    sse('message.part.delta', { delta: 'This is a meaningful model response.' });
    sse('session.idle', { sessionID: 'ses_test' });

    expect(timelineEvents('chat_response')).toHaveLength(1);
    expect(timelineEvents('chat_end')).toHaveLength(0);
    const resp = timelineEvents('chat_response')[0].entry;
    expect(resp.startedAt).toBeTypeOf('number');
    expect(resp.endedAt).toBeTypeOf('number');
  });

  it('closes response-less (tool-only) turns with chat_end', () => {
    sse('message.part.updated', {
      part: { type: 'tool', tool: 'bash', sessionID: 'ses_test', messageID: 'msg_a1', id: 'p1', state: { status: 'running' } },
    });
    sse('session.idle', { sessionID: 'ses_test' });

    expect(timelineEvents('chat_response')).toHaveLength(0);
    expect(timelineEvents('chat_end')).toHaveLength(1);
    expect(timelineEvents('chat_end')[0].entry.raw).toContain('tools');
  });

  it('resets prompt/response state between turns', () => {
    sse('message.updated', {
      info: { id: 'msg_u1', role: 'user', sessionID: 'ses_test', time: { created: 1 }, text: 'first ask' },
    });
    sse('message.part.delta', { delta: 'First answer with enough length.' });
    sse('session.idle', { sessionID: 'ses_test' });

    sse('message.updated', {
      info: { id: 'msg_u2', role: 'user', sessionID: 'ses_test', time: { created: 2 }, text: 'second ask' },
    });
    sse('message.part.delta', { delta: 'Second answer with enough length.' });
    sse('session.idle', { sessionID: 'ses_test' });

    const responses = timelineEvents('chat_response');
    expect(responses).toHaveLength(2);
    expect(responses[0].entry.raw).toContain('First answer');
    expect(responses[1].entry.raw).toContain('Second answer');
    const upserts = timelineEvents('chat_start').filter((e) => e.upsert);
    expect(upserts.map((e) => e.entry.raw)).toEqual(['first ask', 'second ask']);
  });
});
