import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  deriveTaskTitle,
  TASK_TITLE_MAX_CHARS,
  TASK_TITLE_MIN_CHARS,
} from '../task-title.js';
import { timelineIsMeaningfulTaskTitle } from '../timeline-task-display.js';

describe('deriveTaskTitle', () => {
  it('uses the first non-empty line, trimmed and whitespace-collapsed', () => {
    expect(deriveTaskTitle('  Fix the   flaky payment test\nmore detail below'))
      .toBe('Fix the flaky payment test');
  });

  it('returns null for empty / missing prompts', () => {
    expect(deriveTaskTitle(null)).toBeNull();
    expect(deriveTaskTitle(undefined)).toBeNull();
    expect(deriveTaskTitle('   \n \n')).toBeNull();
  });

  it('skips bare slash-command lines and finds the first real line', () => {
    expect(deriveTaskTitle('/task close')).toBeNull();
    expect(deriveTaskTitle('/compact\nInvestigate the perf regression'))
      .toBe('Investigate the perf regression');
  });

  it('a slash PATH is not a slash command — path-leading bug reports keep their title', () => {
    expect(deriveTaskTitle('/Users/x/cli.ts crashes on startup'))
      .toBe('/Users/x/cli.ts crashes on startup');
    expect(deriveTaskTitle('/tmp/agent.log 를 봐줘'))
      .toBe('/tmp/agent.log 를 봐줘');
  });

  it('a non-ASCII word after the slash is not a command (commands are ASCII)', () => {
    expect(deriveTaskTitle('/작업 정리해줘\nsecond line')).toBe('/작업 정리해줘');
  });

  it('a prompt STARTING with markup is machine plumbing — null, never its inner body', () => {
    expect(deriveTaskTitle('<task-notification>\nBackground task db3f completed')).toBeNull();
    expect(deriveTaskTitle('<system-reminder>stuff</system-reminder>')).toBeNull();
  });

  it('markup after a real first line does not block that line', () => {
    expect(deriveTaskTitle('Summarize the review findings\n<system-reminder>context</system-reminder>'))
      .toBe('Summarize the review findings');
  });

  it('a fence swallows its whole body — the ask wins, never the pasted code', () => {
    expect(deriveTaskTitle('```bash\necho hi\n```\nrun this and explain the output'))
      .toBe('run this and explain the output');
    expect(deriveTaskTitle('```\nTypeError: cannot read foo\n```\n이 스택트레이스 원인 찾아줘'))
      .toBe('이 스택트레이스 원인 찾아줘');
  });

  it('strips markdown furniture', () => {
    expect(deriveTaskTitle('## Refactor the collector')).toBe('Refactor the collector');
    expect(deriveTaskTitle('- add tests for the fold')).toBe('add tests for the fold');
    expect(deriveTaskTitle('> quoted request')).toBe('quoted request');
  });

  it('rejects fragments shorter than the minimum', () => {
    expect(deriveTaskTitle('ok')).toBeNull();
    expect(deriveTaskTitle('go\n')).toBeNull();
    expect(TASK_TITLE_MIN_CHARS).toBeGreaterThan(1);
  });

  it('caps long prompts at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(40).trim();
    const title = deriveTaskTitle(long)!;
    expect(title.endsWith('…')).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(TASK_TITLE_MAX_CHARS + 1);
    expect(title).toMatch(/word…$/);
  });

  it('hard-cuts boundary-less CJK text without dropping most of the budget', () => {
    const korean = '가'.repeat(200);
    const title = deriveTaskTitle(korean)!;
    expect(Array.from(title).length).toBe(TASK_TITLE_MAX_CHARS + 1); // + ellipsis
    expect(title.endsWith('…')).toBe(true);
  });

  it('all index math is in code points, not UTF-16 units', () => {
    // Astral plane (2 UTF-16 units per point). A UTF-16 lastIndexOf would put
    // the word-boundary threshold at the wrong place; code points keep the
    // whole budget.
    const emoji = '🐙'.repeat(TASK_TITLE_MAX_CHARS + 10);
    const title = deriveTaskTitle(emoji)!;
    expect(Array.from(title).length).toBe(TASK_TITLE_MAX_CHARS + 1);
    expect(title).not.toMatch(/[\uD800-\uDBFF]…$/);
    // Word boundary inside an astral string: space at code-point index 40 of
    // the window — inside the back half, so the cut lands there.
    const mixed = '🐙'.repeat(40) + ' ' + '🐙'.repeat(60);
    const cut = deriveTaskTitle(mixed)!;
    expect(cut).toBe('🐙'.repeat(40) + '…');
  });

  it('every derived title passes the timeline meaningful-title gate', () => {
    for (const p of ['Fix the flaky test', '리밋 지문 규칙을 고쳐줘', '## heading style prompt']) {
      const t = deriveTaskTitle(p);
      expect(t).not.toBeNull();
      expect(timelineIsMeaningfulTaskTitle(t)).toBe(true);
    }
  });

  it('a prompt that literally says "Task 3" still reads as non-meaningful downstream', () => {
    expect(timelineIsMeaningfulTaskTitle(deriveTaskTitle('Task 3'))).toBe(false);
  });
});

describe('cross-language parity vectors', () => {
  // The Swift hand mirror (ApmeCollector.deriveTaskTitle) replays THIS file's
  // vectors in ApmeTaskBoundaryTests. A rule change that edits only one
  // implementation goes red on the other side — that is the whole point of
  // vectors authored once and consumed twice.
  const here = dirname(fileURLToPath(import.meta.url));
  const vectors = JSON.parse(
    readFileSync(join(here, '..', '..', 'task-title-vectors.json'), 'utf-8'),
  ) as Array<{ input: string | null; expected: string | null; note: string }>;

  it('has enough vectors to be a gate, and each passes', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(12);
    for (const v of vectors) {
      expect(deriveTaskTitle(v.input), v.note).toBe(v.expected);
    }
  });
});
