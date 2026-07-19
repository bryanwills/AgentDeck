import { describe, it, expect } from 'vitest';
import {
  timelineIsMeaningfulTaskTitle,
  timelineTaskClosure,
  timelineShouldRenderTaskRow,
  timelineTaskHeaderDisplay,
} from '../timeline-task-display.js';
import type { TimelineEntry } from '../timeline.js';

const row = (over: Partial<TimelineEntry>): TimelineEntry => ({
  ts: 1000,
  type: 'task_start',
  raw: 'Task 1',
  ...over,
});

describe('timelineIsMeaningfulTaskTitle', () => {
  it('rejects empty and auto-minted numeric titles', () => {
    expect(timelineIsMeaningfulTaskTitle('')).toBe(false);
    expect(timelineIsMeaningfulTaskTitle('  ')).toBe(false);
    expect(timelineIsMeaningfulTaskTitle('Task 1')).toBe(false);
    expect(timelineIsMeaningfulTaskTitle('task  12')).toBe(false);
    expect(timelineIsMeaningfulTaskTitle('작업 3')).toBe(false);
  });

  it('accepts real titles', () => {
    expect(timelineIsMeaningfulTaskTitle('Fix eink ticker')).toBe(true);
    expect(timelineIsMeaningfulTaskTitle('Task 1 follow-up')).toBe(true);
  });
});

describe('timelineTaskClosure', () => {
  it('finds the matching task_end by taskId', () => {
    const start = row({ taskId: 'a' });
    const end = row({ type: 'task_end', taskId: 'a', raw: 'Session end · 2 turns · 6m' });
    expect(timelineTaskClosure(start, [start, end])).toBe(end);
  });

  it('ignores mismatched ids and non-headers', () => {
    const start = row({ taskId: 'a' });
    expect(timelineTaskClosure(start, [row({ type: 'task_end', taskId: 'b' })])).toBeUndefined();
    expect(timelineTaskClosure(row({ type: 'task_end', taskId: 'a' }), [])).toBeUndefined();
  });
});

describe('timelineShouldRenderTaskRow', () => {
  it('never renders task_end standalone — including interrupted reaper rows', () => {
    expect(timelineShouldRenderTaskRow(
      row({ type: 'task_end', taskId: 'a', boundarySignal: 'interrupted', raw: 'Interrupted · ~6h' }), [],
    )).toBe(false);
    expect(timelineShouldRenderTaskRow(
      row({ type: 'task_end', taskId: 'a', taskScore: 0.8, taskOutcome: 'committed' }), [],
    )).toBe(false);
  });

  it('passes non-task rows through', () => {
    expect(timelineShouldRenderTaskRow(row({ type: 'chat_start' }), [])).toBe(true);
  });

  it('hides bare "Task N" headers with no eval payload (open or interrupted)', () => {
    const start = row({ taskId: 'a' });
    expect(timelineShouldRenderTaskRow(start, [start])).toBe(false);
    const interrupted = row({ type: 'task_end', taskId: 'a', boundarySignal: 'interrupted', raw: 'Interrupted · ~9m' });
    expect(timelineShouldRenderTaskRow(start, [start, interrupted])).toBe(false);
  });

  it('shows headers with meaningful titles', () => {
    expect(timelineShouldRenderTaskRow(row({ taskId: 'a', raw: 'Fix eink ticker' }), [])).toBe(true);
  });

  it('shows judged tasks via the closure eval payload', () => {
    const start = row({ taskId: 'a' });
    const judged = row({
      type: 'task_end', taskId: 'a', raw: 'Session end · 2 turns · 6m',
      taskScore: 0.2, taskOutcome: 'abandoned', taskSummary: '10min session with no commit',
    });
    expect(timelineShouldRenderTaskRow(start, [start, judged])).toBe(true);
  });

  it('_empty category hides regardless of source', () => {
    expect(timelineShouldRenderTaskRow(row({ taskId: 'a', raw: 'Real title', taskCategory: '_empty' }), [])).toBe(false);
    const start = row({ taskId: 'a', raw: 'Real title' });
    const emptyEnd = row({ type: 'task_end', taskId: 'a', taskCategory: '_empty' });
    expect(timelineShouldRenderTaskRow(start, [start, emptyEnd])).toBe(false);
  });

  it('a non-_empty closure category alone qualifies as eval payload', () => {
    const start = row({ taskId: 'a' });
    const end = row({ type: 'task_end', taskId: 'a', taskCategory: 'general' });
    expect(timelineShouldRenderTaskRow(start, [start, end])).toBe(true);
  });
});

describe('timelineTaskHeaderDisplay', () => {
  it('folds closure label, badge fields, and closedAt into the header', () => {
    const start = row({ taskId: 'a' });
    const end = row({
      type: 'task_end', taskId: 'a', ts: 5000, endedAt: 4800,
      raw: 'Session end · 2 turns · 6m 5s',
      taskScore: 0.2, taskOutcome: 'abandoned', taskSummary: '10min session with no commit',
    });
    const d = timelineTaskHeaderDisplay(start, [start, end]);
    expect(d.closed).toBe(true);
    expect(d.title).toBe('10min session with no commit');
    expect(d.closureText).toBe('Session end · 2 turns · 6m 5s');
    expect(d.taskScore).toBe(0.2);
    expect(d.taskOutcome).toBe('abandoned');
    expect(d.closedAtMs).toBe(4800);
  });

  it('keeps a meaningful own title over the judge summary', () => {
    const start = row({ taskId: 'a', raw: 'Fix eink ticker' });
    const end = row({ type: 'task_end', taskId: 'a', taskSummary: 'Fixed the ticker overflow' });
    expect(timelineTaskHeaderDisplay(start, [start, end]).title).toBe('Fix eink ticker');
  });

  it('open task: not closed, no closure text, falls back to own raw', () => {
    const start = row({ taskId: 'a' });
    const d = timelineTaskHeaderDisplay(start, [start]);
    expect(d.closed).toBe(false);
    expect(d.closureText).toBeUndefined();
    expect(d.title).toBe('Task 1');
    expect(d.closedAtMs).toBeUndefined();
  });

  it('closedAtMs falls back to the closure ts when endedAt is absent', () => {
    const start = row({ taskId: 'a' });
    const end = row({ type: 'task_end', taskId: 'a', ts: 7000 });
    expect(timelineTaskHeaderDisplay(start, [start, end]).closedAtMs).toBe(7000);
  });
});
