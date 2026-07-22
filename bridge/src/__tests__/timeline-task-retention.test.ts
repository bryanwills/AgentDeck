import { describe, it, expect } from 'vitest';
import { BridgeTimelineStore } from '../timeline-store.js';
import type { TimelineEntry } from '../types.js';

/**
 * Task hierarchy rows must survive the 200-entry FIFO and the per-session
 * history window — a long task's `task_start` scrolling away mid-task leaves
 * its eventual `task_end` rendering as an unpaired orphan.
 */

let tsCounter = 1_000_000_000_000;
function entry(partial: Partial<TimelineEntry> & { type: TimelineEntry['type'] }): TimelineEntry {
  tsCounter += 10_000; // beyond every dedup window
  return { ts: tsCounter, raw: `row-${tsCounter}`, ...partial } as TimelineEntry;
}

describe('BridgeTimelineStore task-row retention', () => {
  it('keeps an in-flight task_start alive through FIFO overflow', () => {
    const store = new BridgeTimelineStore();
    store.addEntry(entry({ type: 'task_start', taskId: 'T1', raw: 'Task 1' }));
    for (let i = 0; i < 400; i++) {
      store.addEntry(entry({ type: 'chat_response', raw: `turn ${i}` }));
    }
    const history = store.getHistory();
    expect(history.length).toBeLessThanOrEqual(200);
    expect(history.some((e) => e.type === 'task_start' && e.taskId === 'T1')).toBe(true);
  });

  it('evicts closed task pairs once the task cap is exceeded, oldest first', () => {
    const store = new BridgeTimelineStore();
    // 40 closed pairs = 80 task rows > MAX_TASK_ENTRIES(60).
    for (let i = 0; i < 40; i++) {
      store.addEntry(entry({ type: 'task_start', taskId: `T${i}`, raw: `Task ${i}` }));
      store.addEntry(entry({ type: 'task_end', taskId: `T${i}`, raw: 'Session end · 1s' }));
    }
    // Overflow the generic cap with chat rows so eviction has to run.
    for (let i = 0; i < 250; i++) {
      store.addEntry(entry({ type: 'chat_response', raw: `turn ${i}` }));
    }
    const history = store.getHistory();
    expect(history.length).toBeLessThanOrEqual(200);
    // Newest closed pairs survive; the oldest were evicted under the task cap.
    expect(history.some((e) => e.taskId === 'T39')).toBe(true);
    expect(history.some((e) => e.taskId === 'T0')).toBe(false);
  });

  it('sheds tool_exec before chat_start so a tool-heavy turn survives replay', () => {
    const store = new BridgeTimelineStore();
    // The turn skeleton we must keep — chat_start is the oldest ts in its turn.
    store.addEntry(entry({ type: 'chat_start', sessionId: 's1', raw: 'do a lot of work' }));
    // A PTY `agentdeck claude` session emits a claude-code `tool_exec` for every
    // tool action when the hook lags (index.ts:1552). Only *codex* tool_exec is
    // dropped at storage, so these pass the filter and overflow the 200 cap.
    for (let i = 0; i < 250; i++) {
      store.addEntry(entry({ type: 'tool_exec', agentType: 'claude-code', sessionId: 's1', raw: `Edit file-${i}.ts` }));
    }
    store.addEntry(entry({ type: 'chat_response', sessionId: 's1', raw: 'Done.' }));
    const history = store.getHistory();
    expect(history.length).toBeLessThanOrEqual(200);
    // Undifferentiated FIFO would have evicted the oldest row — the chat_start —
    // orphaning its response on `timeline_history` replay. Tiered eviction sheds
    // the tool_exec first, so the turn skeleton survives.
    expect(history.some((e) => e.type === 'chat_start' && e.raw === 'do a lot of work')).toBe(true);
    expect(history.some((e) => e.type === 'chat_response' && e.raw === 'Done.')).toBe(true);
    expect(history.some((e) => e.type === 'tool_exec')).toBe(true); // some tool rows still fit
  });

  it('getHistoryForSession returns task rows beyond the per-session limit', () => {
    const store = new BridgeTimelineStore();
    store.addEntry(entry({ type: 'task_start', taskId: 'T1', sessionId: 's1', raw: 'Task 1' }));
    for (let i = 0; i < 30; i++) {
      store.addEntry(entry({ type: 'chat_response', sessionId: 's1', raw: `turn ${i}` }));
    }
    store.addEntry(entry({ type: 'task_end', taskId: 'T1', sessionId: 's1', raw: '/clear · 9s' }));
    const history = store.getHistoryForSession('s1', undefined, 16);
    // 16 chat rows + both task rows, sorted by ts.
    expect(history.filter((e) => e.type === 'task_start')).toHaveLength(1);
    expect(history.filter((e) => e.type === 'task_end')).toHaveLength(1);
    expect(history[0].type).toBe('task_start');
    expect(history[history.length - 1].type).toBe('task_end');
  });

  it('getHistoryForSession canonicalizes observed session ids', () => {
    const store = new BridgeTimelineStore();
    store.addEntry(entry({ type: 'chat_start', sessionId: 'session-uuid', raw: 'start' }));

    for (const provider of ['claude', 'codex', 'codex-app', 'opencode', 'antigravity']) {
      expect(store.getHistoryForSession(`observed:${provider}:session-uuid`))
        .toHaveLength(1);
    }
    expect(store.getHistoryForSession('observed:codex:other-uuid')).toHaveLength(0);
  });

  it('loadPersistedEntries keeps task rows past the generic trim', () => {
    const store = new BridgeTimelineStore();
    const rows: TimelineEntry[] = [];
    rows.push(entry({ type: 'task_start', taskId: 'T1', raw: 'Task 1' }));
    for (let i = 0; i < 300; i++) rows.push(entry({ type: 'chat_response', raw: `turn ${i}` }));
    rows.push(entry({ type: 'task_end', taskId: 'T1', raw: 'Session end · 5s' }));
    store.loadPersistedEntries(rows as unknown[]);
    const history = store.getHistory();
    expect(history.length).toBeLessThanOrEqual(200);
    expect(history.some((e) => e.type === 'task_start' && e.taskId === 'T1')).toBe(true);
    expect(history.some((e) => e.type === 'task_end' && e.taskId === 'T1')).toBe(true);
  });
});
