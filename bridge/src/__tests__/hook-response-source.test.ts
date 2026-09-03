import { describe, it, expect, vi } from 'vitest';
import { resolveStopResponse, type StopResponseReaders } from '../hook-response-source.js';

/**
 * Which reader a Stop hook's reply comes from, per agent. The trap this pins:
 * a Codex hook carries `transcript_path` too — its rollout — and handing that
 * to the Claude reader returned '' for every Codex turn while
 * `last_assistant_message` sat in the same payload (3 of 128 codex
 * stop-turns held a response in one week, 2026-09-03).
 */
function readers() {
  const r: StopResponseReaders = {
    readClaudeTranscript: vi.fn(() => 'claude transcript text'),
    readCodexRolloutPath: vi.fn(() => ({ text: 'rollout text at path' })),
    readCodexRolloutById: vi.fn(() => ({ text: 'rollout text by id', error: 'quota' })),
  };
  return r;
}

describe('resolveStopResponse', () => {
  it('inline text wins for every agent and touches no file', () => {
    for (const agentType of ['codex-cli', 'claude-code', 'opencode', 'kiro-cli']) {
      const r = readers();
      const out = resolveStopResponse({ agentType, sessionId: 's', inlineResponse: 'said inline', transcriptPath: '/x/rollout.jsonl' }, r);
      expect(out.text).toBe('said inline');
      expect(r.readClaudeTranscript).not.toHaveBeenCalled();
      expect(r.readCodexRolloutPath).not.toHaveBeenCalled();
      expect(r.readCodexRolloutById).not.toHaveBeenCalled();
    }
  });

  it("a Codex hook's transcript_path is its rollout, read by the Codex reader — never the Claude one", () => {
    const r = readers();
    const out = resolveStopResponse({ agentType: 'codex-cli', sessionId: 'thread', inlineResponse: '', transcriptPath: '/home/.codex/sessions/2026/09/02/rollout-x.jsonl' }, r);
    expect(out.text).toBe('rollout text at path');
    expect(r.readCodexRolloutPath).toHaveBeenCalledWith('/home/.codex/sessions/2026/09/02/rollout-x.jsonl');
    expect(r.readClaudeTranscript).not.toHaveBeenCalled();
  });

  it('a Codex hook without a path locates the rollout by session id, and carries its recorded failure', () => {
    const r = readers();
    const out = resolveStopResponse({ agentType: 'codex-cli', sessionId: 'thread', inlineResponse: '', transcriptPath: '' }, r);
    expect(out.text).toBe('rollout text by id');
    expect(out.rollout.error).toBe('quota');
    expect(r.readCodexRolloutById).toHaveBeenCalledWith('thread');
  });

  it("a Claude hook's transcript_path goes to the Claude reader", () => {
    const r = readers();
    const out = resolveStopResponse({ agentType: 'claude-code', sessionId: 's', inlineResponse: '', transcriptPath: '/home/.claude/projects/p/s.jsonl' }, r);
    expect(out.text).toBe('claude transcript text');
    expect(r.readCodexRolloutPath).not.toHaveBeenCalled();
  });

  it('an agent with neither inline text nor an owned reader yields nothing rather than a guess', () => {
    const r = readers();
    const out = resolveStopResponse({ agentType: 'kiro-cli', sessionId: 's', inlineResponse: '', transcriptPath: '/some/file' }, r);
    expect(out.text).toBe('');
    expect(r.readClaudeTranscript).not.toHaveBeenCalled();
  });
});
