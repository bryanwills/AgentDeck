import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';

// These tests require the optional native dep `better-sqlite3`. If the store
// cannot initialize we fail loudly — silent skips would hide regressions.

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

describe('ApmeCollector', () => {
  let store!: ApmeStore;

  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('openRun → ingestHook → closeRun persists a run with steps', async () => {
    const collector = new ApmeCollector(store);

    const runId = collector.openRun({
      sessionId: 'session-1',
      agentType: 'claude-code',
      projectName: 'demo',
      projectPath: '/tmp/demo',
    });
    expect(runId).toBeTruthy();

    collector.ingestHook('session-1', 'UserPromptSubmit', { prompt: 'refactor the thing' });
    collector.ingestHook('session-1', 'PreToolUse', { tool_name: 'Edit', file_path: '/tmp/demo/a.ts' });
    collector.ingestHook('session-1', 'PostToolUse', { tool_name: 'Edit' });

    const closedId = collector.closeRun('session-1', 0, '/tmp/demo');
    expect(closedId).toBe(runId);

    const run = store.getRun(runId);
    expect(run).not.toBeNull();
    expect(run?.sessionId).toBe('session-1');
    expect(run?.agentType).toBe('claude-code');
    expect(run?.projectName).toBe('demo');
    expect(run?.endedAt).toBeGreaterThan(0);
    expect(run?.exitCode).toBe(0);
    expect(run?.taskPrompt).toBe('refactor the thing');

    const steps = store.listSteps(runId);
    expect(steps.length).toBe(3);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toEqual(['UserPromptSubmit', 'PreToolUse', 'PostToolUse']);
    const editStep = steps.find((s) => s.kind === 'PreToolUse');
    expect(editStep?.toolName).toBe('Edit');
  });

  it('updateUsage and updateModel reflect in the run row', async () => {
    const collector = new ApmeCollector(store);
    const runId = collector.openRun({
      sessionId: 'session-2',
      agentType: 'claude-code',
      projectName: 'demo',
    });

    collector.updateModel('session-2', 'claude-opus-4-6');
    collector.updateUsage('session-2', {
      sessionDurationSec: 10,
      inputTokens: 1200,
      outputTokens: 340,
      toolCalls: 3,
      estimatedCostUsd: 0.075,
      sessionPercent: null,
      costSpent: null,
      costLimit: null,
      resetTime: null,
      resetDate: null,
    });

    const run = store.getRun(runId);
    expect(run?.modelId).toBe('claude-opus-4-6');
    expect(run?.inputTokens).toBe(1200);
    expect(run?.outputTokens).toBe(340);
    expect(run?.costUsd).toBeCloseTo(0.075);
  });

  it('listRuns filters by agent and orders by started_at desc', async () => {
    const collector = new ApmeCollector(store);

    const a = collector.openRun({ sessionId: 's-a', agentType: 'claude-code', projectName: 'p' });
    await new Promise((r) => setTimeout(r, 5));
    const b = collector.openRun({ sessionId: 's-b', agentType: 'openclaw', projectName: 'p' });
    await new Promise((r) => setTimeout(r, 5));
    const c = collector.openRun({ sessionId: 's-c', agentType: 'claude-code', projectName: 'p' });

    const claudeRuns = store.listRuns({ agentType: 'claude-code' });
    expect(claudeRuns.length).toBe(2);
    expect(claudeRuns[0].id).toBe(c); // newest first
    expect(claudeRuns[1].id).toBe(a);

    const openclaw = store.listRuns({ agentType: 'openclaw' });
    expect(openclaw.length).toBe(1);
    expect(openclaw[0].id).toBe(b);
  });

  it('default rubric v1 is seeded on init', async () => {
    const rubric = store.getCurrentRubric('general');
    expect(rubric).not.toBeNull();
    expect(rubric?.version).toBe(1);
    expect(rubric?.purpose).toBe('general');
    expect(rubric?.prompt).toContain('intent');
    const weights = JSON.parse(rubric!.weights) as Record<string, number>;
    expect(weights.intent).toBeGreaterThan(0);
  });

  it('insertEval + listEvalsForRun round-trip', async () => {
    const collector = new ApmeCollector(store);
    const runId = collector.openRun({ sessionId: 's', agentType: 'claude-code', projectName: 'p' });

    store.insertEval({ runId, layer: 'deterministic', metric: 'tests_pass', score: 1, createdAt: Date.now() });
    store.insertEval({ runId, layer: 'llm_judge', metric: 'overall', score: 0.82, rubricVer: 1, judgeModel: 'claude-opus-4-6', createdAt: Date.now() });

    const evals = store.listEvalsForRun(runId);
    expect(evals.length).toBe(2);
    expect(evals.find((e) => e.metric === 'tests_pass')?.score).toBe(1);
    expect(evals.find((e) => e.metric === 'overall')?.score).toBeCloseTo(0.82);
  });

  it('scorecard view aggregates runs per model', async () => {
    const collector = new ApmeCollector(store);
    const runA = collector.openRun({ sessionId: 's1', agentType: 'claude-code', projectName: 'p' });
    collector.updateModel('s1', 'claude-opus-4-6');
    collector.updateUsage('s1', {
      sessionDurationSec: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0,
      estimatedCostUsd: 0.5,
      sessionPercent: null, costSpent: null, costLimit: null, resetTime: null, resetDate: null,
    });
    store.insertEval({ runId: runA, layer: 'llm_judge', metric: 'overall', score: 0.9, createdAt: Date.now() });

    const runB = collector.openRun({ sessionId: 's2', agentType: 'claude-code', projectName: 'p' });
    collector.updateModel('s2', 'claude-opus-4-6');
    collector.updateUsage('s2', {
      sessionDurationSec: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0,
      estimatedCostUsd: 0.3,
      sessionPercent: null, costSpent: null, costLimit: null, resetTime: null, resetDate: null,
    });
    store.insertEval({ runId: runB, layer: 'llm_judge', metric: 'overall', score: 0.7, createdAt: Date.now() });

    const cards = store.scorecard();
    const opus = cards.find((c) => c.modelId === 'claude-opus-4-6');
    expect(opus).toBeDefined();
    expect(opus?.runs).toBe(2);
    expect(opus?.avgOverall).toBeCloseTo(0.8);
    expect(opus?.totalCost).toBeCloseTo(0.8);
  });

  it('no-op gracefully when store is disabled', () => {
    const dummy = new ApmeStore('/nonexistent/_disabled');
    // init() never called, so enabled=false
    expect(dummy.enabled).toBe(false);
    const collector = new ApmeCollector(dummy);
    expect(collector.openRun({ sessionId: 'x', agentType: 'claude-code', projectName: 'p' })).toBe('');
    expect(() => collector.ingestHook('x', 'PreToolUse', { tool_name: 'Bash' })).not.toThrow();
    expect(collector.closeRun('x')).toBeNull();
  });
});
