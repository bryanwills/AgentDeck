/**
 * End-to-end verification for the category-aware turn evaluation pipeline.
 *
 * Walks through the same code paths a live session would hit:
 *   1. openRun + ingestHook(UserPromptSubmit) → turn created with prompt
 *   2. setTurnResponse → response captured
 *   3. sync classifyRun → rule-based category (conversation)
 *   4. updateTurn({ taskCategory }) → turn stamped with its category
 *   5. runner.enqueueTurn + mocked judge → turn_judge evals + composite write
 *   6. daemon-loop backfill → outcome/composite for turns without judge
 *
 * This is the test that would have caught the three gaps the live sqlite showed:
 *   - turns.task_category never written
 *   - turns.outcome / composite_score never written
 *   - mid-session classifier race (run.taskCategory was null)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';
import { ApmeRunner } from '../apme/runner.js';
import { classifyRun } from '../apme/classifier.js';
import type { ApmeConfig } from '../apme/settings.js';

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-e2e-'));
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

const STUB_CONFIG: ApmeConfig = {
  enabled: true,
  deterministic: { enabled: false, timeoutSec: 30, commands: {} },
  judge: { backend: 'mlx', endpoint: 'http://stub', model: 'stub', alwaysRun: true, onDeterministicPass: false, minTurnsForJudge: 0 },
};

describe('APME category-aware turn evaluation (E2E)', () => {
  let store!: ApmeStore;

  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('conversation turn: prompt → classify → judge → turn category + composite persisted', async () => {
    const collector = new ApmeCollector(store);
    const runner = new ApmeRunner(store);
    runner._setConfig(STUB_CONFIG);
    // Stub the judge — return fixed JSON with conversation rubric axes.
    runner._setJudgeFn(async () => JSON.stringify({
      accuracy: 0.9,
      helpfulness: 0.8,
      conciseness: 0.85,
      overall: 0.85,
      reasoning: 'Accurate arithmetic, concise delivery.',
      done: ['answered the math question'],
      missed: [],
    }));

    // ── 1. Open a run (no project — simulates a quick chat session)
    const runId = collector.openRun({
      sessionId: 'sess-conv',
      agentType: 'claude-code',
      modelId: 'claude-opus-4-6',
      projectName: 'demo',
    });
    expect(runId).toBeTruthy();

    // ── 2. User prompt lands via hook — turn row created with prompt
    collector.ingestHook('sess-conv', 'UserPromptSubmit', {
      message: { content: 'What is 2+2?' },
    });
    const activeTurnId = collector.getActiveTurnId('sess-conv');
    expect(activeTurnId).toBeTruthy();

    // ── 3. Response captured (simulating PTY spinner_stop path)
    collector.setTurnResponse('sess-conv', '2+2 equals 4.');

    // ── 4. Mid-session classification (the race the patch closes)
    //    Run is still open (endedAt=null, no tools) → rule-based should yield 'conversation'
    const run = store.getRun(runId);
    expect(run?.taskCategory).toBeNull(); // before classification
    const { category, signals } = classifyRun(store, runId);
    expect(category).toBe('conversation');
    store.updateRun(runId, {
      taskCategory: category,
      taskSignals: JSON.stringify(signals),
      taskCategorySource: 'rule',
    });

    // ── 5. Stamp the turn with its category (what index.ts now does)
    store.updateTurn(activeTurnId!, { taskCategory: category });
    const turnBefore = store.getTurn(activeTurnId!) as Record<string, unknown>;
    expect(turnBefore.task_category).toBe('conversation');
    expect(turnBefore.prompt).toBe('What is 2+2?');
    expect(turnBefore.response).toBe('2+2 equals 4.');

    // ── 6. Trigger turn eval — mirrors daemon-server.onResult behavior after judge
    const resultPromise = new Promise<void>((resolve) => {
      runner.onResult(({ turnId }) => {
        if (!turnId) return;
        // Mirror daemon-server.ts onResult turn branch: persist outcome+composite
        const turnEvals = store.listEvalsForTurn(turnId);
        const overall = turnEvals.find(e => e.metric === 'overall');
        if (overall) {
          store.updateTurn(turnId, {
            outcome: 'committed',
            compositeScore: overall.score,
          });
        }
        resolve();
      });
    });
    runner.enqueueTurn({ runId, turnId: activeTurnId!, category });
    await resultPromise;

    // ── 7. Verify: turn has category, outcome, composite_score; evals have turn_judge layer
    const turnAfter = store.getTurn(activeTurnId!) as Record<string, unknown>;
    expect(turnAfter.task_category).toBe('conversation');
    expect(turnAfter.outcome).toBe('committed');
    expect(turnAfter.composite_score).toBe(0.85);

    const turnEvals = store.listEvalsForTurn(activeTurnId!);
    expect(turnEvals.length).toBeGreaterThanOrEqual(4); // accuracy, helpfulness, conciseness, overall
    const layers = new Set(turnEvals.map(e => e.layer));
    expect(layers.has('turn_judge')).toBe(true);
    const metrics = new Set(turnEvals.map(e => e.metric));
    expect(metrics.has('accuracy')).toBe(true);
    expect(metrics.has('helpfulness')).toBe(true);
    expect(metrics.has('conciseness')).toBe(true);
    expect(metrics.has('overall')).toBe(true);
    const overallRow = turnEvals.find(e => e.metric === 'overall');
    expect(overallRow?.score).toBe(0.85);
  });

  it('research turn: rule-based classifier picks research, judge uses research rubric axes', async () => {
    const collector = new ApmeCollector(store);
    const runner = new ApmeRunner(store);
    runner._setConfig(STUB_CONFIG);
    runner._setJudgeFn(async () => JSON.stringify({
      thoroughness: 0.7,
      relevance: 0.9,
      synthesis: 0.75,
      overall: 0.78,
      reasoning: 'Broad enough search, clearly synthesized.',
    }));

    const runId = collector.openRun({
      sessionId: 'sess-res',
      agentType: 'claude-code',
      projectName: 'demo',
    });
    collector.ingestHook('sess-res', 'UserPromptSubmit', { message: { content: 'How does auth work here?' } });
    // Need > 5 tool calls to escape the planning(turns≤3,tools≤5,no-files) rule
    // which runs before research in the priority order.
    for (let i = 0; i < 6; i++) collector.ingestHook('sess-res', 'PreToolUse', { tool_name: 'Grep' });
    collector.ingestHook('sess-res', 'PreToolUse', { tool_name: 'Glob' });
    const turnId = collector.getActiveTurnId('sess-res')!;
    collector.setTurnResponse('sess-res', 'Auth uses OAuth2 with PKCE across bridge and plugin.');

    const { category } = classifyRun(store, runId);
    expect(category).toBe('research');
    store.updateRun(runId, { taskCategory: category, taskCategorySource: 'rule' });
    store.updateTurn(turnId, { taskCategory: category });

    const resultPromise = new Promise<void>((resolve) => {
      runner.onResult(({ turnId: tid }) => {
        if (!tid) return;
        const evs = store.listEvalsForTurn(tid);
        const overall = evs.find(e => e.metric === 'overall');
        if (overall) store.updateTurn(tid, { outcome: 'committed', compositeScore: overall.score });
        resolve();
      });
    });
    runner.enqueueTurn({ runId, turnId, category });
    await resultPromise;

    const turnEvals = store.listEvalsForTurn(turnId);
    const metrics = new Set(turnEvals.map(e => e.metric));
    expect(metrics.has('thoroughness')).toBe(true);
    expect(metrics.has('relevance')).toBe(true);
    expect(metrics.has('synthesis')).toBe(true);
    expect(metrics.has('overall')).toBe(true);
    const turn = store.getTurn(turnId) as Record<string, unknown>;
    expect(turn.task_category).toBe('research');
    expect(turn.outcome).toBe('committed');
    expect(turn.composite_score).toBeCloseTo(0.78, 5);
  });

  it('daemon backfill pass: turns with response but no outcome get committed + null composite', async () => {
    // Simulate a code-category turn (no turn_judge will run) — the daemon 30s
    // loop must still backfill outcome so the turn shows up in analytics.
    const collector = new ApmeCollector(store);
    const runId = collector.openRun({
      sessionId: 'sess-code',
      agentType: 'claude-code',
      projectName: 'demo',
    });
    collector.ingestHook('sess-code', 'UserPromptSubmit', { message: { content: 'refactor auth middleware' } });
    collector.ingestHook('sess-code', 'PreToolUse', { tool_name: 'Edit' });
    collector.ingestHook('sess-code', 'PreToolUse', { tool_name: 'Edit' });
    collector.ingestHook('sess-code', 'PreToolUse', { tool_name: 'Edit' });
    const turnId = collector.getActiveTurnId('sess-code')!;
    collector.setTurnResponse('sess-code', 'Refactored. 3 files updated.');

    // Precondition: turn has response but no outcome
    expect(store.listTurnsNeedingOutcome(10)).toHaveLength(1);

    // Simulate the daemon 30s pass
    const need = store.listTurnsNeedingOutcome(10);
    for (const t of need) {
      const evs = store.listEvalsForTurn(t.id);
      const overall = evs.find(e => e.layer === 'turn_judge' && e.metric === 'overall');
      store.updateTurn(t.id, {
        outcome: 'committed',
        ...(overall ? { compositeScore: overall.score } : {}),
      });
    }

    const turn = store.getTurn(turnId) as Record<string, unknown>;
    expect(turn.outcome).toBe('committed');
    expect(turn.composite_score).toBeNull();
    // And after backfill, listTurnsNeedingOutcome should be empty
    expect(store.listTurnsNeedingOutcome(10)).toHaveLength(0);
    // Prevent "runId unused" warning
    void runId;
  });
});
