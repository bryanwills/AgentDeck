/**
 * The firmware manifest and the release-notes tail rendered from it.
 *
 * Both replace hand-maintained copies whose failure mode was silence: a board
 * that did not build shipped nothing while every workflow step stayed green
 * (three boards had no firmware at all in 1.0.1), and the USB instructions
 * described a file set that could not actually bring a board up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManifest,
  boardFiles,
  MANIFEST_SCHEMA,
} from '../generate-firmware-manifest.mjs';
import { render } from '../render-esp32-release-notes.mjs';
import { parseImageInfo } from '../esp32-merge-firmware.mjs';
import {
  ESP32_BOARDS,
  ESP32_BOOTLOADER_OFFSET,
  ESP32_APP0_OFFSET,
  ESP32_PARTITION_TABLE_OFFSET,
  ESP32_BOOT_APP0_OFFSET,
// Relative, not '@agentdeck/shared': scripts/ is not a workspace package, so it
// has no dependency edge to resolve the package name through.
} from '../../shared/src/esp32-boards.js';

let dir: string;

const opts = () => ({
  boards: ESP32_BOARDS,
  dir,
  tag: 'esp32-v9.9.9',
  generatedAt: '2026-08-22T00:00:00.000Z',
  offsets: ESP32_BOOTLOADER_OFFSET,
  appOffset: ESP32_APP0_OFFSET,
  partOffset: ESP32_PARTITION_TABLE_OFFSET,
  bootApp0Offset: ESP32_BOOT_APP0_OFFSET,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fw-manifest-'));
  mkdirSync(dir, { recursive: true });
  for (const b of ESP32_BOARDS) {
    for (const name of Object.values(boardFiles(b))) {
      writeFileSync(join(dir, name), `stand-in for ${name}`);
    }
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('firmware manifest', () => {
  it('describes every board in the SSOT', () => {
    const m = buildManifest(opts());
    expect(m.schema).toBe(MANIFEST_SCHEMA);
    expect(m.release).toBe('esp32-v9.9.9');
    expect(m.firmwareVersion).toBe('9.9.9');
    expect(m.boards.map((b: { id: string }) => b.id)).toEqual(ESP32_BOARDS.map((b) => b.id));
  });

  it('points every consumer at one file and one offset', () => {
    // The merged image exists so no consumer has to know that the bootloader
    // offset is 0x1000 on ESP32, 0x2000 on ESP32-P4 and 0x0 elsewhere.
    for (const b of buildManifest(opts()).boards) {
      expect(b.merged.offset, b.id).toBe('0x0');
    }
  });

  it('computes hashes from the artifacts, not from the SSOT', () => {
    const m = buildManifest(opts());
    // Distinct stand-in contents must produce distinct hashes; a manifest that
    // reported a constant would look identical here if it copied a field.
    const hashes = m.boards.map((b: { merged: { sha256: string } }) => b.merged.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const b of m.boards) expect(b.merged.size).toBeGreaterThan(0);
  });

  it('fails the release when a board ships nothing', () => {
    const gone = join(dir, boardFiles(ESP32_BOARDS[0]).merged);
    rmSync(gone);
    try {
      expect(() => buildManifest(opts())).toThrow(/missing/i);
    } finally {
      writeFileSync(gone, 'restored');
    }
  });

  it('carries the web-flash evidence, not just a flag', () => {
    for (const b of buildManifest(opts()).boards) {
      if (b.webFlash) expect(b.webFlashVerified.trim(), b.id).not.toBe('');
    }
  });
});

describe('release notes tail', () => {
  it('tells people to write the merged image at 0x0, not the app at 0x10000', () => {
    const out = render(buildManifest(opts()));
    expect(out).toContain('write-flash 0x0 agentdeck-<board>-merged.bin');
    // The old instruction wrote the application alone, leaving boot_app0 (and
    // therefore otadata) pointing at whichever slot a previous OTA chose — so a
    // freshly written app0 could come up running the OLD firmware.
    expect(out).not.toContain('write_flash 0x10000');
  });

  it('lists every board that built', () => {
    const out = render(buildManifest(opts()));
    for (const b of ESP32_BOARDS) expect(out, b.id).toContain(`agentdeck-${b.id}-merged.bin`);
  });

  it('marks a board browser-flashable only when the SSOT says so', () => {
    const out = render(buildManifest(opts()));
    const line = out.split('\n').find((l) => l.includes('| `agentdeck-ips_10-merged.bin` |'));
    // ips_10 is `blocked`: it enters download mode but its serial TX is down,
    // measured with esptool.py as well, so it must not be offered.
    expect(line).toMatch(/\|\s*no\s*\|$/);
  });
});

describe('merged image self-check', () => {
  it('parses the fields esptool image-info prints', () => {
    // Verbatim from `esptool image-info` v5.1.2 against a real merged image.
    const sample = [
      'Image size: 4109776 bytes',
      'Image version: 1',
      'Flash freq: 80m',
      'Flash mode: DIO',
      'Flash size: 16MB',
      'Chip ID: 9 (ESP32-S3)',
    ].join('\n');
    expect(parseImageInfo(sample)).toEqual({
      flashSize: '16MB',
      flashFreq: '80m',
      flashMode: 'DIO',
      chipId: 9,
    });
  });
});
