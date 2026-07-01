/**
 * Node mirror of the Swift daemon's orphan task reaper
 * (DaemonServer.computeOrphanTaskEnds). A daemon killed mid-task leaves
 * `task_start` rows with no `task_end`; clients treat those as in-flight
 * and spin the task marker forever. `reapOrphanTaskStarts` closes them
 * with a synthetic "Interrupted · –" row at startup.
 */
import { describe, it, expect } from 'vitest';
import { BridgeTimelineStore } from '../timeline-store.js';

describe('BridgeTimelineStore.reapOrphanTaskStarts', () => {
  it('synthesizes task_end for orphaned task_start rows only', () => {
    const store = new BridgeTimelineStore();
    store.loadPersistedEntries([
      { ts: 1000, type: 'task_start', raw: 'Task 1', taskId: 't1', sessionId: 'sess', agentType: 'claude-code', startedAt: 1000 },
      { ts: 2000, type: 'task_start', raw: 'Task 2', taskId: 't2' },
      { ts: 3000, type: 'task_end', raw: 'Session end · 5s', taskId: 't2' },
      { ts: 4000, type: 'task_start', raw: 'Task no id' }, // no taskId → skipped
    ]);

    expect(store.reapOrphanTaskStarts()).toBe(1);

    const ends = store.getHistory().filter((e) => e.type === 'task_end');
    expect(ends.length).toBe(2);
    const synthetic = ends.find((e) => e.taskId === 't1');
    expect(synthetic).toBeDefined();
    expect(synthetic!.raw).toBe('Interrupted · –');
    expect(synthetic!.boundarySignal).toBe('interrupted');
    expect(synthetic!.ts).toBe(1001);
    expect(synthetic!.startedAt).toBe(1000);
    expect(synthetic!.endedAt).toBeUndefined();
    expect(synthetic!.sessionId).toBe('sess');

    // Idempotent — a second pass finds every task closed.
    expect(store.reapOrphanTaskStarts()).toBe(0);
  });

  it('lets a real task_end merge over the synthetic by taskId', () => {
    const store = new BridgeTimelineStore();
    store.loadPersistedEntries([
      { ts: 1000, type: 'task_start', raw: 'Task 1', taskId: 't1' },
    ]);
    store.reapOrphanTaskStarts();

    store.addEntry({ ts: 5000, type: 'task_end', raw: '/clear · 12s', taskId: 't1', boundarySignal: 'clear' });

    const t1Ends = store.getHistory().filter((e) => e.type === 'task_end' && e.taskId === 't1');
    expect(t1Ends.length).toBe(1);
    expect(t1Ends[0].raw).toBe('/clear · 12s');
    expect(t1Ends[0].boundarySignal).toBe('clear');
  });
});
