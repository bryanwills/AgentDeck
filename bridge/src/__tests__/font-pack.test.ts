import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  bundledFontPackDirectory,
  loadFontPack,
  matchesFontPackRequest,
  validateFontPack,
} from '../font-pack.js';

describe('Surface font pack', () => {
  it('loads the bundled licensed cpfont and verifies both digests', () => {
    const pack = loadFontPack();
    expect(pack.advert).toEqual({
      id: 'pocket-sans-world',
      version: 1,
      format: 4,
      size: 10_903_872,
      md5: 'a6844503c142be1a62e4bac8be7c7802',
      licenseSpdx: 'OFL-1.1',
    });
    expect(pack.attribution).toContain('Noto Sans');
    expect(pack.bytes.subarray(0, 6).toString('ascii')).toBe('CPFONT');
  });

  it('rejects a payload changed after the manifest was authored', () => {
    const directory = bundledFontPackDirectory();
    const manifest = readFileSync(join(directory, 'pocket-sans-world.manifest.json'));
    const bytes = Buffer.from(readFileSync(join(directory, 'PocketSansWorld_12.cpfont')));
    bytes[bytes.length - 1] ^= 0x01;
    expect(() => validateFontPack(manifest, bytes)).toThrow(/MD5/);
  });

  it('keeps the Node and signed Apple resources byte-identical', () => {
    const directory = bundledFontPackDirectory();
    const appleDirectory = resolve(directory, '../../../apple/AgentDeck/Resources/Fonts');
    for (const name of [
      'PocketSansWorld_12.cpfont', 'pocket-sans-world.manifest.json',
      'OFL-PocketSansWorld.txt', 'NOTICE-PocketSansWorld.md',
    ]) {
      const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
      expect(digest(join(appleDirectory, name))).toBe(digest(join(directory, name)));
    }
  });

  it('serves only the exact id and advertised version', () => {
    const pack = loadFontPack();
    expect(matchesFontPackRequest(pack, 'pocket-sans-world', '1')).toBe(true);
    expect(matchesFontPackRequest(pack, 'pocket-sans-world', '01')).toBe(false);
    expect(matchesFontPackRequest(pack, '../pocket-sans-world', '1')).toBe(false);
  });
});
