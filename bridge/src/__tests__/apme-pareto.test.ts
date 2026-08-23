import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { computePareto } from '../apme/pareto.js';
import { ApmeStore } from '../apme/store.js';
import { ApmeRecommender } from '../apme/recommend.js';
import type { ApmeSampleScorecardRow } from '@agentdeck/shared';

function sc(modelId: string, quality: number, totalCost: number, samples = 10): ApmeSampleScorecardRow {
  return { agentType: 'claude-code', modelId, provider: null, taskCategory: 'coding', samples, avgQuality: quality, totalCost, costKnown: true, avgLatencyMs: 1000, costPerQuality: quality > 0 ? totalCost / quality : null };
}

describe('computePareto', () => {
  it('keeps non-dominated points and drops dominated ones', () => {
    // opus: high quality, high cost. mlx: lower quality, free. sonnet: mid/mid.
    // "bad": lower quality AND higher cost than sonnet → dominated.
    const rows = [
      sc('claude-opus-4-8', 0.9, 1.0),   // 0.10/sample
      sc('mlx:qwen3-30b', 0.6, 0.0),     // 0.00/sample
      sc('claude-sonnet-4-6', 0.75, 0.3), // 0.03/sample
      sc('bad-model', 0.5, 0.5),          // 0.05/sample, worse than sonnet on both
    ];
    const { frontier, dominated } = computePareto(rows);
    const fIds = frontier.map((p) => p.modelId);
    expect(fIds).toContain('claude-opus-4-8');
    expect(fIds).toContain('mlx:qwen3-30b');
    expect(fIds).toContain('claude-sonnet-4-6');
    expect(dominated.map((p) => p.modelId)).toEqual(['bad-model']);
  });

  it('sorts the frontier cheapest → most expensive', () => {
    const { frontier } = computePareto([sc('a', 0.9, 1.0), sc('b', 0.6, 0.0), sc('c', 0.75, 0.3)]);
    const costs = frontier.map((p) => p.costPerSample);
    expect(costs).toEqual([...costs].sort((x, y) => x - y));
  });

  it('ignores models below minSamples', () => {
    const { frontier } = computePareto([sc('thin', 0.95, 0.0, 1)], 3);
    expect(frontier.length).toBe(0);
  });
});

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-pareto-'));
  const store = new ApmeStore(join(dir, 'apme.sqlite'));
  await store.init();
  (store as unknown as { _tmpDir: string })._tmpDir = dir;
  return store;
}
function cleanup(store: ApmeStore) {
  store.close();
  const dir = (store as unknown as { _tmpDir?: string })._tmpDir;
  if (dir) rmSync(dir, { recursive: true, force: true });
}

describe('ApmeRecommender on the Pareto frontier', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  function seedSample(model: string, quality: number, costUsd: number): void {
    const runId = `run-${model}-${Math.round(quality * 1000)}-${Math.round(costUsd * 1000)}`;
    const taskId = `task-${runId}`;
    store.insertRun({ id: runId, sessionId: 's', agentType: 'claude-code', modelId: model, startedAt: 1, endedAt: 2 });
    store.insertTask({ id: taskId, runId, taskIndex: 0, boundarySignal: 'session_end', startedAt: 1 });
    store.updateTask(taskId, { endedAt: 2, taskCategory: 'coding', compositeScore: quality, costUsd, costKnown: true, modelId: model, latencyMs: 1000 });
  }

  it('recommends only frontier models, cheapest-first under a tight budget', () => {
    // Seed 5 samples each so they pass minSamples=3.
    for (let i = 0; i < 5; i++) {
      seedSample('claude-opus-4-8', 0.9 + i * 0.001, 0.1);
      seedSample('mlx:qwen3-30b', 0.6 + i * 0.001, 0.0);
      seedSample('worse', 0.5 + i * 0.001, 0.2); // dominated by mlx (lower q, higher cost)
    }
    const rec = new ApmeRecommender(store);
    const out = rec.recommend({ taskKind: 'coding', budgetUsd: 1, preferLocal: true });
    const ids = out.map((c) => c.modelId);
    expect(ids).not.toContain('worse');         // dominated → never recommended
    expect(ids[0]).toBe('mlx:qwen3-30b');        // cheapest on the frontier first
  });

  it('returns null for an unpriced model and excludes it from a dollar budget', () => {
    for (let i = 0; i < 3; i++) {
      const model = 'future-provider/model-without-price';
      const runId = `unpriced-run-${i}`;
      const taskId = `unpriced-task-${i}`;
      store.insertRun({ id: runId, sessionId: `s-${i}`, agentType: 'openclaw', modelId: model, startedAt: 1, endedAt: 2 });
      store.insertTask({ id: taskId, runId, taskIndex: 0, boundarySignal: 'session_end', startedAt: 1 });
      store.updateTask(taskId, {
        endedAt: 2, taskCategory: 'coding', compositeScore: 0.95,
        costUsd: 0, costKnown: false, modelId: model, latencyMs: 100,
      });
    }

    const rec = new ApmeRecommender(store);
    expect(rec.recommend({ taskKind: 'coding' })[0]).toMatchObject({
      modelId: 'future-provider/model-without-price',
      expectedCostUsd: null,
    });
    expect(rec.recommend({ taskKind: 'coding', budgetUsd: 1 })).toEqual([]);
  });
});
