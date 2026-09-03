import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';

// A daemon restart drops the in-memory session→run map that `closeRun` depends
// on, so every run that was mid-session is left with `ended_at` NULL forever.
// The pre-existing `listOrphanedRuns` only matches empty shells (no prompt, no
// turns), so those runs — which carry the actual work — were invisible to it,
// and because their TASK never closed they were never evaluated (the live store
// had accumulated 65 open tasks against 9 closed ones).

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-reaper-'));
  const store = new ApmeStore(join(dir, 'apme.sqlite'));
  const ok = await store.init();
  if (!ok) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('APME store failed to initialize — is better-sqlite3 installed?');
  }
  (store as unknown as { _tmpDir: string })._tmpDir = dir;
  return store;
}

function cleanup(store: ApmeStore) {
  store.close();
  const dir = (store as unknown as { _tmpDir?: string })._tmpDir;
  if (dir) rmSync(dir, { recursive: true, force: true });
}

const HOUR = 3_600_000;

/** A run left open mid-work, with `lastActivity` ms ago. */
function seedAbandoned(store: ApmeStore, id: string, agoMs: number): number {
  const lastActivity = Date.now() - agoMs;
  store.insertRun({ id, sessionId: `s-${id}`, agentType: 'claude-code', startedAt: lastActivity - 60_000, taskPrompt: 'do the thing' });
  store.insertTask({ id: `task-${id}`, runId: id, taskIndex: 0, boundarySignal: 'open', startedAt: lastActivity - 60_000 });
  store.insertTurn({ id: `turn-${id}`, runId: id, taskId: `task-${id}`, turnIndex: 3, prompt: 'do the thing', startedAt: lastActivity });
  return lastActivity;
}

describe('abandoned APME run reaper', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('finds runs with real work that the empty-shell reaper cannot see', () => {
    seedAbandoned(store, 'run-old', 3 * HOUR);
    // The exact shape listOrphanedRuns targets — must stay ITS job, not ours.
    store.insertRun({ id: 'run-shell', sessionId: 's-shell', agentType: 'claude-code', startedAt: Date.now() - 3 * HOUR });

    expect(store.listOrphanedRuns(1800)).toEqual(['run-shell']);
    expect(store.listAbandonedRuns(7200).map(r => r.id)).toEqual(['run-old']);
  });

  it('measures staleness from last activity, not started_at', () => {
    // Started 5h ago but a turn landed a minute ago: a live long session.
    store.insertRun({ id: 'run-live', sessionId: 's-live', agentType: 'claude-code', startedAt: Date.now() - 5 * HOUR, taskPrompt: 'p' });
    store.insertTask({ id: 'task-live', runId: 'run-live', taskIndex: 0, boundarySignal: 'open', startedAt: Date.now() - 5 * HOUR });
    store.insertTurn({ id: 'turn-live', runId: 'run-live', taskId: 'task-live', turnIndex: 0, prompt: 'p', startedAt: Date.now() - 60_000 });

    expect(store.listAbandonedRuns(7200)).toEqual([]);
  });

  it('counts steps and sample events as activity, not just turns', () => {
    const lastActivity = seedAbandoned(store, 'run-busy', 3 * HOUR);
    // Tool traffic 1 minute ago on a turn that opened 3h back.
    store.insertStep({ runId: 'run-busy', ts: Date.now() - 60_000, kind: 'PostToolUse', toolName: 'Edit', payload: '{}' });
    expect(store.listAbandonedRuns(7200)).toEqual([]);

    store.insertSampleEvent({
      taskId: 'task-run-busy', runId: 'run-busy', turnIndex: 3, seq: 0,
      ts: lastActivity, kind: 'tool', toolName: 'Read', toolStatus: 'success', dedupKey: 'k0',
    });
    // Still fresh — the newest event wins, not the oldest.
    expect(store.listAbandonedRuns(7200)).toEqual([]);
  });

  it('closes turns, tasks and the run at the last activity, not now', () => {
    const lastActivity = seedAbandoned(store, 'run-x', 3 * HOUR);

    const closed = store.reapAbandonedRun('run-x', lastActivity);
    expect(closed).toEqual([{ id: 'task-run-x', category: null, boundarySignal: 'orphaned' }]);

    const run = store.getRun('run-x');
    expect(run?.endedAt).toBe(lastActivity);
    const task = store.getTask('task-run-x');
    expect(task?.endedAt).toBe(lastActivity);
    expect(task?.boundarySignal).toBe('orphaned');
    // Backfilled from the run's real turns so the task rollup has its range.
    expect(task?.firstTurnIndex).toBe(3);
    expect(task?.lastTurnIndex).toBe(3);
    const turn = store.getTurn('turn-run-x');
    expect(turn?.ended_at).toBe(lastActivity);
  });

  it('is idempotent and drops out of the candidate list once reaped', () => {
    const lastActivity = seedAbandoned(store, 'run-y', 3 * HOUR);
    store.reapAbandonedRun('run-y', lastActivity);

    expect(store.listAbandonedRuns(7200)).toEqual([]);
    // A second pass finds nothing left open, so it reports no tasks to judge —
    // the eval queue must not be handed the same task twice.
    expect(store.reapAbandonedRun('run-y', lastActivity + 999)).toEqual([]);
    expect(store.getRun('run-y')?.endedAt).toBe(lastActivity);
  });

  it('leaves reaped runs to the normal eval queue', () => {
    const lastActivity = seedAbandoned(store, 'run-z', 3 * HOUR);
    expect(store.listUnevaluatedRuns(10).map(r => r.id)).not.toContain('run-z');
    store.reapAbandonedRun('run-z', lastActivity);
    expect(store.listUnevaluatedRuns(10).map(r => r.id)).toContain('run-z');
  });

  it('reports a run the collector still owns as live', () => {
    const collector = new ApmeCollector(store);
    const runId = collector.openRun({ sessionId: 'live-session', agentType: 'claude-code' });
    expect(runId).not.toBeNull();
    expect(collector.isLiveRun(runId!)).toBe(true);
    expect(collector.isLiveRun('some-other-run')).toBe(false);
    collector.closeRun('live-session');
    expect(collector.isLiveRun(runId!)).toBe(false);
  });
});

