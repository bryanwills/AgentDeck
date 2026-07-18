#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'marketplace/elgato/1.0.0');
const screenshots = resolve(root, 'apple/appstore-submission/screenshots/macOS');
const brandIcon = resolve(root, 'design/brand/agentdeck-icon.png');

await mkdir(out, { recursive: true });

await sharp(brandIcon).resize(288, 288).png().toFile(resolve(out, 'app-icon-288.png'));

const gallery = [
  ['01-device-preview.png', 'gallery-01-device-preview.png'],
  ['02-apme-on-device.png', 'gallery-02-apme-on-device.png'],
  ['03-integrations.png', 'gallery-03-integrations.png'],
];

for (const [source, target] of gallery) {
  await sharp(resolve(screenshots, source))
    .resize(1920, 960, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(resolve(out, target));
}

const thumbnailOverlay = Buffer.from(`
  <svg width="1920" height="960" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#07151f" stop-opacity="0.96"/>
        <stop offset="0.43" stop-color="#07151f" stop-opacity="0.82"/>
        <stop offset="0.72" stop-color="#07151f" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#07151f" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="960" fill="url(#shade)"/>
    <text x="112" y="438" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="104" font-weight="700">AgentDeck</text>
    <text x="116" y="522" fill="#a8d8e8" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="42" font-weight="500">AI agent control for Stream Deck</text>
    <text x="116" y="592" fill="#d9e8ee" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="30">Claude Code · Codex · OpenCode · OpenClaw</text>
  </svg>
`);

await sharp(resolve(screenshots, '01-device-preview.png'))
  .resize(1920, 960, { fit: 'cover', position: 'centre' })
  .composite([
    { input: thumbnailOverlay },
    { input: await sharp(brandIcon).resize(168, 168).png().toBuffer(), left: 112, top: 170 },
  ])
  .png()
  .toFile(resolve(out, 'thumbnail-1920x960.png'));

console.log(`Generated Elgato Marketplace media in ${out}`);
