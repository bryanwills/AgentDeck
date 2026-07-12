import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueOpenCodeCommand, pollOpenCodeCommands, isOpenCodeSteerable,
  _resetOpenCodeSteering,
} from '../opencode-steering.js';

beforeEach(() => _resetOpenCodeSteering());

describe('opencode steering queue', () => {
  it('poll drains queued commands immediately', async () => {
    enqueueOpenCodeCommand('s1', { type: 'interrupt' });
    enqueueOpenCodeCommand('s1', { type: 'send_prompt', text: 'continue' });
    const cmds = await pollOpenCodeCommands('s1', 25_000);
    expect(cmds).toEqual([
      { type: 'interrupt' },
      { type: 'send_prompt', text: 'continue' },
    ]);
    // Queue is drained.
    enqueueOpenCodeCommand('s1', { type: 'interrupt' });
    expect(await pollOpenCodeCommands('s1', 25_000)).toHaveLength(1);
  });

  it('a parked long-poll wakes the moment a command arrives', async () => {
    const pending = pollOpenCodeCommands('s2', 25_000);
    enqueueOpenCodeCommand('s2', { type: 'interrupt' });
    const cmds = await pending;
    expect(cmds).toEqual([{ type: 'interrupt' }]);
  });

  it('long-poll resolves empty after the wait window', async () => {
    const cmds = await pollOpenCodeCommands('s3', 1);
    expect(cmds).toEqual([]);
  });

  it('permission_respond commands pass through with id + decision intact', async () => {
    enqueueOpenCodeCommand('s6', { type: 'permission_respond', permissionId: 'perm_1', response: 'allow' });
    const cmds = await pollOpenCodeCommands('s6', 25_000);
    expect(cmds).toEqual([{ type: 'permission_respond', permissionId: 'perm_1', response: 'allow' }]);
  });

  it('caps the queue', () => {
    for (let i = 0; i < 8; i++) {
      expect(enqueueOpenCodeCommand('s4', { type: 'interrupt' })).toBe(true);
    }
    expect(enqueueOpenCodeCommand('s4', { type: 'interrupt' })).toBe(false);
  });

  it('steerability reflects a live poller', async () => {
    expect(isOpenCodeSteerable('s5')).toBe(false);
    const pending = pollOpenCodeCommands('s5', 1_000);
    expect(isOpenCodeSteerable('s5')).toBe(true);
    await pending;
  });
});
