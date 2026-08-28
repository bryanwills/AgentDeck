/**
 * Licensed offline learning-pack distribution for Surface portable readers.
 *
 * The provider never authors or rewrites lesson bytes. It loads the bundled
 * manifest and pack, verifies both the public transfer digest and the internal
 * Pocket Daily disk contract, then exposes one immutable advert/body pair.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SurfaceLearningPackAdvert } from '@agentdeck/shared';

export const LEARNING_PACK_PATH = '/learning/pack' as const;
export const POCKET_DAILY_LEARNING_PACK_ID = 'jp-n3-ko' as const;
export const LEARNING_PACK_FORMAT = 1 as const;
export const LEARNING_PACK_MAX_BYTES = 16 * 1024 * 1024;

const HEADER_BYTES = 388;
const RECORD_BYTES = 928;
const ALLOWED_LICENSES = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']);

export interface SurfaceLearningPack {
  advert: SurfaceLearningPackAdvert;
  attribution: string;
  bytes: Buffer;
}

interface SourceLedgerEntry {
  name?: unknown;
  url?: unknown;
  revision?: unknown;
  licenseSpdx?: unknown;
  attribution?: unknown;
}

interface LearningPackManifest {
  learningPack?: Partial<SurfaceLearningPackAdvert>;
  attribution?: unknown;
  sources?: SourceLedgerEntry[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const fixedString = (data: Buffer, start: number, length: number): string => {
  const end = data.indexOf(0, start);
  const boundedEnd = end >= start && end < start + length ? end : start + length;
  return data.subarray(start, boundedEnd).toString('utf8');
};

const fnv32 = (data: Buffer): number => {
  let value = 0x811c9dc5;
  for (const byte of data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
};

/** Validate the manifest, transfer digest, and complete PDLP header/payload. */
export function validateLearningPack(manifestBytes: Buffer, packBytes: Buffer): SurfaceLearningPack {
  let manifest: LearningPackManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as LearningPackManifest;
  } catch {
    throw new Error('learning pack manifest is not valid JSON');
  }
  const advert = manifest.learningPack;
  if (!advert || advert.id !== POCKET_DAILY_LEARNING_PACK_ID) {
    throw new Error(`learning pack id must be ${POCKET_DAILY_LEARNING_PACK_ID}`);
  }
  if (!Number.isSafeInteger(advert.version) || Number(advert.version) <= 0
    || advert.format !== LEARNING_PACK_FORMAT
    || !Number.isSafeInteger(advert.size) || Number(advert.size) <= 0
    || Number(advert.size) > LEARNING_PACK_MAX_BYTES
    || !nonEmpty(advert.md5) || !/^[0-9a-f]{32}$/.test(advert.md5)
    || !nonEmpty(advert.licenseSpdx) || !ALLOWED_LICENSES.has(advert.licenseSpdx)) {
    throw new Error('learning pack advert is invalid or uses an unsupported licence');
  }
  if (!nonEmpty(manifest.attribution) || !Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('learning pack attribution and source ledger are required');
  }
  for (const source of manifest.sources) {
    if (!nonEmpty(source.name) || !nonEmpty(source.url) || !nonEmpty(source.revision)
      || !nonEmpty(source.licenseSpdx) || !ALLOWED_LICENSES.has(source.licenseSpdx)
      || !nonEmpty(source.attribution)) {
      throw new Error('learning pack source ledger entry is incomplete or unlicensed');
    }
  }
  if (packBytes.length !== advert.size || packBytes.length < HEADER_BYTES) {
    throw new Error('learning pack size does not match its manifest');
  }
  const transferMd5 = createHash('md5').update(packBytes).digest('hex');
  if (transferMd5 !== advert.md5) throw new Error('learning pack MD5 does not match its manifest');

  if (packBytes.toString('ascii', 0, 4) !== 'PDLP'
    || packBytes.readUInt16LE(4) !== LEARNING_PACK_FORMAT
    || packBytes.readUInt16LE(6) !== HEADER_BYTES
    || packBytes.readUInt16LE(8) !== RECORD_BYTES) {
    throw new Error('learning pack header shape is incompatible');
  }
  const recordCount = packBytes.readUInt32LE(12);
  const contentVersion = packBytes.readUInt32LE(16);
  const totalBytes = packBytes.readUInt32LE(20);
  if (recordCount === 0 || contentVersion !== advert.version || totalBytes !== packBytes.length
    || HEADER_BYTES + recordCount * RECORD_BYTES !== packBytes.length) {
    throw new Error('learning pack record count, version, or size is inconsistent');
  }
  if (fixedString(packBytes, 24, 32) !== advert.id
    || fixedString(packBytes, 120, 32) !== advert.licenseSpdx) {
    throw new Error('learning pack identity or licence differs from its manifest');
  }
  if (!fixedString(packBytes, 152, 40) || !fixedString(packBytes, 192, 160)) {
    throw new Error('learning pack internal source revision and attribution are required');
  }
  if (fnv32(packBytes.subarray(0, HEADER_BYTES - 4)) !== packBytes.readUInt32LE(HEADER_BYTES - 4)) {
    throw new Error('learning pack header checksum is invalid');
  }
  const payloadSha = createHash('sha256').update(packBytes.subarray(HEADER_BYTES)).digest();
  if (!payloadSha.equals(packBytes.subarray(352, 384))) {
    throw new Error('learning pack payload checksum is invalid');
  }

  return {
    advert: {
      id: advert.id,
      version: advert.version,
      format: advert.format,
      size: advert.size,
      md5: advert.md5,
      licenseSpdx: advert.licenseSpdx,
    },
    attribution: manifest.attribution,
    bytes: packBytes,
  };
}

export function bundledLearningPackDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'learning');
}

export function loadLearningPack(directory = bundledLearningPackDirectory()): SurfaceLearningPack {
  return validateLearningPack(
    readFileSync(join(directory, `${POCKET_DAILY_LEARNING_PACK_ID}.manifest.json`)),
    readFileSync(join(directory, `${POCKET_DAILY_LEARNING_PACK_ID}.pdl`)),
  );
}

/** Exact addressing prevents a stale advert from silently receiving different
 * bytes under the same URL. */
export function matchesLearningPackRequest(
  pack: SurfaceLearningPack,
  id: string | null,
  version: string | null,
): boolean {
  if (id !== pack.advert.id || version === null || !/^[1-9][0-9]*$/.test(version)) return false;
  const parsed = Number(version);
  return Number.isSafeInteger(parsed) && parsed === pack.advert.version;
}
