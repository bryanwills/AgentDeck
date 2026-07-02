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
