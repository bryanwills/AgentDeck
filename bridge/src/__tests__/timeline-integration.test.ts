/**
 * Integration test: Timeline pipeline — store, dedup, upsert, broadcast.
 *
 * Tests the BridgeTimelineStore with deduplication, event listeners,
 * and the full enrichment pipeline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BridgeTimelineStore } from '../timeline-store.js';
import type { TimelineEntry } from '../types.js';
import { deduplicateEntry } from '@agentdeck/shared';

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    ts: Date.now() / 1000,
    type: 'tool_request',
    raw: 'Read /src/index.ts',
    ...overrides,
  };
}

// ─── BridgeTimelineStore ────────────────────────────────────────────

describe('BridgeTimelineStore', () => {
  let store: BridgeTimelineStore;

  beforeEach(() => {
    store = new BridgeTimelineStore();
  });

  it('adds and retrieves entries', () => {
    store.addEntry(makeEntry({ ts: 100, raw: 'Read /foo.ts' }));
    store.addEntry(makeEntry({ ts: 200, raw: 'Edit /bar.ts' }));

    const history = store.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].ts).toBe(100);
    expect(history[1].ts).toBe(200);
  });

  it('filters history by timestamp', () => {
    store.addEntry(makeEntry({ ts: 100, raw: 'Read /a.ts' }));
    store.addEntry(makeEntry({ ts: 200, raw: 'Edit /b.ts' }));
    store.addEntry(makeEntry({ ts: 300, raw: 'Write /c.ts' }));

    const since = store.getHistory(150);
    expect(since).toHaveLength(2);
    expect(since[0].ts).toBe(200);
  });

  it('calls listeners on new entries', () => {
    const received: Array<{ entry: TimelineEntry; upsert?: boolean }> = [];
    store.onEntry((entry, upsert) => received.push({ entry, upsert }));

    store.addEntry(makeEntry({ ts: 100 }));
    expect(received).toHaveLength(1);
    expect(received[0].upsert).toBeUndefined();
  });

  it('upsert updates existing entry with same ts+type', () => {
    store.addEntry(makeEntry({ ts: 100, type: 'chat_end', raw: 'Original' }));

    const received: Array<{ entry: TimelineEntry; upsert?: boolean }> = [];
    store.onEntry((entry, upsert) => received.push({ entry, upsert }));

    store.upsertEntry(makeEntry({ ts: 100, type: 'chat_end', raw: 'Updated', detail: 'LLM summary' }));

    // Should update in place
    const history = store.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].raw).toBe('Updated');
    expect(history[0].detail).toBe('LLM summary');

    // Listener called with upsert=true
    expect(received).toHaveLength(1);
    expect(received[0].upsert).toBe(true);
  });

  it('upsert adds new entry when no match exists', () => {
    store.addEntry(makeEntry({ ts: 100, type: 'tool_request' }));
    store.upsertEntry(makeEntry({ ts: 200, type: 'chat_end', raw: 'New entry' }));

    expect(store.getHistory()).toHaveLength(2);
  });

  it('updateEntryStatus updates approval status', () => {
    store.addEntry(makeEntry({ ts: 100, type: 'tool_request', approvalId: 'abc-123', status: 'pending' }));

    store.updateEntryStatus('abc-123', 'approved');

    const history = store.getHistory();
    expect(history[0].status).toBe('approved');
  });

  it('getLastEntry returns most recent of given type', () => {
    store.addEntry(makeEntry({ ts: 100, type: 'tool_request', raw: 'First' }));
    store.addEntry(makeEntry({ ts: 200, type: 'chat_end', raw: 'Middle' }));
    store.addEntry(makeEntry({ ts: 300, type: 'tool_request', raw: 'Latest' }));

    const last = store.getLastEntry('tool_request');
    expect(last).not.toBeNull();
    expect(last!.raw).toBe('Latest');
  });

  it('getLastEntry returns null when type not found', () => {
    store.addEntry(makeEntry({ type: 'tool_request' }));
    expect(store.getLastEntry('chat_end')).toBeNull();
  });

  it('removeListener stops notifications', () => {
    let count = 0;
    const cb = () => { count++; };

    store.onEntry(cb);
    store.addEntry(makeEntry({ ts: 100 }));
    expect(count).toBe(1);

    store.removeListener(cb);
    store.addEntry(makeEntry({ ts: 200 }));
    expect(count).toBe(1); // No additional call
  });

  it('enforces MAX_ENTRIES (200) with FIFO', () => {
    for (let i = 0; i < 210; i++) {
      store.addEntry(makeEntry({ ts: i, raw: `Entry ${i}` }));
    }

    const history = store.getHistory();
    expect(history.length).toBeLessThanOrEqual(200);
    // Oldest entries should be trimmed
    expect(history[0].ts).toBeGreaterThanOrEqual(10);
  });
});

// ─── Deduplication pipeline ─────────────────────────────────────────

describe('deduplicateEntry pipeline', () => {
  it('exact duplicate within 5s → skip', () => {
    const now = Date.now() / 1000;
    const entries = [makeEntry({ ts: now, type: 'tool_request', raw: 'Read /foo.ts' })];

    const result = deduplicateEntry(
      makeEntry({ ts: now + 2, type: 'tool_request', raw: 'Read /foo.ts' }),
      entries,
    );

    expect(result.action).toBe('skip');
  });

  it('same type, different content → add', () => {
    const now = Date.now() / 1000;
    const entries = [makeEntry({ ts: now, type: 'tool_request', raw: 'Read /foo.ts' })];

    const result = deduplicateEntry(
      makeEntry({ ts: now + 10, type: 'tool_request', raw: 'Read /bar.ts' }),
      entries,
    );

    expect(result.action).toBe('add');
  });

  it('different type, same raw → add', () => {
    const now = Date.now() / 1000;
    const entries = [makeEntry({ ts: now, type: 'tool_request', raw: 'test' })];

    const result = deduplicateEntry(
      makeEntry({ ts: now + 1, type: 'chat_end', raw: 'test' }),
      entries,
    );

    expect(result.action).toBe('add');
  });
});

// ─── Timeline + WS broadcast integration ────────────────────────────

describe('Timeline → WS broadcast pipeline', () => {
  it('store entries trigger broadcast via listener', () => {
    const store = new BridgeTimelineStore();
    const broadcasted: TimelineEntry[] = [];

    // Simulate WS broadcast hook
    store.onEntry((entry) => {
      broadcasted.push(entry);
    });

    store.addEntry(makeEntry({ ts: 100, raw: 'Event 1' }));
    store.addEntry(makeEntry({ ts: 200, raw: 'Event 2' }));

    expect(broadcasted).toHaveLength(2);
    expect(broadcasted[0].raw).toBe('Event 1');
    expect(broadcasted[1].raw).toBe('Event 2');
  });

  it('upsert entries broadcast with upsert flag', () => {
    const store = new BridgeTimelineStore();
    const broadcasted: Array<{ entry: TimelineEntry; upsert?: boolean }> = [];

    store.addEntry(makeEntry({ ts: 100, type: 'chat_end', raw: 'Original' }));

    store.onEntry((entry, upsert) => broadcasted.push({ entry, upsert }));

    store.upsertEntry(makeEntry({ ts: 100, type: 'chat_end', raw: 'Updated' }));

    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0].upsert).toBe(true);
    expect(broadcasted[0].entry.raw).toBe('Updated');
  });

  it('exact duplicate within 5s is skipped by store', () => {
    const store = new BridgeTimelineStore();
    const now = Date.now() / 1000;

    store.addEntry(makeEntry({ ts: now, type: 'tool_request', raw: 'Read /foo.ts' }));
    store.addEntry(makeEntry({ ts: now + 2, type: 'tool_request', raw: 'Read /foo.ts' }));

    const history = store.getHistory();
    expect(history).toHaveLength(1); // Second was deduped
  });

  it('different content within 5s is NOT deduped', () => {
    const store = new BridgeTimelineStore();
    const now = Date.now() / 1000;

    store.addEntry(makeEntry({ ts: now, type: 'tool_request', raw: 'Read /foo.ts' }));
    store.addEntry(makeEntry({ ts: now + 2, type: 'tool_request', raw: 'Edit /bar.ts' }));

    const history = store.getHistory();
    expect(history).toHaveLength(2); // Different content, both kept
  });
});

// ─── Entry type coverage ────────────────────────────────────────────

describe('TimelineEntry types', () => {
  const validTypes = [
    'tool_request', 'tool_resolved', 'chat_start', 'chat_end',
    'chat_response', 'error', 'scheduled', 'user_action',
    'model_call', 'model_response', 'memory_recall', 'tool_exec',
  ];

  it('common entry types have expected shape', () => {
    for (const type of validTypes) {
      const entry = makeEntry({ type: type as any, raw: `Test ${type}` });
      expect(entry.type).toBe(type);
      expect(typeof entry.ts).toBe('number');
      expect(typeof entry.raw).toBe('string');
    }
  });

  it('entries with status field', () => {
    const entry = makeEntry({
      type: 'tool_request',
      raw: 'Edit /src/main.ts',
      status: 'pending',
      approvalId: 'req-456',
    });

    expect(entry.status).toBe('pending');
    expect(entry.approvalId).toBe('req-456');
  });

  it('entries with detail field', () => {
    const entry = makeEntry({
      type: 'chat_end',
      raw: 'Completed task · 5 tools · 2m',
      detail: '파일 3개를 수정하여 버그를 수정했습니다',
    });

    expect(typeof entry.detail).toBe('string');
    expect(entry.detail!.length).toBeGreaterThan(0);
  });

  it('entries with automated flag', () => {
    const entry = makeEntry({
      type: 'chat_start',
      raw: '자동 작업',
      automated: true,
    });

    expect(entry.automated).toBe(true);
  });
});
