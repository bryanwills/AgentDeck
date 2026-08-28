import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';

// Task naming (deriveTaskTitle at promotion) + the generic idle-gap boundary.
// The idle-gap constant rests on a measurement (see AGENT_IDLE_GAP_MS); these
// tests pin the MECHANISM with an injected small value, not the constant.

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-test-'));
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

const IDLE_MS = 1_000;

function makeCollector(store: ApmeStore): ApmeCollector {
  return new ApmeCollector(store, undefined, undefined, IDLE_MS);
}

describe('task title at promotion', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('onTaskOpened carries the title derived from the first prompt', () => {
    const collector = makeCollector(store);
    const opened: Array<{ title: string | null; taskIndex: number }> = [];
    collector.onTaskOpened = (args) => { opened.push({ title: args.title, taskIndex: args.taskIndex }); };

    collector.openRun({ sessionId: 's1', agentType: 'claude-code', projectName: 'demo' });
    collector.ingestHook('s1', 'UserPromptSubmit', { prompt: 'Fix the flaky payment test' });
    expect(opened.length).toBe(0); // still deferred — single turn so far
    collector.noteTurnStop('s1');
    collector.ingestHook('s1', 'UserPromptSubmit', { prompt: 'now add a regression test' });

    expect(opened.length).toBe(1);
    expect(opened[0]!.title).toBe('Fix the flaky payment test');
  });

  it('a prompt that derives no title promotes with title=null (Task N fallback stays with the consumer)', () => {
    const collector = makeCollector(store);
    const titles: Array<string | null> = [];
    collector.onTaskOpened = (args) => { titles.push(args.title); };

    collector.openRun({ sessionId: 's2', agentType: 'claude-code', projectName: 'demo' });
    collector.ingestHook('s2', 'UserPromptSubmit', { prompt: 'ok' }); // below min length
    collector.noteTurnStop('s2');
    collector.ingestHook('s2', 'UserPromptSubmit', { prompt: 'more' });

    expect(titles).toEqual([null]);
  });
});

