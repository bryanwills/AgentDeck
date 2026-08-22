#!/usr/bin/env node
// Render the ESP32 release-notes tail from the firmware manifest.
//
//   node scripts/render-esp32-release-notes.mjs firmware/manifest.json > firmware-detail.md
//
// Rendered from the manifest rather than hand-written so the table cannot
// disagree with what actually shipped — the same reason the previous table was
// built from per-board artifacts instead of a second checked-in list.
//
// It also replaces the old USB instructions, which were incomplete in a way
// that quietly bricks or no-ops:
//   `esptool.py write_flash 0x10000 agentdeck-<board>.bin`
// wrote the app alone, leaving boot_app0/otadata pointing at whichever slot an
// earlier OTA chose, and said nothing about the bootloader offset — which is
// chip-specific and spans THREE values across this fleet.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function render(manifest) {
  const web = manifest.boards.filter((b) => b.webFlash);
  const rows = [...manifest.boards].sort((a, b) => a.name.localeCompare(b.name));

  const lines = [];
  lines.push(
    'Firmware for every board this repository builds. Each asset is named by the',
    "board's **canonical id** — the same string the firmware reports as",
    '`device_info.board` and the one `agentdeck esp32-ota <target>` takes, so the',
    'file you download is the target you pass.',
    '',
    '| Board | Factory image | Display | PlatformIO env | Wi-Fi OTA | Browser flash |',
    '|---|---|---|---|---|---|',
  );
  for (const b of rows) {
    const badge =
      b.webFlashStatus === 'verified'
        ? 'yes'
        : b.webFlashStatus === 'verified-partial'
          ? 'yes*'
          : b.webFlashStatus === 'blocked'
            ? 'no'
            : 'untested';
    lines.push(
      `| ${b.name} | \`${b.merged.file}\` | ${b.display} | \`${b.env}\` | ${b.ota ? 'yes' : 'no'} | ${badge} |`,
    );
  }
  lines.push(
    '',
    '### Flash over USB',
    '',
    'Each board ships a **merged factory image** — one file, written at one offset,',
    'on every chip:',
    '',
    '```bash',
    'esptool --port PORT write-flash 0x0 agentdeck-<board>-merged.bin',
    '```',
    '',
    'The merged image already carries the bootloader, the partition table,',
    '`boot_app0` and the application, with the flash size and mode patched into its',
    'header. That matters: the bootloader offset is chip-specific (0x1000 on ESP32,',
    '0x2000 on ESP32-P4, 0x0 elsewhere), and writing the application alone leaves',
    '`boot_app0` pointing at whichever slot a previous OTA selected — so the board',
    'can come up running the OLD firmware. The loose `-bootloader.bin`,',
    '`-partitions.bin`, `-boot_app0.bin` and `-<board>.bin` files are still',
    'published for recovery work; prefer the merged image.',
    '',
    '`manifest.json` carries the same facts in machine-readable form (offsets,',
    'sha256, per-board reset/baud settings). `SHA256SUMS.txt` covers every binary.',
    '',
    '### Update over Wi-Fi',
    '',
    '```bash',
    'agentdeck esp32-ota <board> --firmware agentdeck-<board>.bin',
    '```',
    '',
    'The board must already be provisioned and connected to the daemon over Wi-Fi.',
    '`86box` and `ips_10` units flashed before 2026-07-05 may still carry a',
    'factory/NO_OTA layout and need one USB full flash first.',
  );

  if (web.length) {
    lines.push(
      '',
      '### Flash from a browser',
      '',
      `${web.length} of ${manifest.boards.length} boards are hardware-verified for browser flashing`,
      '(Chrome or Edge on desktop, via Web Serial). Boards marked `untested` are listed',
      'there too, disabled, with the reason — a hidden board reads as unsupported.',
    );
    const partial = web.filter((b) => b.webFlashStatus === 'verified-partial');
    if (partial.length) {
      lines.push(
        '',
        `\`*\` ${partial.map((b) => b.name).join(', ')}: connects, but a guard is degraded — see the manifest's \`webFlashVerified\`.`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: render-esp32-release-notes.mjs <manifest.json>');
    process.exit(2);
  }
  process.stdout.write(render(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
