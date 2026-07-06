import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { locateCodexRollout, lastAgentMessageFromCodexRollout } from '../codex-rollout-response.js';

/**
 * Observed Codex response capture: codex_stop's payload rarely carries the
 * assistant text, so the daemon reads it from the rollout JSONL tail —
 * `task_complete.last_agent_message` first, else the final `agent_message`.
 * Fixtures mirror real record shapes from ~/.codex/sessions rollouts.
 */
describe('codex rollout response reader', () => {
  const SID = '019ea4a1-ae61-78f1-b420-348c1695f3d7';
  let root: string;

  const dayDir = () => {
    const dir = join(root, '2026', '07', '05');
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeRollout = (lines: unknown[], sid = SID) => {
    const path = join(dayDir(), `rollout-2026-07-05T10-00-00-${sid}.jsonl`);
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
    return path;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('locates a rollout by the session uuid embedded in the filename', () => {
    const path = writeRollout([{ type: 'session_meta', payload: { id: SID } }]);
    expect(locateCodexRollout(SID, root)).toBe(path);
    expect(locateCodexRollout('deadbeef-0000-0000-0000-000000000000', root)).toBeNull();
  });

  it('prefers task_complete.last_agent_message (authoritative turn close)', () => {
    writeRollout([
      { type: 'event_msg', payload: { type: 'agent_message', message: 'mid-turn commentary', phase: 'commentary' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'final reply body' } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'authoritative reply' } },
      { type: 'event_msg', payload: { type: 'token_count', info: {} } },
    ]);
    expect(lastAgentMessageFromCodexRollout(SID, root)).toBe('authoritative reply');
  });

  it('falls back to the newest agent_message when no task_complete follows', () => {
    writeRollout([
      { type: 'event_msg', payload: { type: 'agent_message', message: 'older message' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'newest message' } },
    ]);
    expect(lastAgentMessageFromCodexRollout(SID, root)).toBe('newest message');
  });

  it('returns empty for missing rollouts, malformed lines, and bad ids', () => {
    expect(lastAgentMessageFromCodexRollout(SID, root)).toBe('');
    writeFileSync(join(dayDir(), `rollout-2026-07-05T10-00-00-${SID}.jsonl`), 'not json\n{"half":', 'utf-8');
    expect(lastAgentMessageFromCodexRollout(SID, root)).toBe('');
    expect(lastAgentMessageFromCodexRollout('', root)).toBe('');
    expect(lastAgentMessageFromCodexRollout('../../etc/passwd', root)).toBe('');
  });
});
