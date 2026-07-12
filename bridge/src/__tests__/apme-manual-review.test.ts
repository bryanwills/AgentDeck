// Manual review (REVIEW deck button) shares the APME eval store with the
// automatic pipeline, flagged by the `manual_review` layer. This locks the
// roundtrip so the dashboard can rely on the layer flag to separate hand-run
// reviews from automatic ones.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';

let store: ApmeStore;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apme-manual-'));
  store = new ApmeStore(join(dir, 'apme.sqlite'));
  const ok = await store.init();
  if (!ok) throw new Error('APME store failed to init — is better-sqlite3 installed?');
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('manual_review eval roundtrip', () => {
  it('persists a manual_review eval on a task and reads it back with the layer flag intact', () => {
    const runId = 'run-1';
    store.insertRun({
      id: runId, sessionId: runId, agentType: 'claude-code', projectName: 'proj', projectPath: '/tmp/proj',
      startedAt: Date.now(), model: null,
    } as Parameters<typeof store.insertRun>[0]);
    const taskId = 'task-1';
    store.insertTask({
      id: taskId, runId, taskIndex: 0, firstTurnIndex: 0, lastTurnIndex: 0,
      startedAt: Date.now(), endedAt: Date.now(), boundarySignal: 'manual',
    } as Parameters<typeof store.insertTask>[0]);

    store.insertEvalForTask({
      runId, taskId, layer: 'manual_review', metric: 'risk', score: 0.5,
      raw: JSON.stringify({ risk: 'medium', summary: 'looks ok', findings: [{ severity: 'low', title: 't', detail: 'd' }] }),
      judgeModel: 'foundation-models', createdAt: Date.now(),
    });

    const evals = store.listEvalsForTask(taskId);
    const manual = evals.filter((e) => e.layer === 'manual_review');
    expect(manual).toHaveLength(1);
    expect(manual[0].metric).toBe('risk');
    expect(manual[0].score).toBe(0.5);
    expect(manual[0].judgeModel).toBe('foundation-models');
    const raw = JSON.parse(manual[0].raw!);
    expect(raw.risk).toBe('medium');
    expect(raw.findings).toHaveLength(1);
  });

  it('manual_review evals do not contaminate the automatic-layer filters', () => {
    const runId = 'run-2';
    store.insertRun({
      id: runId, sessionId: runId, agentType: 'claude-code', projectName: 'p', projectPath: '/tmp/p',
      startedAt: Date.now(), model: null,
    } as Parameters<typeof store.insertRun>[0]);
    const taskId = 'task-2';
    store.insertTask({
      id: taskId, runId, taskIndex: 0, firstTurnIndex: 0, lastTurnIndex: 0,
      startedAt: Date.now(), endedAt: Date.now(), boundarySignal: 'manual',
    } as Parameters<typeof store.insertTask>[0]);
    store.insertEvalForTask({ runId, taskId, layer: 'manual_review', metric: 'risk', score: 1, createdAt: Date.now() });
    store.insertEvalForTask({ runId, taskId, layer: 'task_judge', metric: 'overall', score: 0.8, createdAt: Date.now() });

    const evals = store.listEvalsForTask(taskId);
    expect(evals.filter((e) => e.layer === 'task_judge')).toHaveLength(1);
    expect(evals.filter((e) => e.layer === 'manual_review')).toHaveLength(1);
    // The automatic 'overall' axis is unaffected by the manual review row.
    expect(evals.find((e) => e.layer === 'task_judge')?.score).toBe(0.8);
  });
});
