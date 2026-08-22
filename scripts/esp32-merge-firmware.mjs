#!/usr/bin/env node
// Build one board's merged factory image and prove its header is right.
//
//   node scripts/esp32-merge-firmware.mjs --board 86box \
//        --build-dir esp32/.pio/build/box_86 --boot-app0 <path> --out dist
//
// WHY A MERGED IMAGE. The release publishes bootloader/partitions/app as three
// loose files and the notes tell people to write the app alone at 0x10000. That
// is not enough to bring up a board:
//   - boot_app0 (0xe000) is not published at all, so otadata left pointing at
//     app1 by an earlier OTA makes a freshly written app0 boot the OLD image;
//   - the bootloader offset is chip-specific and this fleet spans THREE values
//     (ESP32 0x1000, ESP32-P4 0x2000, everything else 0x0) — none documented;
//   - flash size must be stated or the header is wrong (a 4MB default leaves
//     TC001's bootloader misbehaving; IPS 3.5" misdetects 8MB during a bootloop).
// One image at one offset removes all four hazards from every consumer at once.
//
// WHY --target-offset 0x0 EVEN FOR ESP32 CLASSIC. The classic bootloader still
// lands at 0x1000 inside the image and merge-bin pads 0x0..0x1000 with 0xFF,
// which the ROM never reads. The browser and the CLI then both write one file
// at one offset with no per-chip branch.
//
// The self-check is not optional: merge-bin PATCHES the flash parameters into
// the bootloader copy inside the output, so the only way to know the header is
// right is to read it back out of the merged file. Note it must be read at the
// bootloader offset — `image-info` on a classic merged image starts on 0xFF
// padding and fails with "invalid magic number: 0xff".

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESPTOOL = process.env.ESPTOOL || 'esptool';

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && !v) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return v;
}

function run(args, label) {
  const r = spawnSync(ESPTOOL, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`${label}: ${ESPTOOL} not runnable — ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} failed:\n${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

/**
 * boot_app0 is the one input that does NOT live in .pio/build — it ships inside
 * the Arduino framework package, which is why the release's copy step could
 * never have picked it up. The path carries a version, so it is globbed; zero
 * or many matches is a hard error rather than a guess.
 */
export function findBootApp0(packagesDir) {
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir)
    .filter((d) => d.startsWith('framework-arduinoespressif32'))
    .map((d) => path.join(packagesDir, d, 'tools/partitions/boot_app0.bin'))
    .filter((p) => fs.existsSync(p));
}

/** Parse the `Flash size: / Flash mode: / Chip ID:` block out of image-info. */
export function parseImageInfo(text) {
  const grab = (re) => re.exec(text)?.[1]?.trim();
  return {
    flashSize: grab(/^Flash size:\s*(\S+)/m),
    flashFreq: grab(/^Flash freq:\s*(\S+)/m),
    flashMode: grab(/^Flash mode:\s*(\S+)/m),
    chipId: Number(grab(/^Chip ID:\s*(\d+)/m)),
  };
}

async function main() {
  const {
    ESP32_BOARDS,
    ESP32_ESPTOOL_CHIP,
    ESP32_IMAGE_CHIP_ID,
    ESP32_PARTITION_TABLE_OFFSET,
    ESP32_BOOT_APP0_OFFSET,
    ESP32_APP0_OFFSET,
  } = await import('../shared/dist/esp32-boards.js');

  const boardId = arg('board');
  const buildDir = arg('build-dir');
  const outDir = arg('out');
  let bootApp0 = arg('boot-app0', false);

  const board = ESP32_BOARDS.find((b) => b.id === boardId);
  if (!board) throw new Error(`unknown board "${boardId}"`);

  if (!bootApp0) {
    const found = findBootApp0(
      process.env.PLATFORMIO_CORE_DIR
        ? path.join(process.env.PLATFORMIO_CORE_DIR, 'packages')
        : path.join(process.env.HOME ?? '', '.platformio/packages'),
    );
    if (found.length !== 1) {
      throw new Error(
        `boot_app0.bin: expected exactly one match, found ${found.length}${found.length ? `:\n  ${found.join('\n  ')}` : ''}. ` +
          'Pass --boot-app0 explicitly. Merging without it leaves stale otadata, which boots the previous slot.',
      );
    }
    bootApp0 = found[0];
  }

  for (const f of ['bootloader.bin', 'partitions.bin', 'firmware.bin']) {
    const p = path.join(buildDir, f);
    if (!fs.existsSync(p)) throw new Error(`${boardId}: missing ${p}`);
  }
  if (!fs.existsSync(bootApp0)) throw new Error(`${boardId}: missing boot_app0 at ${bootApp0}`);

  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `agentdeck-${board.id}-merged.bin`);
  const chip = ESP32_ESPTOOL_CHIP[board.chipFamily];

  run(
    [
      '--chip', chip, 'merge-bin',
      '--output', out,
      '--flash-mode', board.flashMode,
      '--flash-freq', board.flashFreq,
      '--flash-size', board.flashSize,
      '--target-offset', '0x0',
      `0x${board.bootloaderOffset.toString(16)}`, path.join(buildDir, 'bootloader.bin'),
      `0x${ESP32_PARTITION_TABLE_OFFSET.toString(16)}`, path.join(buildDir, 'partitions.bin'),
      `0x${ESP32_BOOT_APP0_OFFSET.toString(16)}`, bootApp0,
      `0x${ESP32_APP0_OFFSET.toString(16)}`, path.join(buildDir, 'firmware.bin'),
    ],
    `${boardId} merge-bin`,
  );

  // Read the header back OUT of the merged file, at the bootloader offset.
  const merged = fs.readFileSync(out);
  const header = merged.subarray(board.bootloaderOffset, ESP32_PARTITION_TABLE_OFFSET);
  const tmp = path.join(outDir, `.${board.id}-header.bin`);
  fs.writeFileSync(tmp, header);
  const info = parseImageInfo(run(['image-info', tmp], `${boardId} image-info`));
  fs.unlinkSync(tmp);

  const wrong = [];
  if (info.flashSize !== board.flashSize) wrong.push(`flash size ${info.flashSize} != ${board.flashSize}`);
  if (info.flashFreq !== board.flashFreq) wrong.push(`flash freq ${info.flashFreq} != ${board.flashFreq}`);
  if ((info.flashMode ?? '').toLowerCase() !== board.flashMode) wrong.push(`flash mode ${info.flashMode} != ${board.flashMode}`);
  if (info.chipId !== ESP32_IMAGE_CHIP_ID[board.chipFamily]) {
    wrong.push(`chip id ${info.chipId} != ${ESP32_IMAGE_CHIP_ID[board.chipFamily]} (${board.chipFamily})`);
  }
  if (wrong.length) {
    throw new Error(
      `${boardId}: merged image header disagrees with the SSOT — ${wrong.join('; ')}. ` +
        'An image whose header claims the wrong geometry is exactly what bricks a board.',
    );
  }

  console.log(
    `${board.id}: ${path.basename(out)} ${merged.length} bytes · ${info.chipId}/${info.flashSize}/${info.flashMode}/${info.flashFreq} verified`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
