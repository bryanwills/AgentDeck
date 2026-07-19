import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, '../plugin/bound.serendipity.agentdeck.sdPlugin/static/imgs');
const keyOutputDir = resolve(outputDir, 'keys');

mkdirSync(outputDir, { recursive: true });
mkdirSync(keyOutputDir, { recursive: true });

// All SVGs designed at 40x40 viewBox, will be rendered at target sizes
const svgs = {
  // Plugin icon — rounded "C" with diamond accent (Claude-style)

  // Category icon — same as plugin
  category: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <path d="M22 6C13.2 6 6 13.2 6 22s7.2 16 16 16c3.2 0 6.2-1 8.7-2.6" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
    <polygon points="32,8 36,14 32,20 28,14" fill="white"/>
  </svg>`,

  // Response — chat bubble with reply arrow

  // Stop — octagon stop symbol

  // Mode — cycle arrows (toggle through Default/Plan/Accept)

  // Option — list/menu icon (three lines with bullets)
  option: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <circle cx="10" cy="12" r="2.5" fill="white"/>
    <line x1="17" y1="12" x2="33" y2="12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="10" cy="20" r="2.5" fill="white"/>
    <line x1="17" y1="20" x2="33" y2="20" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="10" cy="28" r="2.5" fill="white"/>
    <line x1="17" y1="28" x2="33" y2="28" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  // History — clock with circular arrow

  // Voice — microphone icon

  // Session — terminal window with prompt
  session: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect x="3" y="6" width="34" height="28" rx="3" fill="none" stroke="white" stroke-width="2.5"/>
    <path d="M10 16l5 5-5 5" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="19" y1="26" x2="28" y2="26" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,

  // Usage — bar chart icon
  usage: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <rect x="6" y="22" width="6" height="14" rx="1" fill="white" opacity="0.5"/>
    <rect x="14" y="14" width="6" height="22" rx="1" fill="white" opacity="0.7"/>
    <rect x="22" y="8" width="6" height="28" rx="1" fill="white" opacity="0.85"/>
    <rect x="30" y="18" width="6" height="18" rx="1" fill="white"/>
  </svg>`,

  // Command — slash in a rounded box (quick commands)

  // Context — eye icon (display/observe)

  // Utility — gear icon (system utilities)
  utility: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="7" fill="none" stroke="white" stroke-width="2.5"/>
    <circle cx="20" cy="20" r="3" fill="white"/>
    <line x1="20" y1="3" x2="20" y2="9" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="20" y1="31" x2="20" y2="37" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="3" y1="20" x2="9" y2="20" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="31" y1="20" x2="37" y2="20" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="8" y1="8" x2="12.5" y2="12.5" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="27.5" y1="27.5" x2="32" y2="32" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="32" y1="8" x2="27.5" y2="12.5" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="12.5" y1="27.5" x2="8" y2="32" stroke="white" stroke-width="3" stroke-linecap="round"/>
  </svg>`,

  // Launcher — rocket (start a session). Pure geometry, no text.
  launcher: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <path d="M20 3c5 5 8 12 8 18v6H12v-6c0-6 3-13 8-18z" fill="none" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="20" cy="14" r="3.2" fill="white"/>
    <polygon points="12,20 5,29 12,27" fill="white"/>
    <polygon points="28,20 35,29 28,27" fill="white"/>
    <polygon points="16,30 20,38 24,30" fill="white"/>
  </svg>`,

  // Terminal — monitor with prompt cursor
};

// Size specs: plugin/category are 28/56, action icons are 20/40
// Category icon is 28 (@2x 56); action-list icons are 20 (@2x 40).
//
// NOT generated: `static/imgs/plugin.png` + `@2x`. That is the Marketplace
// listing icon and a designed asset (94KB / 349KB) — an earlier revision of
// this file declared it here at 28x28, so running the generator replaced the
// real icon with a crude placeholder at the wrong size. Keep it out.
const sizeMap = {
  category: [28, 56],
  option:   [20, 40],
  session:  [20, 40],
  usage:    [20, 40],
  utility:  [20, 40],
  launcher: [20, 40],
};

// Stream Deck key state images must be 72x72 (@1x) / 144x144 (@2x).
// Any icon referenced from an action's States[].Image needs a key-sized variant.
const KEY_SIZE_1X = 72;
const KEY_SIZE_2X = 144;
// Glyph is drawn inset on the key canvas so it doesn't bleed to the key edge.
const KEY_GLYPH_1X = 50; // 2x variant is exactly double, keeping the pair aligned
const KEY_GLYPH_2X = KEY_GLYPH_1X * 2;

const keyIcons = ['session', 'option', 'utility', 'usage', 'launcher'];

async function renderKeyVariant(svgBuffer, name, keySize, glyphSize, suffix) {
  const pad = (keySize - glyphSize) / 2;
  const glyph = await sharp(svgBuffer, { density: 300 })
    .resize(glyphSize, glyphSize)
    .png()
    .toBuffer();

  await sharp(glyph)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(resolve(keyOutputDir, `${name}${suffix}.png`));
}

let count = 0;
for (const [name, svg] of Object.entries(svgs)) {
  const [size1x, size2x] = sizeMap[name];
  const buf = Buffer.from(svg);

  await sharp(buf, { density: 300 })
    .resize(size1x, size1x)
    .png()
    .toFile(resolve(outputDir, `${name}.png`));

  await sharp(buf, { density: 300 })
    .resize(size2x, size2x)
    .png()
    .toFile(resolve(outputDir, `${name}@2x.png`));

  count += 2;
  console.log(`  ${name}.png (${size1x}x${size1x}) + ${name}@2x.png (${size2x}x${size2x})`);
}

let keyCount = 0;
for (const name of keyIcons) {
  const svg = svgs[name];
  if (!svg) throw new Error(`keyIcons references unknown icon: ${name}`);
  const buf = Buffer.from(svg);

  await renderKeyVariant(buf, name, KEY_SIZE_1X, KEY_GLYPH_1X, '');
  await renderKeyVariant(buf, name, KEY_SIZE_2X, KEY_GLYPH_2X, '@2x');

  keyCount += 2;
  console.log(
    `  keys/${name}.png (${KEY_SIZE_1X}x${KEY_SIZE_1X}) + keys/${name}@2x.png (${KEY_SIZE_2X}x${KEY_SIZE_2X})`
  );
}

console.log(`\nGenerated ${count} icon files in ${outputDir}`);
console.log(`Generated ${keyCount} key state images in ${keyOutputDir}`);
