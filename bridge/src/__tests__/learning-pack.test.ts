import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  bundledLearningPackDirectory,
  loadLearningPack,
  matchesLearningPackRequest,
  validateLearningPack,
} from '../learning-pack.js';

describe('Surface learning pack', () => {
  it('loads the bundled licensed PDLP and verifies both digest layers', () => {
    const pack = loadLearningPack();
    expect(pack.advert).toEqual({
      id: 'jp-n3-ko',
      version: 2,
      format: 1,
      size: 568_324,
      md5: '95ce0ba2fef9d1f5b7555a35ed5e903b',
      licenseSpdx: 'CC-BY-SA-4.0',
    });
    expect(pack.attribution).toContain('OpenJLPT');
    expect(pack.bytes.subarray(0, 4).toString('ascii')).toBe('PDLP');
    expect(pack.bytes.readUInt32LE(12)).toBe(612);
  });

  it('rejects a payload changed after the manifest was authored', () => {
    const directory = bundledLearningPackDirectory();
    const manifest = readFileSync(join(directory, 'jp-n3-ko.manifest.json'));
    const bytes = Buffer.from(readFileSync(join(directory, 'jp-n3-ko.pdl')));
    bytes[bytes.length - 1] ^= 0x01;
    expect(() => validateLearningPack(manifest, bytes)).toThrow(/MD5/);
  });

  it('rejects an unapproved content licence before serving bytes', () => {
    const directory = bundledLearningPackDirectory();
    const manifest = JSON.parse(readFileSync(
      join(directory, 'jp-n3-ko.manifest.json'), 'utf8',
    )) as Record<string, unknown>;
    const advert = manifest.learningPack as Record<string, unknown>;
    advert.licenseSpdx = 'LicenseRef-Proprietary';
    const bytes = readFileSync(join(directory, 'jp-n3-ko.pdl'));
    expect(() => validateLearningPack(Buffer.from(JSON.stringify(manifest)), bytes))
      .toThrow(/unsupported licence/);
  });

  it('keeps the Node package and signed Apple bundle resources byte-identical', () => {
    const directory = bundledLearningPackDirectory();
    const appleDirectory = resolve(directory, '../../../apple/AgentDeck/Resources/Learning');
    for (const name of [
      'jp-n3-ko.pdl', 'jp-n3-ko.manifest.json', 'LICENSE-CC-BY-SA-4.0.txt', 'NOTICE.md',
    ]) {
      expect(readFileSync(join(appleDirectory, name))).toEqual(readFileSync(join(directory, name)));
    }
  });

  it('serves only the exact id and advertised version', () => {
    const pack = loadLearningPack();
    expect(matchesLearningPackRequest(pack, 'jp-n3-ko', '2')).toBe(true);
    expect(matchesLearningPackRequest(pack, 'jp-n3-ko', '02')).toBe(false);
    expect(matchesLearningPackRequest(pack, 'jp-n3-ko', '1')).toBe(false);
    expect(matchesLearningPackRequest(pack, '../jp-n3-ko', '2')).toBe(false);
  });
});
