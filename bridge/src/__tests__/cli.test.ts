import { describe, expect, it } from 'vitest';
import { program } from '../cli.js';

describe('agentdeck CLI parser', () => {
  it('reports a misspelled top-level command as unknown and suggests the closest command', () => {
    let stderr = '';
    program.configureOutput({
      writeErr: (str) => {
        stderr += str;
      },
    });
    program.exitOverride();

    let thrown: unknown;
    try {
      program.parse(['node', 'agentdeck', 'tomebox']);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toMatchObject({
      code: 'commander.unknownCommand',
      exitCode: 1,
    });

    expect(stderr).toContain("error: unknown command 'tomebox'");
    expect(stderr).toContain('(Did you mean timebox?)');
    expect(stderr).not.toContain('too many arguments');
  });
});