describe('generic idle-gap boundary', () => {
  let store!: ApmeStore;
  beforeEach(async () => {
    store = await makeStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup(store);
  });

  it('closes the active task with idle_gap after the gap elapses post-Stop', () => {
    const collector = makeCollector(store);
    const closed: string[] = [];
    collector.onTaskClosed = (args) => { closed.push(args.boundarySignal); };

    const runId = collector.openRun({ sessionId: 's3', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('s3', 'UserPromptSubmit', { prompt: 'do the long thing' });
    collector.noteTurnStop('s3');

    vi.advanceTimersByTime(IDLE_MS + 10);

    expect(closed).toEqual(['idle_gap']);
    const tasks = store.listTasksForRun(runId);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.boundarySignal).toBe('idle_gap');
    expect(tasks[0]!.endedAt).not.toBeNull();
    // The RUN stays open — idle_gap is a task boundary, not a session end.
    expect(store.getRun(runId)?.endedAt).toBeNull();
  });

  it('a new prompt within the gap disarms the timer', () => {
    const collector = makeCollector(store);
    const closed: string[] = [];
    collector.onTaskClosed = (args) => { closed.push(args.boundarySignal); };

    const runId = collector.openRun({ sessionId: 's4', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('s4', 'UserPromptSubmit', { prompt: 'first step of the work' });
    collector.noteTurnStop('s4');
    vi.advanceTimersByTime(IDLE_MS / 2);
    collector.ingestHook('s4', 'UserPromptSubmit', { prompt: 'second step, same task' });

    // Full gap after the second prompt OPENED (turn still running — no Stop):
    // must not fire mid-turn.
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(closed).toEqual([]);
    const tasks = store.listTasksForRun(runId);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.endedAt).toBeNull();
  });

  it('the next prompt after an idle_gap close opens a NEW task in the same run', () => {
    const collector = makeCollector(store);
    const runId = collector.openRun({ sessionId: 's5', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('s5', 'UserPromptSubmit', { prompt: 'the morning task' });
    collector.noteTurnStop('s5');
    vi.advanceTimersByTime(IDLE_MS + 10);

    collector.ingestHook('s5', 'UserPromptSubmit', { prompt: 'the afternoon task' });
    const tasks = store.listTasksForRun(runId);
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.boundarySignal).sort()).toEqual(['idle_gap', 'open']);
  });

  it('work board views: filter, row flag and badges share one definition', () => {
    const collector = makeCollector(store);

    // Task 1 — judged, fully answered: judged bucket, NOT attention.
    const run1 = collector.openRun({ sessionId: 'w1', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('w1', 'UserPromptSubmit', { prompt: 'implement the fold grammar' });
    collector.setTurnResponse('w1', 'done — added foldActionCounts', 'direct');
    collector.noteTurnStop('w1');
    collector.closeRun('w1', 0);
    const judgedTask = store.listTasksForRun(run1)[0]!;
    store.updateTask(judgedTask.id, { compositeScore: 0.9 });

    // Task 2 — closed with an unarchived reply: reported AND attention.
    collector.openRun({ sessionId: 'w2', agentType: 'codex-cli', projectName: 'demo' });
    collector.ingestHook('w2', 'UserPromptSubmit', { prompt: 'port the layout to the fork' });
    collector.noteTurnStop('w2');
    collector.closeRun('w2', 0);

    // Task 3 — reaper-closed: orphaned AND attention.
    const run3 = collector.openRun({ sessionId: 'w3', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('w3', 'UserPromptSubmit', { prompt: 'investigate the flap' });
    collector.setTurnResponse('w3', 'looked at it', 'direct');
    collector.noteTurnStop('w3');
    collector.closeRun('w3', 0);
    const orphanTask = store.listTasksForRun(run3)[0]!;
    store.updateTask(orphanTask.id, { boundarySignal: 'orphaned' });

    // Task 4 — still open: inprogress, NOT attention.
    collector.openRun({ sessionId: 'w4', agentType: 'claude-code', projectName: 'demo' });
    collector.ingestHook('w4', 'UserPromptSubmit', { prompt: 'the still-running work' });

    const counts = store.taskViewCounts();
    expect(counts.all).toBe(4);
    expect(counts.inprogress).toBe(1);
    expect(counts.judged).toBe(1);
    expect(counts.orphaned).toBe(1);
    // Attention = task 2 (unarchived reply) + task 3 (orphaned).
    expect(counts.attention).toBe(2);
    // Reported = closed without a score: tasks 2 and 3.
    expect(counts.reported).toBe(2);

    // Filter and flag agree with the badge.
    const attention = store.listTaskPage({ view: 'attention' });
    expect(attention.total).toBe(counts.attention);
    expect(attention.tasks.every((t) => t.attention)).toBe(true);

    // Default listing keeps pure recency — the pre-existing contract the
    // graph/activity consumers assume; attention-first is opt-in.
    const recency = store.listTaskPage({});
    const startedAts = recency.tasks.map((t) => t.startedAt);
    expect([...startedAts].sort((a, b) => b - a)).toEqual(startedAts);

    const ordered = store.listTaskPage({ order: 'attention' });
    expect(ordered.tasks.slice(0, counts.attention).every((t) => t.attention)).toBe(true);
    expect(ordered.tasks.slice(counts.attention).every((t) => !t.attention)).toBe(true);
  });

  it('session_end within the gap wins — no double close', () => {
    const collector = makeCollector(store);
    const closed: string[] = [];
    collector.onTaskClosed = (args) => { closed.push(args.boundarySignal); };

    const runId = collector.openRun({ sessionId: 's6', agentType: 'claude-code', projectName: 'demo' })!;
    collector.ingestHook('s6', 'UserPromptSubmit', { prompt: 'wrap up the branch' });
    collector.noteTurnStop('s6');
    collector.closeRun('s6', 0);

    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(closed).toEqual(['session_end']);
    const tasks = store.listTasksForRun(runId);
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.boundarySignal).toBe('session_end');
  });
});
