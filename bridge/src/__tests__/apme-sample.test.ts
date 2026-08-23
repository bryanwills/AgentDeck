import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';
import { priceUsd } from '@agentdeck/shared';
import type { UsageSnapshot } from '../types.js';

// Phase 0 — SessionSample store layer: typed trajectory round-trip,
// storage-time dedup (UNIQUE index + INSERT OR IGNORE), and cost aggregation.

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-sample-'));
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

function seed(store: ApmeStore): { runId: string; taskId: string } {
  const runId = 'run-1';
  const taskId = 'task-1';
  store.insertRun({ id: runId, sessionId: 's1', agentType: 'claude-code', modelId: 'claude-opus-4-8', startedAt: 1000 });
  store.insertTask({ id: taskId, runId, taskIndex: 0, boundarySignal: 'open', startedAt: 1000 });
  return { runId, taskId };
}

describe('ApmeStore sample events', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('round-trips typed trajectory events into a SessionSample', () => {
    const { runId, taskId } = seed(store);
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 0, ts: 1001, kind: 'user_message', payload: JSON.stringify({ text: 'fix the bug' }), dedupKey: 'u0' });
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 1, ts: 1002, kind: 'tool', toolName: 'Edit', toolStatus: 'success', payload: JSON.stringify({ input: { file: 'a.ts' }, output: 'ok' }), dedupKey: 't0' });
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 2, ts: 1003, kind: 'assistant_message', payload: JSON.stringify({ text: 'done', responseKind: 'text' }), dedupKey: 'a0' });
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 3, ts: 1004, kind: 'model', model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 500, costUsd: priceUsd('claude-opus-4-8', 1000, 500), latencyMs: 2200, dedupKey: 'm0' });

    const sample = store.getSample(taskId);
    expect(sample).not.toBeNull();
    expect(sample!.id).toBe(taskId);
    expect(sample!.events.length).toBe(4);
    expect(sample!.events[0]).toMatchObject({ kind: 'user_message', text: 'fix the bug', turnIndex: 0 });
    expect(sample!.events[1]).toMatchObject({ kind: 'tool', name: 'Edit', status: 'success' });
    expect(sample!.events[2]).toMatchObject({ kind: 'assistant_message', responseKind: 'text' });
    expect(sample!.events[3]).toMatchObject({ kind: 'model', model: 'claude-opus-4-8', inputTokens: 1000 });
    expect(sample!.model.modelId).toBe('claude-opus-4-8');
  });

  it('dedups identical (task, dedupKey) at storage time', () => {
    const { runId, taskId } = seed(store);
    const inserted1 = store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 0, ts: 1, kind: 'assistant_message', payload: JSON.stringify({ text: 'hi', responseKind: 'text' }), dedupKey: 'dup' });
    const inserted2 = store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 1, ts: 2, kind: 'assistant_message', payload: JSON.stringify({ text: 'hi', responseKind: 'text' }), dedupKey: 'dup' });
    expect(inserted1).toBe(true);
    expect(inserted2).toBe(false);
    expect(store.listSampleEvents(taskId).length).toBe(1);
  });

  it('resolves a pending tool event in place (one row, not two)', () => {
    const { runId, taskId } = seed(store);
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 0, ts: 1, kind: 'tool', toolName: 'Bash', toolStatus: 'pending', dedupKey: 'b0' });
    const pending = store.findPendingToolEvent(taskId, 0, 'Bash');
    expect(pending).not.toBeNull();
    store.updateSampleEvent(pending!.id!, { toolStatus: 'success', payload: JSON.stringify({ output: 'done' }) });
    const events = store.listSampleEvents(taskId);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'tool', name: 'Bash', status: 'success' });
  });

  it('recomputeSampleCost sums ModelEvents into the task header', () => {
    const { runId, taskId } = seed(store);
    store.insertSampleEvent({ taskId, runId, turnIndex: 0, seq: 0, ts: 1, kind: 'model', model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 500, costUsd: 0.0525, latencyMs: 2000, dedupKey: 'm0' });
    store.insertSampleEvent({ taskId, runId, turnIndex: 1, seq: 1, ts: 2, kind: 'model', model: 'claude-opus-4-8', inputTokens: 2000, outputTokens: 1000, costUsd: 0.105, latencyMs: 3000, dedupKey: 'm1' });
    store.recomputeSampleCost(taskId);
    const sample = store.getSample(taskId);
    expect(sample!.cost.inputTokens).toBe(3000);
    expect(sample!.cost.outputTokens).toBe(1500);
    expect(sample!.cost.latencyMs).toBe(5000);
    expect(sample!.cost.costUsd).toBeCloseTo(0.1575, 4);
    expect(sample!.cost.costKnown).toBe(true);
  });

  it('local models price at $0; unknown models fall back to $0 but flag unpriced', () => {
    expect(priceUsd('mlx:qwen3-30b', 100000, 50000)).toBe(0);
    expect(priceUsd('claude-opus-4-8', 1_000_000, 0)).toBeGreaterThan(0);
  });
});

