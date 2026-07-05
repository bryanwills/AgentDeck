import { describe, expect, it } from 'vitest';
import { program, resolveEsp32OtaDaemonTarget, ESP32_OTA_BY_TARGET } from '../cli.js';

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

// The esp32-ota `target` is dual-purpose (local pio env vs. daemon device_info.board
// match). Short aliases must resolve to the canonical board string before the
// upload POST, or they build fine but fail the daemon match. Regression guard.
describe('esp32-ota target resolution', () => {
  it('maps short aliases to their canonical device_info.board string', () => {
    expect(resolveEsp32OtaDaemonTarget('ttgo')).toBe('ttgo_t_display');
    expect(resolveEsp32OtaDaemonTarget('amoled')).toBe('round_amoled');
    expect(resolveEsp32OtaDaemonTarget('ips35')).toBe('ips_35');
    expect(resolveEsp32OtaDaemonTarget('led8x32')).toBe('ulanzi_tc001');
    expect(resolveEsp32OtaDaemonTarget('box_40')).toBe('86box');
    expect(resolveEsp32OtaDaemonTarget('box_86')).toBe('86box');
    expect(resolveEsp32OtaDaemonTarget('ips10')).toBe('ips_10');
    expect(resolveEsp32OtaDaemonTarget('ips_101')).toBe('ips_10');
  });

  it('leaves a canonical board string unchanged', () => {
    expect(resolveEsp32OtaDaemonTarget('ttgo_t_display')).toBe('ttgo_t_display');
    expect(resolveEsp32OtaDaemonTarget('inkdeck')).toBe('inkdeck');
    expect(resolveEsp32OtaDaemonTarget('86box')).toBe('86box');
  });

  it('passes an unknown target (e.g. a raw IP) through untouched for IP targeting', () => {
    expect(resolveEsp32OtaDaemonTarget('192.168.68.64')).toBe('192.168.68.64');
  });

  it('every alias resolves to a board that is itself a canonical entry (self-consistent SSOT)', () => {
    const canonical = new Set(Object.values(ESP32_OTA_BY_TARGET).map(v => v.board));
    for (const { board } of Object.values(ESP32_OTA_BY_TARGET)) {
      expect(canonical.has(board)).toBe(true);
      expect(ESP32_OTA_BY_TARGET[board]?.board).toBe(board);
    }
  });

  it('drops the retired esp32_c6_147 board from the OTA target set', () => {
    expect(ESP32_OTA_BY_TARGET['esp32_c6_147']).toBeUndefined();
    expect(ESP32_OTA_BY_TARGET['c6_147']).toBeUndefined();
  });
});
