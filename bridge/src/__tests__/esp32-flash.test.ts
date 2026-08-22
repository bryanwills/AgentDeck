/**
 * `agentdeck esp32 flash` — the decisions it makes before it touches hardware.
 *
 * Everything tested here happens BEFORE a byte moves: which board a target
 * names, which release its firmware comes from, whether the port is free, and
 * whether the image on disk is the image the release published.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  classifyHolders,
  firmwareCacheDir,
  firmwareVersionFromCheckout,
  resolveFirmware,
  resolveFlashBoard,
  SERIAL_PROBE_UNAVAILABLE,
} from '../esp32-flash.js';
import { ESP32_BOARDS, esp32BoardById } from '@agentdeck/shared';

describe('resolveFlashBoard', () => {
  it('accepts the canonical id, the pio env, and every alias', () => {
    for (const b of ESP32_BOARDS) {
      for (const key of [b.id, b.env, ...b.aliases]) {
        expect(resolveFlashBoard(key).id, `${key} → wrong board`).toBe(b.id);
      }
    }
  });

  it('offers boards the BROWSER does not — USB is the only path for some', () => {
    // esp32_c6_147 has no OTA slot at all, so refusing it here would leave it
    // with no update path whatsoever.
    expect(resolveFlashBoard('esp32_c6_147').ota).toBe(false);
    expect(resolveFlashBoard('esp32_c6_147').webFlash).toBe(false);
  });

  it('names the alternatives when a target is unknown', () => {
    // The message is the whole product of this failure — a bare "unknown board"
    // leaves the user guessing at a namespace that has three spellings per row.
    expect(() => resolveFlashBoard('nope')).toThrow(/unknown board "nope"/);
    expect(() => resolveFlashBoard('nope')).toThrow(/ttgo_t_display/);
  });
});

describe('firmwareVersionFromCheckout', () => {
  it('reads FIRMWARE_VERSION out of config.h', () => {
    expect(firmwareVersionFromCheckout('constexpr const char* FIRMWARE_VERSION = "1.0.6";')).toBe('1.0.6');
  });

  it('returns undefined rather than guessing when the constant is absent', () => {
    expect(firmwareVersionFromCheckout('// nothing here')).toBeUndefined();
  });
});

describe('classifyHolders', () => {
  it('separates AgentDeck processes from everyone else', () => {
    const { ours, foreign } = classifyHolders([
      { command: 'node', pid: 1 },
      { command: 'AgentDeck', pid: 2 },
      { command: 'screen', pid: 3 },
      { command: 'minicom', pid: 4 },
    ]);
    expect(ours.map((h) => h.pid)).toEqual([1, 2]);
    expect(foreign.map((h) => h.command)).toEqual(['screen', 'minicom']);
  });

  it('treats an unknown holder as foreign', () => {
    // The polarity matters: an allow-list means a process AgentDeck does not
    // own is never quietly taken over. A deny-list would have to predict every
    // terminal program that can hold a TTY.
    expect(classifyHolders([{ command: 'CoolTerm', pid: 9 }]).foreign).toHaveLength(1);
  });
});

describe('SERIAL_PROBE_UNAVAILABLE', () => {
  it('names TC001, whose CH340 TX is broken in hardware', () => {
    // Running the post-write probe on this board reports a GOOD flash as a
    // failure, so the exception has to be explicit rather than discovered.
    expect(SERIAL_PROBE_UNAVAILABLE.has('ulanzi_tc001')).toBe(true);
    expect(esp32BoardById('ulanzi_tc001')?.notes.join(' ')).toMatch(/device_info_request/);
  });

  it('does not excuse any other board', () => {
    expect([...SERIAL_PROBE_UNAVAILABLE]).toEqual(['ulanzi_tc001']);
  });
});

describe('resolveFirmware', () => {
  let dir: string;
  let prev: string | undefined;
  const board = esp32BoardById('86box')!;

  const writeCache = (tag: string, bytes: Buffer, sha?: string) => {
    const cache = firmwareCacheDir(tag);
    mkdirSync(cache, { recursive: true });
    const file = `agentdeck-${board.id}-merged.bin`;
    writeFileSync(join(cache, file), bytes);
    writeFileSync(
      join(cache, 'manifest.json'),
      JSON.stringify({
        schema: 1,
        release: tag,
        firmwareVersion: tag.replace('esp32-v', ''),
        boards: [{
          id: board.id,
          chipFamily: board.chipFamily,
          flashSize: board.flashSize,
          flashMode: board.flashMode,
          flashFreq: board.flashFreq,
          uploadBaud: board.uploadBaud,
          merged: {
            file,
            size: bytes.length,
            sha256: sha ?? createHash('sha256').update(bytes).digest('hex'),
            offset: '0x0',
          },
        }],
      }),
    );
    return join(cache, file);
  };

  beforeEach(() => {
    prev = process.env.AGENTDECK_DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-fw-'));
    process.env.AGENTDECK_DATA_DIR = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTDECK_DATA_DIR;
    else process.env.AGENTDECK_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('serves a cache hit without touching the network', async () => {
    const bytes = Buffer.alloc(1024, 0xa5);
    writeCache('esp32-v1.2.3', bytes);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fw = await resolveFirmware(board, { tag: 'esp32-v1.2.3', offline: true });
    expect(fw.source).toBe('cache');
    expect(fw.image.equals(bytes)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('RE-VERIFIES the cache, because a cache key proves provenance and not integrity', async () => {
    const bytes = Buffer.alloc(1024, 0xa5);
    const path = writeCache('esp32-v1.2.3', bytes);
    // Flip one byte, exactly like bit-rot on disk would. A bit-rotted cached
    // image is a bricked board, so a hit is not the same as trustworthy.
    const rotted = Buffer.from(bytes);
    rotted[500] ^= 0xff;
    writeFileSync(path, rotted);
    await expect(resolveFirmware(board, { tag: 'esp32-v1.2.3', offline: true }))
      .rejects.toThrow(/--offline/); // offline cannot re-download, so it refuses
  });

  it('refuses a manifest whose hash does not describe its file', async () => {
    const bytes = Buffer.alloc(64, 1);
    writeCache('esp32-v1.2.3', bytes, 'deadbeef'.repeat(8));
    await expect(resolveFirmware(board, { tag: 'esp32-v1.2.3', offline: true }))
      .rejects.toThrow(/--offline/);
  });

  it('takes the tag from a checkout config.h when none is given', async () => {
    writeCache('esp32-v4.5.6', Buffer.alloc(8, 3));
    const fw = await resolveFirmware(board, {
      offline: true,
      checkoutConfigH: 'constexpr const char* FIRMWARE_VERSION = "4.5.6";',
    });
    expect(fw.tag).toBe('esp32-v4.5.6');
  });

  it('an explicit --firmware bypasses the manifest and SAYS it is unverified', async () => {
    const p = join(dir, 'hand-built.bin');
    writeFileSync(p, Buffer.alloc(16, 7));
    const lines: string[] = [];
    const fw = await resolveFirmware(board, { firmwarePath: p, log: (m) => lines.push(m) });
    expect(fw.source).toBe('file');
    expect(fw.entry).toBeUndefined();
    // Claiming an unhashed image was verified is worse than saying nothing.
    expect(lines.join(' ')).toMatch(/no manifest hash/);
  });

  it('explains a release that publishes no merged image for the board', async () => {
    const cache = firmwareCacheDir('esp32-v0.0.1');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'manifest.json'), JSON.stringify({ schema: 1, boards: [] }));
    await expect(resolveFirmware(board, { tag: 'esp32-v0.0.1', offline: true }))
      .rejects.toThrow(/publishes no merged image/);
  });

  it('--offline fails rather than reaching the network for a tag', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(resolveFirmware(board, { offline: true })).rejects.toThrow(/--offline needs --tag/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('respects AGENTDECK_DATA_DIR for the cache', () => {
    expect(firmwareCacheDir('esp32-v1.0.0').startsWith(dir)).toBe(true);
  });
});