describe('ApmeCollector → SessionSample (Phase 1 dual-write)', () => {
  let store!: ApmeStore;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('builds a typed trajectory (user → tool pending→resolved → assistant) and cost', () => {
    const collector = new ApmeCollector(store);
    const sessionId = 'sess-1';
    const runId = collector.openRun({ sessionId, agentType: 'claude-code', modelId: 'claude-opus-4-8', projectName: 'demo' });
    expect(runId).not.toBe('');

    collector.ingestHook(sessionId, 'UserPromptSubmit', { prompt: 'fix the parser bug' });
    collector.ingestHook(sessionId, 'PreToolUse', { tool_name: 'Edit', tool_input: { file: 'parser.ts' } });
    collector.ingestHook(sessionId, 'PostToolUse', { tool_name: 'Edit', tool_response: 'applied' });
    collector.updateUsage(sessionId, { inputTokens: 4000, outputTokens: 1200, estimatedCostUsd: null } as unknown as UsageSnapshot);
    collector.setTurnResponse(sessionId, 'Fixed the off-by-one in the tokenizer.');

    const taskId = collector.getActiveTaskId(sessionId)!;
    const sample = store.getSample(taskId)!;
    const kinds = sample.events.map((e) => e.kind);
    expect(kinds).toContain('user_message');
    expect(kinds).toContain('tool');
    expect(kinds).toContain('assistant_message');
    expect(kinds).toContain('model');

    // The tool event is a single resolved row (pending upgraded to success).
    const toolEvents = sample.events.filter((e) => e.kind === 'tool');
    expect(toolEvents.length).toBe(1);
    expect(toolEvents[0]).toMatchObject({ kind: 'tool', name: 'Edit', status: 'success' });

    // Cost was priced from the cumulative usage delta and aggregated.
    expect(sample.cost.inputTokens).toBe(4000);
    expect(sample.cost.outputTokens).toBe(1200);
    expect(sample.cost.costUsd).toBeGreaterThan(0);
    expect(sample.model.modelId).toBe('claude-opus-4-8');
  });

  it('fires onSampleEvent once per inserted event (no dup double-emit)', () => {
    const collector = new ApmeCollector(store);
    const seen: string[] = [];
    collector.onSampleEvent = ({ event }) => seen.push(event.kind);
    const sessionId = 'sess-2';
    collector.openRun({ sessionId, agentType: 'claude-code', modelId: 'mlx:qwen3-30b' });
    collector.ingestHook(sessionId, 'UserPromptSubmit', { prompt: 'hello' });
    collector.setTurnResponse(sessionId, 'hi there');
    expect(seen).toContain('user_message');
    expect(seen).toContain('assistant_message');
    expect(seen.filter((k) => k === 'user_message').length).toBe(1);
  });
});
