import { describe, it, expect } from 'vitest';
import { parseAntigravityTranscript } from '../apme/antigravity-transcript.js';
import { isAntigravityProcessCommand } from '../passive-observer.js';

describe('antigravity transcript parsing', () => {
  it('extracts goal, model (from settings change), state and tool task', () => {
    const lines = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
        content: '<USER_REQUEST>\nfix the failing build\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to GPT-OSS 120B (Medium). No need to comment.\n</USER_SETTINGS_CHANGE>' },
      { step_index: 1, source: 'SYSTEM', type: 'CONVERSATION_HISTORY', status: 'DONE' },
      { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'Looking…' },
      { step_index: 3, source: 'MODEL', type: 'VIEW_FILE', status: 'DONE', tool_calls: [{ name: 'view_file' }] },
    ].map((r) => JSON.stringify(r)).join('\n');

    const s = parseAntigravityTranscript(lines);
    expect(s.goal).toBe('fix the failing build');
    expect(s.model).toBe('GPT-OSS 120B (Medium)');
    expect(s.currentTask).toBe('view_file');
    expect(s.state).toBe('idle');
  });

  it('reports processing when the newest step is RUNNING; later model change wins', () => {
    const lines = [
      { type: 'USER_INPUT', status: 'DONE',
        content: '<USER_REQUEST>\ndo X\n</USER_REQUEST>\nThe user changed setting `Model Selection` from None to Gemini 3.5 Flash (Medium).' },
      { type: 'USER_INPUT', status: 'DONE',
        content: '<USER_REQUEST>\nnow do Y\n</USER_REQUEST>\nThe user changed setting `Model Selection` from Gemini 3.5 Flash (Medium) to Claude Opus 4.6 (Thinking).' },
      { type: 'RUN_COMMAND', status: 'RUNNING', tool_calls: [{ name: 'run_command' }] },
    ].map((r) => JSON.stringify(r)).join('\n');

    const s = parseAntigravityTranscript(lines);
    expect(s.goal).toBe('do X');                       // first request is the goal
    expect(s.model).toBe('Claude Opus 4.6 (Thinking)'); // latest selection wins
    expect(s.state).toBe('processing');
  });

  it('reports idle when only historical steps are RUNNING (newest step is DONE)', () => {
    // agy leaves RUNNING records behind after a step completes; the live state
    // must be read from the newest step only, not any record in the transcript.
    const lines = [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE',
        content: '<USER_REQUEST>\ndo X\n</USER_REQUEST>' },
      { step_index: 1, type: 'RUN_COMMAND', status: 'RUNNING', tool_calls: [{ name: 'run_command' }] },
      { step_index: 2, type: 'VIEW_FILE', status: 'RUNNING', tool_calls: [{ name: 'view_file' }] },
      { step_index: 3, type: 'PLANNER_RESPONSE', status: 'DONE' },
    ].map((r) => JSON.stringify(r)).join('\n');

    const s = parseAntigravityTranscript(lines);
    expect(s.state).toBe('idle');
  });

  it('matches the agy CLI binary as an Antigravity process', () => {
    expect(isAntigravityProcessCommand('/opt/homebrew/bin/agy')).toBe(true);
    expect(isAntigravityProcessCommand('agy -i "hello"')).toBe(true);
    expect(isAntigravityProcessCommand('/Applications/Antigravity.app/Contents/MacOS/Antigravity')).toBe(true);
    // negatives
    expect(isAntigravityProcessCommand('grep agy somefile')).toBe(false);
    expect(isAntigravityProcessCommand('node agentdeck')).toBe(false);
    expect(isAntigravityProcessCommand('/usr/bin/legacy-tool')).toBe(false);
  });
});
