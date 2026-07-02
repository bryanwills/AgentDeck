import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector, type OnTaskMilestone } from '../apme/collector.js';
import { opencodeIdleGapTaskBoundary, OPENCODE_IDLE_GAP_MS } from '../apme/adapters/opencode-hook.js';

async function makeStore(): Promise<ApmeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-milestone-test-'));
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

const ALL_DONE = { tool_input: { todos: [{ status: 'completed', content: 'a' }, { status: 'completed', content: 'b' }] } };
const IN_PROGRESS = { tool_input: { todos: [{ status: 'completed', content: 'a' }, { status: 'in_progress', content: 'b' }] } };

describe('TodoWrite-all-completed → onTaskMilestone', () => {
  let store!: ApmeStore;

  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { cleanup(store); });

  it('fires once per (task, turn) with attribution; not on partial todos', () => {
    const collector = new ApmeCollector(store);
    const fired: Parameters<OnTaskMilestone>[0][] = [];
    collector.onTaskMilestone = (args) => fired.push(args);

    collector.openRun({ sessionId: 's1', agentType: 'claude-code', projectName: 'demo' });
    collector.ingestHook('s1', 'UserPromptSubmit', { prompt: 'plan and do' });

    collector.ingestHook('s1', 'PostToolUse', { tool_name: 'TodoWrite', ...IN_PROGRESS });
    expect(fired).toHaveLength(0); // not all completed — no milestone

    collector.ingestHook('s1', 'PostToolUse', { tool_name: 'TodoWrite', ...ALL_DONE });
    collector.ingestHook('s1', 'PostToolUse', { tool_name: 'TodoWrite', ...ALL_DONE });
    expect(fired).toHaveLength(1); // same turn — second all-done is a no-op
    expect(fired[0].agentType).toBe('claude-code');
    expect(fired[0].projectName).toBe('demo');
    expect(fired[0].todoCount).toBe(2);
    expect(fired[0].taskId).toBeTruthy();

    // A later turn may legitimately complete another batch of todos.
    collector.ingestHook('s1', 'UserPromptSubmit', { prompt: 'now do more' });
    collector.ingestHook('s1', 'PostToolUse', { tool_name: 'TodoWrite', ...ALL_DONE });
    expect(fired).toHaveLength(2);
    expect(fired[1].taskId).toBe(fired[0].taskId); // still the same open task
  });
});

describe('opencodeIdleGapTaskBoundary', () => {
  it('builds a task_boundary span with the idle_gap signal', () => {
    const span = opencodeIdleGapTaskBoundary({
      sessionId: 's1', agentType: 'opencode', cwd: '/tmp/p', traceId: 'trace', activeTurnId: undefined,
    });
    expect(span.kind).toBe('task_boundary');
    expect(span.attributes['agentdeck.boundary_signal']).toBe('idle_gap');
    expect(span.attributes['agentdeck.agent_type']).toBe('opencode');
    expect(OPENCODE_IDLE_GAP_MS).toBe(90_000);
  });
});
