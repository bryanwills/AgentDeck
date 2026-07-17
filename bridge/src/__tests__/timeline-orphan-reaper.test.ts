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

  it('anchors the synthetic end after the task\'s last row with an approx duration', () => {
    const store = new BridgeTimelineStore();
    store.loadPersistedEntries([
      { ts: 1000, type: 'task_start', raw: 'Task 1', taskId: 't1', sessionId: 'sess', startedAt: 1000 },
      { ts: 2000, type: 'chat_start', raw: '질문', taskId: 't1', sessionId: 'sess' },
      { ts: 130_000, type: 'chat_response', raw: '답변', taskId: 't1', sessionId: 'sess' },
    ]);

    expect(store.reapOrphanTaskStarts()).toBe(1);

    const synthetic = store.getHistory().find((e) => e.type === 'task_end' && e.taskId === 't1');
    expect(synthetic).toBeDefined();
    // Sorts BELOW the turns it closes (was task_start+1ms, which rendered the
    // TASK END header above every turn of the task).
    expect(synthetic!.ts).toBe(130_001);
    expect(synthetic!.endedAt).toBe(130_000);
    // (130000-1000)/1000 = 129s → "2m 9s", approximate-marked.
    expect(synthetic!.raw).toBe('Interrupted · ~2m 9s');
  });

  it('closes stale orphaned chat_start rows without touching live or completed turns', () => {
    const store = new BridgeTimelineStore();
    const now = 100 * 60_000; // t=100min
    store.loadPersistedEntries([
      // Turn killed mid-flight (no completion, 90min old) → reap.
      { ts: 10 * 60_000, type: 'chat_start', raw: '/merge', sessionId: 'dead', taskId: 't1', startedAt: 10 * 60_000 },
      { ts: 12 * 60_000, type: 'tool_exec', raw: 'Bash: git merge', sessionId: 'dead' },
      // Completed turn → untouched.
      { ts: 20 * 60_000, type: 'chat_start', raw: '질문', sessionId: 'done' },
      { ts: 21 * 60_000, type: 'chat_response', raw: '답변', sessionId: 'done' },
      // Fresh open turn (5min old) → untouched, its Stop may still arrive.
      { ts: 95 * 60_000, type: 'chat_start', raw: '작업중', sessionId: 'live' },
    ]);

    expect(store.reapOrphanChatStarts(30 * 60_000, now)).toBe(1);

    const ends = store.getHistory().filter((e) => e.type === 'chat_end');
    expect(ends.length).toBe(1);
    expect(ends[0].sessionId).toBe('dead');
    expect(ends[0].summaryKind).toBe('none');
    expect(ends[0].taskId).toBe('t1');
    // Anchored right after the turn's last row (the tool_exec at 12min).
    expect(ends[0].ts).toBe(12 * 60_000 + 1);
    expect(ends[0].raw).toBe('Interrupted · ~2m');

    // Idempotent.
    expect(store.reapOrphanChatStarts(30 * 60_000, now)).toBe(0);
  });

  it('anchors the synthetic chat_end before the session\'s next chat_start', () => {
    const store = new BridgeTimelineStore();
    const now = 100 * 60_000;
    store.loadPersistedEntries([
      // Orphaned turn, then a NEWER open turn in the same session — the
      // synthetic close must sort before the newer prompt or it would stop
      // that (possibly live) turn's spinner too.
      { ts: 10 * 60_000, type: 'chat_start', raw: '첫 턴', sessionId: 's' },
      { ts: 95 * 60_000, type: 'chat_start', raw: '새 턴', sessionId: 's' },
    ]);

    expect(store.reapOrphanChatStarts(30 * 60_000, now)).toBe(1);
    const end = store.getHistory().find((e) => e.type === 'chat_end');
    expect(end!.ts).toBeLessThan(95 * 60_000);
    expect(end!.ts).toBeGreaterThan(10 * 60_000);
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