describe('what the reaper says it found', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  // Before 2026-09-03 every reaped task was stamped `orphaned`, which put 79%
  // of a week's tasks in the "reaper" chip and hid that the segmentation had
  // been right: most of them had gone quiet after a cleanly closed turn — the
  // idle-gap boundary, reached late because the timer died with the daemon.

  it('a task whose last turn CLOSED is an idle_gap boundary, not an orphan', () => {
    const lastActivity = seedAbandoned(store, 'run-quiet', 3 * HOUR);
    store.updateTurn('turn-run-quiet', { endedAt: lastActivity, endSource: 'stop' });

    const closed = store.reapAbandonedRun('run-quiet', lastActivity);
    expect(closed).toEqual([{ id: 'task-run-quiet', category: null, boundarySignal: 'idle_gap' }]);
    expect(store.getTask('task-run-quiet')!.boundarySignal).toBe('idle_gap');
    expect(store.listTurns('run-quiet')[0]!.end_source).toBe('stop'); // untouched
  });

  it('a task still holding an OPEN turn is orphaned, and that turn is closed as run_close', () => {
    const lastActivity = seedAbandoned(store, 'run-cut', 3 * HOUR);

    const closed = store.reapAbandonedRun('run-cut', lastActivity);
    expect(closed).toEqual([{ id: 'task-run-cut', category: null, boundarySignal: 'orphaned' }]);
    expect(store.getTask('task-run-cut')!.boundarySignal).toBe('orphaned');
    const [turn] = store.listTurns('run-cut');
    expect(turn!.end_source).toBe('run_close');
    expect(turn!.ended_at).toBe(lastActivity);
  });

  it('classifies each open task on its own turns, in one run', () => {
    const lastActivity = seedAbandoned(store, 'run-mixed', 3 * HOUR);
    store.updateTurn('turn-run-mixed', { endedAt: lastActivity - 1000, endSource: 'stop' });
    store.insertTask({ id: 'task-run-mixed-2', runId: 'run-mixed', taskIndex: 1, boundarySignal: 'open', startedAt: lastActivity });
    store.insertTurn({ id: 'turn-run-mixed-2', runId: 'run-mixed', taskId: 'task-run-mixed-2', turnIndex: 4, prompt: 'cut off', startedAt: lastActivity });

    const closed = store.reapAbandonedRun('run-mixed', lastActivity);
    expect(new Map(closed.map((c) => [c.id, c.boundarySignal]))).toEqual(new Map([
      ['task-run-mixed', 'idle_gap'],
      ['task-run-mixed-2', 'orphaned'],
    ]));
  });
});

describe('reaped tasks keep their run\'s category and old verdicts are re-read on evidence', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('a reaped task inherits the run category it never resolved in memory', () => {
    const lastActivity = seedAbandoned(store, 'run-cat', 3 * HOUR);
    store.updateRun('run-cat', { taskCategory: 'ops' });
    const closed = store.reapAbandonedRun('run-cat', lastActivity);
    expect(closed[0]!.category).toBe('ops');
    expect(store.getTask('task-run-cat')!.taskCategory).toBe('ops');
  });

  it('reclassifyReapedTasks moves only orphaned tasks whose every turn closed with a known signal', () => {
    // Evidence: closed normally → idle_gap.
    const a = seedAbandoned(store, 'run-a', 3 * HOUR);
    store.updateTurn('turn-run-a', { endedAt: a, endSource: 'stop' });
    store.updateTask('task-run-a', { endedAt: a, boundarySignal: 'orphaned' });
    // Cut open by the old reaper → stays orphaned.
    const b = seedAbandoned(store, 'run-b', 3 * HOUR);
    store.updateTurn('turn-run-b', { endedAt: b, endSource: 'run_close' });
    store.updateTask('task-run-b', { endedAt: b, boundarySignal: 'orphaned' });
    // Pre-column row (end_source NULL) → unknown, never guessed.
    const c = seedAbandoned(store, 'run-c', 3 * HOUR);
    store.updateTurn('turn-run-c', { endedAt: c });
    store.updateTask('task-run-c', { endedAt: c, boundarySignal: 'orphaned' });

    expect(store.reclassifyReapedTasks()).toBe(1);
    expect(store.getTask('task-run-a')!.boundarySignal).toBe('idle_gap');
    expect(store.getTask('task-run-b')!.boundarySignal).toBe('orphaned');
    expect(store.getTask('task-run-c')!.boundarySignal).toBe('orphaned');
    expect(store.reclassifyReapedTasks()).toBe(0); // idempotent
  });
});
