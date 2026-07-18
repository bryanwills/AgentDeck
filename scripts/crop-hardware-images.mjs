#!/usr/bin/env node
// One-off asset prep: crop raw hardware photos into the Devices catalog card frames.
//
//   node scripts/crop-hardware-images.mjs [sourceDir]
//
// The multi-MB originals are not committed; only the cropped results under
// docs/media/ are. The table below records which original each shipped image
// came from, so a re-crop stays reproducible while the originals exist.
//
// CRITICAL: `.rotate()` with NO argument applies the EXIF orientation tag. Many
// iPhone captures here are orientation 6 — the stored buffer is 4032x3024 while
// the photo is really 3024x4032 portrait. Crop coordinates below are in DISPLAY
// space (post-EXIF), so rotate() must run before extract(). Passing an explicit
// angle instead skips EXIF handling and crops from the wrong buffer entirely.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = process.argv[2] || path.join(process.env.HOME, 'Desktop/agentdeck-0719');
const destDir = path.join(__dirname, '../docs/media');

// Output frames. Keep in sync with the .shot aspect rules in docs/hardware/index.html.
const STANDARD = { width: 1400, height: 800 }; // 1.75:1 — single-column device card
const WIDE = { width: 2240, height: 600 }; //     3.73:1 — .device.wide card
const HERO = { width: 2400, height: 1350 }; //    16:9   — README hero

const tasks = [
  // --- Control decks ---
  { name: 'streamdeck-plus.jpg', src: 'IMG_9703.jpeg', crop: { left: 0, top: 252, width: 4032, height: 1081 }, out: WIDE },
  { name: 'd200h.jpg', src: 'IMG_9701.jpeg', crop: { left: 0, top: 288, width: 4032, height: 2304 }, out: STANDARD },

  // --- Apps ---
  { name: 'ipad.jpg', src: 'IMG_9691.jpeg', crop: { left: 108, top: 350, width: 3816, height: 2181 }, out: STANDARD },
  { name: 'android-tablet.jpg', src: 'IMG_9695.jpeg', crop: { left: 252, top: 448, width: 3600, height: 2057 }, out: STANDARD },
  { name: 'android-eink.jpg', src: 'IMG_9707.jpeg', crop: { left: 464, top: 559, width: 3132, height: 1790 }, out: STANDARD },

  // --- ESP32 displays ---
  { name: 'ips35.jpg', src: 'IMG_9704.jpeg', crop: { left: 0, top: 1255, width: 3024, height: 1728 }, out: STANDARD },
  { name: 'box86.jpg', src: 'IMG_9706.jpeg', crop: { left: 0, top: 1404, width: 3024, height: 1728 }, out: STANDARD },
  { name: 'round-amoled.jpg', src: 'IMG_9705.jpeg', crop: { left: 0, top: 1549, width: 2800, height: 1600 }, out: STANDARD },
  { name: 'ttgo.jpg', src: 'IMG_9702.jpeg', crop: { left: 320, top: 1565, width: 2600, height: 1486 }, out: STANDARD },
  { name: 'ips10.jpg', src: 'IMG_9696.jpeg', crop: { left: 140, top: 374, width: 3780, height: 2160 }, out: STANDARD },
  { name: 'inkdeck.jpg', src: 'IMG_9708.jpeg', crop: { left: 684, top: 653, width: 2880, height: 1646 }, out: STANDARD },
  { name: 'xteink.jpg', src: 'IMG_9682.jpeg', crop: { left: 0, top: 220, width: 4032, height: 2304 }, out: STANDARD },

  // --- Pixel displays ---
  { name: 'pixoo64.jpg', src: 'IMG_9700.jpeg', crop: { left: 0, top: 1600, width: 3024, height: 1728 }, out: STANDARD },
  { name: 'idotmatrix.jpg', src: 'IMG_9697.jpeg', crop: { left: 0, top: 1242, width: 3024, height: 1728 }, out: STANDARD },
  { name: 'tc001.jpg', src: 'IMG_9698.jpeg', crop: { left: 788, top: 828, width: 2772, height: 1584 }, out: STANDARD },

  // --- README hero ---
  { name: 'setup-full.jpg', src: 'IMG_9709.jpeg', crop: { left: 0, top: 378, width: 4032, height: 2268 }, out: HERO },
];

async function run() {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  let ok = 0;
  for (const task of tasks) {
    const srcPath = path.join(sourceDir, task.src);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[crop] SKIP ${task.name} — source missing: ${srcPath}`);
      continue;
    }
    try {
      const { info } = await sharp(srcPath).rotate().toBuffer({ resolveWithObject: true });
      const { left, top, width: cw, height: ch } = task.crop;
      if (left + cw > info.width || top + ch > info.height) {
        console.warn(`[crop] SKIP ${task.name} — crop ${cw}x${ch}+${left}+${top} exceeds ${info.width}x${info.height}`);
        continue;
      }
      await sharp(srcPath)
        .rotate()
        .extract({ left, top, width: cw, height: ch })
        .resize(task.out.width, task.out.height, { fit: 'cover' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(path.join(destDir, task.name));
      console.log(`[crop] ${task.name} ← ${task.src} (${info.width}x${info.height} → ${cw}x${ch})`);
      ok += 1;
    } catch (err) {
      console.error(`[crop] FAIL ${task.name} ← ${task.src}: ${err.message}`);
    }
  }
  console.log(`[crop] ${ok}/${tasks.length} written → docs/media/`);
}

run();
