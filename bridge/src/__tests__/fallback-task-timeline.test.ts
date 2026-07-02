import { describe, it, expect } from 'vitest';
import { FallbackTaskTimeline } from '../fallback-task-timeline.js';
import type { TimelineEntry } from '../types.js';

/**
 * When APME can't load (better-sqlite3 ABI mismatch / missing build tools),
 * the fallback tracker must still give the timeline its task hierarchy from
 * boundary hooks alone.
 */
describe('FallbackTaskTimeline', () => {
  it('opens a task on the first prompt and closes it on session end', () => {
    const rows: TimelineEntry[] = [];
    const fallback = new FallbackTaskTimeline((e) => rows.push(e), { agentType: 'claude-code' });

    fallback.ingestHook('s1', 'UserPromptSubmit', { prompt: 'do the thing' });
    fallback.ingestHook('s1', 'UserPromptSubmit', { prompt: 'follow-up' }); // same task — no new row
    fallback.ingestHook('s1', 'SessionEnd', {});

    expect(rows.map((r) => r.type)).toEqual(['task_start', 'task_end']);
    expect(rows[0].taskId).toBe(rows[1].taskId);
    expect(rows[0].raw).toBe('Task 1');
    expect(rows[1].boundarySignal).toBe('session_end');
    expect(rows[1].agentType).toBe('claude-code');
    expect(rows[1].startedAt).toBe(rows[0].ts);
  });

  it('segments on /clear and numbers the next task', () => {
    const rows: TimelineEntry[] = [];
    const fallback = new FallbackTaskTimeline((e) => rows.push(e));

    fallback.ingestHook('s1', 'user_prompt_submit', { message: { content: 'first' } });
    fallback.ingestHook('s1', 'user_prompt_submit', { message: { content: ' /clear ' } });
    fallback.ingestHook('s1', 'user_prompt_submit', { message: { content: 'second' } });
    fallback.ingestHook('s1', 'session_end', {});

    expect(rows.map((r) => r.type)).toEqual(['task_start', 'task_end', 'task_start', 'task_end']);
    expect(rows[1].boundarySignal).toBe('clear');
    expect(rows[2].raw).toBe('Task 2');
    expect(rows[2].taskId).not.toBe(rows[0].taskId);
  });

  it('ignores session end with no open task and tracks sessions independently', () => {
    const rows: TimelineEntry[] = [];
    const fallback = new FallbackTaskTimeline((e) => rows.push(e));

    fallback.ingestHook('s1', 'SessionEnd', {}); // nothing open — no row
    expect(rows).toHaveLength(0);

    fallback.ingestHook('a', 'UserPromptSubmit', { prompt: 'x' });
    fallback.ingestHook('b', 'UserPromptSubmit', { prompt: 'y' });
    fallback.ingestHook('a', 'SessionEnd', {});
    expect(rows.filter((r) => r.type === 'task_end')).toHaveLength(1);
    expect(rows.find((r) => r.type === 'task_end')?.sessionId).toBe('a');
  });

  it('drops the per-session counter on session_end so counts cannot grow unbounded', () => {
    const rows: TimelineEntry[] = [];
    const fallback = new FallbackTaskTimeline((e) => rows.push(e));
    const counts = (fallback as unknown as { counts: Map<string, number> }).counts;

    // /clear keeps the counter → next task numbers up within the session.
    fallback.ingestHook('s1', 'UserPromptSubmit', { prompt: 'a' });
    fallback.ingestHook('s1', 'UserPromptSubmit', { prompt: '/clear' });
    fallback.ingestHook('s1', 'UserPromptSubmit', { prompt: 'b' });
    expect(counts.get('s1')).toBe(2);

    // session_end evicts the counter entirely.
    fallback.ingestHook('s1', 'SessionEnd', {});
    expect(counts.has('s1')).toBe(false);

    // A brand-new session after session_end restarts at Task 1.
    fallback.ingestHook('s2', 'UserPromptSubmit', { prompt: 'c' });
    expect(rows.filter((r) => r.type === 'task_start').at(-1)?.raw).toBe('Task 1');
  });
});
