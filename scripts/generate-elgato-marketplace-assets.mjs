#!/usr/bin/env node

// Elgato Marketplace media, per https://docs.elgato.com/guidelines/products/
//
//   - App icon   — 288x288 PNG
//   - Thumbnail  — 1920x960 PNG
//   - Gallery    — 1920x960 PNG, minimum 3, max 10
//                  (video slot accepts 1920x1080 MP4 under 50 MB)
//
// The gallery shows the plugin ON Stream Deck hardware, not the Mac app. The
// previous set was built from macOS app screenshots and could not be
// regenerated at all: it read
// `apple/appstore-submission/screenshots/macOS/{01-device-preview,…}.png`,
// which moved under per-locale directories and were renamed when the App Store
// submission gained ko/ja screenshots.
//
// Sources are the 2026-07-20 captures of the shipped 1.0.0 layout. Do NOT reuse
// docs/media/hardware-d200h-tc001-closeup.png for Stream Deck imagery — its
// touch strip reads VOL / PROMPT / USAGE / VOICE, and the Voice and Prompt
// dials were removed in f20af561. It advertises features that no longer exist.
//
// Sources are modest resolution (910x548 / 794x560 app captures, 1280x960
// photos), so each is composed near native scale on an ink-tide canvas rather
// than upscaled to fill 1920x960.

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'marketplace/elgato/1.0.0');
const media = resolve(root, 'docs/media');
const brandIcon = resolve(root, 'design/brand/agentdeck-icon.png');

// design/tokens.css
const INK_900 = '#0e1f1f';
const INK_800 = '#15302f';
const TIDE_50 = '#f5f3ec';
const KELP_300 = '#6fb6a8';

const W = 1920;
const H = 960;
const FONT = 'IBM Plex Sans, -apple-system, BlinkMacSystemFont, sans-serif';

await mkdir(out, { recursive: true });

const backdrop = () =>
  Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="lift" cx="0.66" cy="0.5" r="0.66">
          <stop offset="0" stop-color="${INK_800}"/>
          <stop offset="1" stop-color="${INK_900}"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#lift)"/>
    </svg>
  `);

const caption = (title, sub) =>
  Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="104" y="404" fill="${TIDE_50}" font-family="${FONT}" font-size="62" font-weight="700">${title}</text>
      <text x="107" y="470" fill="${KELP_300}" font-family="${FONT}" font-size="30" font-weight="500">${sub}</text>
    </svg>
  `);

/** Place a source image on the right, captioned on the left. */
async function split(source, targetWidth, title, sub, file) {
  const img = await sharp(source).resize(targetWidth, null).png().toBuffer();
  const { height } = await sharp(img).metadata();
  const x = W - targetWidth - 80;
  const y = Math.round((H - height) / 2);

  await sharp(backdrop())
    .composite([
      { input: img, left: x, top: y },
      {
        input: Buffer.from(`
          <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
            <rect x="${x}" y="${y}" width="${targetWidth}" height="${height}" fill="none"
                  stroke="${KELP_300}" stroke-opacity="0.30" stroke-width="3"/>
          </svg>
        `),
      },
      { input: caption(title, sub) },
    ])
    .png()
    .toFile(resolve(out, file));
}

// ---- icon -------------------------------------------------------------------
await sharp(brandIcon).resize(288, 288).png().toFile(resolve(out, 'app-icon-288.png'));

// ---- gallery 01: session keys ----------------------------------------------
await split(
  resolve(media, 'streamdeck-keys-app.png'),
  1020,
  'Agents on your keys',
  'Running, waiting, and what just happened',
  'gallery-01-session-keys.png',
);

// ---- gallery 02: dials + touch strip ---------------------------------------
await split(
  resolve(media, 'streamdeck-plus-app.png'),
  1020,
  'Four dials, four jobs',
  'Volume · Claude usage · Codex usage · Launcher',
  'gallery-02-dials.png',
);

// ---- gallery 03: real hardware ---------------------------------------------
// No caption here on purpose: the first bottom-scrim attempt printed the title
// straight across the touch strip, hiding the 77% / LAUNCH readout that is the
// whole point of the shot. The other two gallery images carry the messaging.
{
  await sharp(resolve(media, 'streamdeck-plus-hw.jpg'))
    // Keys + full touch strip; the physical dials below carry no product info.
    .extract({ left: 100, top: 110, width: 1120, height: 560 })
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(resolve(out, 'gallery-03-hardware.png'));
}

// ---- thumbnail --------------------------------------------------------------
{
  const img = await sharp(resolve(media, 'streamdeck-keys-app.png')).resize(980, null).png().toBuffer();
  const { height } = await sharp(img).metadata();
  const x = W - 980 - 110;
  const y = Math.round((H - height) / 2);

  const text = Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="110" y="452" fill="${TIDE_50}" font-family="${FONT}" font-size="94" font-weight="700">AgentDeck</text>
      <text x="114" y="528" fill="${KELP_300}" font-family="${FONT}" font-size="37" font-weight="500">AI agent control for Stream Deck</text>
      <text x="114" y="592" fill="${TIDE_50}" font-family="${FONT}" font-size="27" opacity="0.82">Claude Code · Codex · OpenCode · OpenClaw</text>
    </svg>
  `);

  await sharp(backdrop())
    .composite([
      { input: img, left: x, top: y },
      { input: text },
      { input: await sharp(brandIcon).resize(146, 146).png().toBuffer(), left: 110, top: 212 },
    ])
    .png()
    .toFile(resolve(out, 'thumbnail-1920x960.png'));
}

console.log(`Generated Elgato Marketplace media in ${out}`);
