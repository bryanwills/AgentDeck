import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { claudeTurnCompletionSince, locateClaudeTranscript } from '../apme/claude-transcript-reader.js';

const SID = '73162ac9-c8d5-4030-a264-0d34bdc9eb23';
const T0 = Date.parse('2026-09-03T00:58:38.000Z');

function rec(role: string, stopReason: string | null, ts: string, text = '') {
  return JSON.stringify({
    type: role, timestamp: ts,
    message: { role, stop_reason: stopReason, content: [{ type: 'text', text }] },
  });
}

describe('claudeTurnCompletionSince', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'claude-projects-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(dir: string, lines: string[]) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, `${SID}.jsonl`), lines.join('\n') + '\n');
  }

  it('locates the transcript by the cwd slug first, then by scanning every project', () => {
    write('-Users-x-github-epoch-of-tech', [rec('user', null, '2026-09-03T00:58:38.100Z', 'go')]);
    expect(locateClaudeTranscript(SID, '/Users/x/github/epoch-of-tech', root)).toBe(join(root, '-Users-x-github-epoch-of-tech', `${SID}.jsonl`));
    expect(locateClaudeTranscript(SID, '/somewhere/else', root)).toBe(join(root, '-Users-x-github-epoch-of-tech', `${SID}.jsonl`));
    expect(locateClaudeTranscript(SID, null, root)).toBe(join(root, '-Users-x-github-epoch-of-tech', `${SID}.jsonl`));
    expect(locateClaudeTranscript('not-a-session', null, root)).toBeNull();
    expect(locateClaudeTranscript('00000000-0000-0000-0000-000000000000', null, root)).toBeNull();
  });

  it('an end_turn newer than the turn closes it as a recovered Stop with the final text', () => {
    // Real tail shape: the end_turn record, then `last-prompt` / `attachment`
    // records with no message role behind it.
    write('p', [
      rec('user', null, '2026-09-03T00:58:38.100Z', '너는 조사 작업자다'),
      rec('assistant', 'tool_use', '2026-09-03T01:02:00.000Z'),
      rec('assistant', 'end_turn', '2026-09-03T01:09:24.586Z', '검증 전부 통과. 샤드 완료 보고다.'),
      JSON.stringify({ type: 'last-prompt', timestamp: '2026-09-03T01:09:24.600Z' }),
    ]);
    expect(claudeTurnCompletionSince(SID, null, T0, root)).toEqual({
      endedAt: Date.parse('2026-09-03T01:09:24.586Z'),
      source: 'synthetic_stop',
      text: '검증 전부 통과. 샤드 완료 보고다.',
    });
  });

  it('a tail still mid-turn claims nothing', () => {
    write('p', [
      rec('user', null, '2026-09-03T00:58:38.100Z', 'go'),
      rec('assistant', 'tool_use', '2026-09-03T01:02:00.000Z'),
    ]);
    expect(claudeTurnCompletionSince(SID, null, T0, root)).toBeNull();
  });

  it('an end_turn older than the turn belongs to a previous turn', () => {
    write('p', [rec('assistant', 'end_turn', '2026-09-02T23:00:00.000Z', 'earlier reply')]);
    expect(claudeTurnCompletionSince(SID, null, T0, root)).toBeNull();
  });

  it('a client abort is aborted, and no transcript is no evidence', () => {
    write('p', [
      rec('user', null, '2026-09-03T00:58:38.100Z', 'go'),
      rec('assistant', 'stop_sequence', '2026-09-03T01:00:00.000Z', "You've hit your session limit"),
    ]);
    expect(claudeTurnCompletionSince(SID, null, T0, root)?.source).toBe('aborted');
    expect(claudeTurnCompletionSince('11111111-1111-1111-1111-111111111111', null, T0, root)).toBeNull();
  });
});
