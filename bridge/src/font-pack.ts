/** Licensed, immutable SD font-pack distribution for portable readers. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SurfaceFontPackAdvert } from '@agentdeck/shared';

export const POCKET_DAILY_FONT_PACK_ID = 'pocket-sans-world' as const;
export const FONT_PACK_FORMAT = 4 as const;
export const FONT_PACK_MAX_BYTES = 14 * 1024 * 1024;

export interface SurfaceFontPack {
  advert: SurfaceFontPackAdvert;
  attribution: string;
  bytes: Buffer;
}

interface FontPackManifest {
  fontPack?: Partial<SurfaceFontPackAdvert> & { sha256?: unknown };
  attribution?: unknown;
  sources?: Array<{
    name?: unknown;
    url?: unknown;
    revision?: unknown;
    licenseSpdx?: unknown;
    attribution?: unknown;
  }>;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateFontPack(manifestBytes: Buffer, fontBytes: Buffer): SurfaceFontPack {
  let manifest: FontPackManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as FontPackManifest;
  } catch {
    throw new Error('font pack manifest is not valid JSON');
  }
  const advert = manifest.fontPack;
  if (!advert || advert.id !== POCKET_DAILY_FONT_PACK_ID
    || !Number.isSafeInteger(advert.version) || Number(advert.version) <= 0
    || advert.format !== FONT_PACK_FORMAT
    || !Number.isSafeInteger(advert.size) || Number(advert.size) <= 0
    || Number(advert.size) > FONT_PACK_MAX_BYTES
    || !nonEmpty(advert.md5) || !/^[0-9a-f]{32}$/.test(advert.md5)
    || advert.licenseSpdx !== 'OFL-1.1'
    || !nonEmpty(advert.sha256) || !/^[0-9a-f]{64}$/.test(advert.sha256)) {
    throw new Error('font pack advert is invalid or uses an unsupported licence');
  }
  if (!nonEmpty(manifest.attribution) || !Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('font pack attribution and source ledger are required');
  }
  for (const source of manifest.sources) {
    if (!nonEmpty(source.name) || !nonEmpty(source.url) || !nonEmpty(source.revision)
      || source.licenseSpdx !== 'OFL-1.1' || !nonEmpty(source.attribution)) {
      throw new Error('font pack source ledger entry is incomplete or unlicensed');
    }
  }
  if (fontBytes.length !== advert.size || fontBytes.length < 64
    || fontBytes.toString('ascii', 0, 6) !== 'CPFONT'
    || fontBytes.readUInt16LE(8) !== FONT_PACK_FORMAT
    || fontBytes[12] === 0 || fontBytes[12] > 4) {
    throw new Error('font pack size or cpfont header is incompatible');
  }
  if (createHash('md5').update(fontBytes).digest('hex') !== advert.md5) {
    throw new Error('font pack MD5 does not match its manifest');
  }
  if (createHash('sha256').update(fontBytes).digest('hex') !== advert.sha256) {
    throw new Error('font pack SHA-256 does not match its manifest');
  }
  return {
    advert: {
      id: advert.id,
      version: Number(advert.version),
      format: Number(advert.format),
      size: Number(advert.size),
      md5: advert.md5,
      licenseSpdx: advert.licenseSpdx,
    },
    attribution: manifest.attribution,
    bytes: fontBytes,
  };
}

export function bundledFontPackDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
}

export function loadFontPack(directory = bundledFontPackDirectory()): SurfaceFontPack {
  return validateFontPack(
    readFileSync(join(directory, `${POCKET_DAILY_FONT_PACK_ID}.manifest.json`)),
    readFileSync(join(directory, 'PocketSansWorld_12.cpfont')),
  );
}

export function matchesFontPackRequest(
  pack: SurfaceFontPack,
  id: string | null,
  version: string | null,
): boolean {
  if (id !== pack.advert.id || version === null || !/^[1-9][0-9]*$/.test(version)) return false;
  const parsed = Number(version);
  return Number.isSafeInteger(parsed) && parsed === pack.advert.version;
}
