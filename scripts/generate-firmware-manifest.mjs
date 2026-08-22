#!/usr/bin/env node
// Emit the machine-readable firmware manifest for an esp32-v* release.
//
//   node scripts/generate-firmware-manifest.mjs <dir> --tag esp32-v1.0.7 > manifest.json
//
// Two consumers read this: the browser flasher at /flash/ and
// `agentdeck esp32 flash <board>`. Both need to know, per board, which single
// file to write and whether it is safe to write it — so the manifest carries
// the geometry AND the `webFlash` evidence, not just a file list.
//
// sha256 and size are computed from the ARTIFACTS, never copied from the SSOT.
// A hash that was not computed from the file it describes is a lie that stays
// green until the day it matters.
//
// A board in the SSOT with missing files is a hard failure. The release
// workflow's current failure mode is the opposite — a board that does not build
// simply ships nothing and no step turns red, which is how three boards had no
// firmware at all in 1.0.1.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MANIFEST_SCHEMA = 1;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Files each board must have published, keyed by the role the flasher needs. */
export function boardFiles(board) {
  return {
    merged: `agentdeck-${board.id}-merged.bin`,
    app: `agentdeck-${board.id}.bin`,
    bootloader: `agentdeck-${board.id}-bootloader.bin`,
    partitions: `agentdeck-${board.id}-partitions.bin`,
    bootApp0: `agentdeck-${board.id}-boot_app0.bin`,
  };
}

export function buildManifest({ boards, dir, tag, generatedAt, offsets, appOffset, partOffset, bootApp0Offset }) {
  const missing = [];
  const entries = boards.map((b) => {
    const files = boardFiles(b);
    const stat = (name) => {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) {
        missing.push(`${b.id}: ${name}`);
        return undefined;
      }
      return { file: name, size: fs.statSync(p).size, sha256: sha256(p) };
    };
    const merged = stat(files.merged);
    const parts = [
      { ...stat(files.bootloader), offset: `0x${b.bootloaderOffset.toString(16)}` },
      { ...stat(files.partitions), offset: `0x${partOffset.toString(16)}` },
      { ...stat(files.bootApp0), offset: `0x${bootApp0Offset.toString(16)}` },
      { ...stat(files.app), offset: `0x${appOffset.toString(16)}` },
    ];
    return {
      id: b.id,
      env: b.env,
      name: b.name,
      display: b.display,
      aliases: b.aliases,
      chipFamily: b.chipFamily,
      flashSize: b.flashSize,
      flashMode: b.flashMode,
      flashFreq: b.flashFreq,
      // Audit field. Consumers write `merged` at 0x0 and never branch on this —
      // the whole point of the merged image is that they do not have to know.
      bootloaderOffset: `0x${b.bootloaderOffset.toString(16)}`,
      uploadBaud: b.uploadBaud,
      esptoolFlags: b.esptoolFlags,
      resetBefore: b.before,
      resetAfter: b.after,
      stub: b.stub,
      nativeUsb: b.nativeUsb,
      ota: b.ota,
      webFlash: b.webFlash,
      webFlashStatus: b.webFlashStatus,
      webFlashVerified: b.webFlashVerified,
      notes: b.notes,
      // Written at offset 0x0 on every board, whatever the chip.
      merged: merged ? { ...merged, offset: '0x0' } : undefined,
      parts,
    };
  });

  if (missing.length) {
    throw new Error(
      `firmware manifest: ${missing.length} artifact(s) missing — a board that ships nothing must fail the release, not pass quietly:\n  ` +
        missing.join('\n  '),
    );
  }

  return {
    schema: MANIFEST_SCHEMA,
    release: tag,
    firmwareVersion: tag.replace(/^esp32-v/, ''),
    generatedAt,
    offsets: {
      merged: '0x0',
      partitionTable: `0x${partOffset.toString(16)}`,
      bootApp0: `0x${bootApp0Offset.toString(16)}`,
      app0: `0x${appOffset.toString(16)}`,
      bootloaderByChip: Object.fromEntries(
        Object.entries(offsets).map(([k, v]) => [k, `0x${v.toString(16)}`]),
      ),
    },
    boards: entries,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = process.argv[2];
  const tagIdx = process.argv.indexOf('--tag');
  const tag = tagIdx >= 0 ? process.argv[tagIdx + 1] : undefined;
  if (!dir || !tag) {
    console.error('usage: generate-firmware-manifest.mjs <dir> --tag esp32-v<x.y.z>');
    process.exit(2);
  }
  const m = await import('../shared/dist/esp32-boards.js');
  try {
    const manifest = buildManifest({
      boards: m.ESP32_BOARDS,
      dir,
      tag,
      generatedAt: new Date().toISOString(),
      offsets: m.ESP32_BOOTLOADER_OFFSET,
      appOffset: m.ESP32_APP0_OFFSET,
      partOffset: m.ESP32_PARTITION_TABLE_OFFSET,
      bootApp0Offset: m.ESP32_BOOT_APP0_OFFSET,
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
