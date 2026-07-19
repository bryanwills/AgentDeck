#!/usr/bin/env node

// Ulanzi Studio Marketplace media, per the asset requirements stated in the
// upload form at https://ugc.ulanzistudio.com (작품 업로드):
//
//   - Cover image  — REQUIRED, 2:1
//   - Banner 01    — REQUIRED, 3:2   (detail-page carousel + featured slots)
//   - Banner 02/03 — optional, 3:2
//   - Main file    — .zip, max 50 MB per file
//
// The portal states only aspect ratios and crops on upload, so the pixel sizes
// below are ours. Both are composed on an ink-tide canvas with the device photo
// placed near its native scale rather than upscaled to fill, since the D200H
// source is 1400x800.
//
// Source imagery is deliberately D200H-only. docs/media/hardware-d200h-tc001-closeup.png
// has far more resolution but frames the D200H beside an Elgato Stream Deck —
// not something to lead with on Ulanzi's own storefront.

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'marketplace/ulanzi/1.0.0');
const media = resolve(root, 'docs/media');
const brandIcon = resolve(root, 'design/brand/agentdeck-icon.png');

// design/tokens.css — ink-900 canvas, tide-50 type, kelp-300 accent.
const INK_900 = '#0e1f1f';
const INK_800 = '#15302f';
const TIDE_50 = '#f5f3ec';
const KELP_300 = '#6fb6a8';

await mkdir(out, { recursive: true });

const FONT = 'IBM Plex Sans, -apple-system, BlinkMacSystemFont, sans-serif';

/** Ink-tide backdrop with a soft radial lift behind the device. */
const backdrop = (w, h) =>
  Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="lift" cx="0.68" cy="0.52" r="0.62">
          <stop offset="0" stop-color="${INK_800}"/>
          <stop offset="1" stop-color="${INK_900}"/>
        </radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#lift)"/>
    </svg>
  `);

// A drop shadow is invisible against the ink canvas, so the photo is separated
// from the background with a hairline instead.
const edge = (w, h, x, y, dw, dh) =>
  Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${dw}" height="${dh}" fill="none"
            stroke="${KELP_300}" stroke-opacity="0.34" stroke-width="3"/>
    </svg>
  `);

async function device(width) {
  return sharp(resolve(media, 'd200h.jpg'))
    // Trim the desk clutter at the frame edges down to the deck body itself.
    .extract({ left: 40, top: 20, width: 1320, height: 760 })
    .resize(width, null)
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------- cover (2:1)
{
  const W = 1920;
  const H = 960;
  const dw = 1000;
  const dh = Math.round((760 / 1320) * dw);
  const dx = W - dw - 90;
  const dy = Math.round((H - dh) / 2);

  const text = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="110" y="452" fill="${TIDE_50}" font-family="${FONT}" font-size="96" font-weight="700">AgentDeck</text>
      <text x="114" y="530" fill="${KELP_300}" font-family="${FONT}" font-size="38" font-weight="500">Stop Chatting. Start Steering.</text>
      <text x="114" y="596" fill="${TIDE_50}" font-family="${FONT}" font-size="27" opacity="0.82">Claude Code · Codex · OpenCode · OpenClaw</text>
    </svg>
  `);

  await sharp(backdrop(W, H))
    .composite([
      { input: await device(dw), left: dx, top: dy },
      { input: edge(W, H, dx, dy, dw, dh) },
      { input: text },
      { input: await sharp(brandIcon).resize(150, 150).png().toBuffer(), left: 110, top: 208 },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(resolve(out, 'cover-1920x960.jpg'));
}

// ------------------------------------------------------------ banner 01 (3:2)
{
  const W = 1920;
  const H = 1280;
  const dw = 1430;
  const dh = Math.round((760 / 1320) * dw);
  const dx = Math.round((W - dw) / 2);
  const dy = 350;

  const text = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="176" fill="${TIDE_50}" font-family="${FONT}" font-size="76" font-weight="700" text-anchor="middle">Your agents, on the D200H</text>
      <text x="${W / 2}" y="252" fill="${KELP_300}" font-family="${FONT}" font-size="36" font-weight="500" text-anchor="middle">Live session keys that reflow by agent state</text>
    </svg>
  `);

  await sharp(backdrop(W, H))
    .composite([
      { input: await device(dw), left: dx, top: dy },
      { input: edge(W, H, dx, dy, dw, dh) },
      { input: text },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(resolve(out, 'banner-01-1920x1280.jpg'));
}

// ------------------------------------------------------------ banner 02 (3:2)
// A tight crop of the 4032x3024 closeup around the D200H alone. The wider
// desk shot was rejected for this slot: it renders the D200H as a small dark
// strip while an Elgato Stream Deck reads as the most legible device in frame,
// which is not what belongs on Ulanzi's storefront.
{
  const W = 1920;
  const H = 1280;

  const text = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${INK_900}" stop-opacity="0.92"/>
          <stop offset="0.30" stop-color="${INK_900}" stop-opacity="0.58"/>
          <stop offset="0.58" stop-color="${INK_900}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#scrim)"/>
      <text x="110" y="1108" fill="${TIDE_50}" font-family="${FONT}" font-size="66" font-weight="700">Usage and limits at a glance</text>
      <text x="114" y="1176" fill="${KELP_300}" font-family="${FONT}" font-size="33" font-weight="500">Session keys, agent creatures, and quota gauges on one deck</text>
    </svg>
  `);

  await sharp(resolve(media, 'hardware-d200h-tc001-closeup.png'))
    .extract({ left: 1860, top: 1700, width: 1380, height: 920 })
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .composite([{ input: text }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(resolve(out, 'banner-02-1920x1280.jpg'));
}

console.log(`Generated Ulanzi Marketplace media in ${out}`);
