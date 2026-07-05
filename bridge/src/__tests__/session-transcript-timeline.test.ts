import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastAssistantTextFromTranscript } from '../session-transcript-timeline.js';

const dirs: string[] = [];

function writeTranscript(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdeck-transcript-'));
  dirs.push(dir);
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('lastAssistantTextFromTranscript', () => {
  it('returns the last assistant text at Stop time', () => {
    const path = writeTranscript([
      { message: { role: 'user', content: 'fix the bug' } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Looking into it.' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed and verified.' }] } },
    ]);
    expect(lastAssistantTextFromTranscript(path)).toBe('Fixed and verified.');
  });

  it('skips tool_result user continuations between assistant messages', () => {
    const path = writeTranscript([
      { message: { role: 'user', content: 'run the tests' } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'All tests pass.' }] } },
      // tool_result continuation — role:user but no readable text blocks
      { message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    ]);
    expect(lastAssistantTextFromTranscript(path)).toBe('All tests pass.');
  });

  it('returns empty when the tail is an unanswered prompt', () => {
    const path = writeTranscript([
      { message: { role: 'assistant', content: [{ type: 'text', text: 'previous turn reply' }] } },
      { message: { role: 'user', content: 'new question not yet answered' } },
    ]);
    expect(lastAssistantTextFromTranscript(path)).toBe('');
  });

  it('returns empty for a missing file', () => {
    expect(lastAssistantTextFromTranscript('/nonexistent/nope.jsonl')).toBe('');
  });

  it('skips malformed tail lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentdeck-transcript-'));
    dirs.push(dir);
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, [
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }),
      '{ partial-json',
    ].join('\n'));
    expect(lastAssistantTextFromTranscript(path)).toBe('done');
  });
});
