// Rasterize canonical creature SVG geometry into 8-bit alpha-mask C headers for
// the ESP32 firmware, which cannot parse SVG at runtime. Mirrors generate-icons.mjs
// (uses `sharp`). The masks let the firmware render the SAME robot/crayfish silhouette
// the Apple/Android/StreamDeck surfaces draw, instead of a coarse block-grid glyph.
//
// Source geometry is the canonical path data, kept byte-identical with:
//   - android  app/.../terrarium/CreatureGeometry.kt
//   - shared   shared/src/svg-renderers/agent-logos.ts
//   - apple    apple/AgentDeck/Terrarium/Creatures/*.swift
// If those paths change, re-run `pnpm generate-creature-glyphs` and commit the header.
//
// Output: esp32/src/ui/terrarium/creature_glyphs_generated.h  (committed, like generate-protocol)

import sharp from 'sharp';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(__dirname, '../esp32/src/ui/terrarium/creature_glyphs_generated.h');

// --- Canonical geometry (mirrors CreatureGeometry.kt) ---

// Claude Code robot — viewBox 0 0 24 24, fill-rule evenodd (inner rects = eye cutouts).
const OCTOPUS_VIEWBOX = 24;
const OCTOPUS_PATH =
  'M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z';

// OpenClaw crayfish body — viewBox 0 0 120 120 (claws/antennae stay procedural in firmware).
const CRAYFISH_VIEWBOX = 120;
const CRAYFISH_BODY_PATH =
  'M60 10c-30 0-45 25-45 45s15 40 30 45v10h10v-10s5 2 10 0v10h10v-10c15-5 30-25 30-45S90 10 60 10';

// OpenCode mark — viewBox 0 0 24 24, fill-rule evenodd. A vertical rectangular RING
// (outer 16×20, inner 8×12 hollow) — single color, HOLLOW center (matches opencode.ai),
// not the old filled-nested-squares with a dark inner that read as a shadow.
const OPENCODE_VIEWBOX = 24;
const OPENCODE_PATH = 'M16 6H8v12h8V6zm4 16H4V2h16v20z';

// Codex cloud/swirl mark — viewBox 0 0 24 24, fill-rule evenodd (canonical brand path).
const CODEX_VIEWBOX = 24;
const CODEX_PATH =
  'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z';

// Master mask resolution. One high-res master is bilinearly sampled by the firmware
// for every board size (16px on TTGO up to ~200px on IPS10), so a single 64² master
// (4 KB flash each) is plenty and keeps eye cutouts soft rather than aliased.
const MASTER = 64;

// OpenClaw FULL mark (cards use this) — the canonical brand SVG with eyes, both claws and
// antennae, not the body-only CRAYFISH_BODY the terrarium pairs with its procedural claws.
// A body-only silhouette reads as a shapeless blob on a card; the full mark is recognizable.
// Per DESIGN.md rule 6 the brand mark is upstream — we rasterize it, we don't redraw it.
const OPENCLAW_MARK_SVG = readFileSync(resolve(__dirname, '../design/brand/openclaw.svg'), 'utf8')
  .replace(/fill="currentColor"/g, 'fill="#ffffff"')
  .replace(/width="1em"/g, 'width="24"')
  .replace(/height="1em"/g, 'height="24"');

// Each part is rasterized across its FULL viewBox so the mask coordinate space matches
// the firmware's existing viewBox mapping (octopus centered on 24×24, crayfish on 120×120).
const glyphs = [
  { name: 'OCTOPUS', viewBox: OCTOPUS_VIEWBOX, path: OCTOPUS_PATH, evenodd: true },
  { name: 'CRAYFISH_BODY', viewBox: CRAYFISH_VIEWBOX, path: CRAYFISH_BODY_PATH, evenodd: false },
  { name: 'OPENCLAW_MARK', svgMarkup: OPENCLAW_MARK_SVG },
  { name: 'OPENCODE', viewBox: OPENCODE_VIEWBOX, path: OPENCODE_PATH, evenodd: true },
  { name: 'CODEX', viewBox: CODEX_VIEWBOX, path: CODEX_PATH, evenodd: true },
];

async function rasterizeAlpha({ viewBox, path, evenodd, svgMarkup }) {
  const fillRule = evenodd ? ' fill-rule="evenodd"' : '';
  const svg = svgMarkup ||
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}">` +
    `<path d="${path}" fill="#ffffff"${fillRule}/></svg>`;
  // Fill white on transparent bg → the alpha channel IS the coverage mask.
  const { data, info } = await sharp(Buffer.from(svg), { density: 384 })
    .resize(MASTER, MASTER, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels; // 4 (RGBA)
  const alpha = new Uint8Array(MASTER * MASTER);
  for (let i = 0; i < MASTER * MASTER; i++) alpha[i] = data[i * ch + (ch - 1)];
  return alpha;
}

function emitArray(name, w, h, alpha) {
  const lines = [];
  lines.push(`constexpr int ${name}_W = ${w};`);
  lines.push(`constexpr int ${name}_H = ${h};`);
  lines.push(`static const uint8_t ${name}_A8[${w} * ${h}] = {`);
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(String(alpha[y * w + x]));
    lines.push('    ' + row.join(',') + ',');
  }
  lines.push('};');
  return lines.join('\n');
}

const sections = [];
let coverage = 0;
for (const g of glyphs) {
  const alpha = await rasterizeAlpha(g);
  coverage += alpha.reduce((n, a) => n + (a > 32 ? 1 : 0), 0);
  sections.push(emitArray(g.name, MASTER, MASTER, alpha));
  console.log(`  ${g.name}: ${MASTER}x${MASTER} alpha mask`);
}

const header = `// AUTO-GENERATED by scripts/generate-creature-glyphs.mjs — DO NOT EDIT.
// Run \`pnpm generate-creature-glyphs\` after changing canonical creature geometry.
// 8-bit alpha coverage masks (0 = transparent, 255 = opaque) sampled bilinearly by
// the terrarium renderer so ESP32 draws the canonical robot/crayfish silhouettes.
#pragma once
#include <cstdint>

namespace CreatureGlyphs {

${sections.join('\n\n')}

}  // namespace CreatureGlyphs
`;

writeFileSync(outFile, header);
console.log(`\nWrote ${outFile} (${(header.length / 1024).toFixed(1)} KB source, ${coverage} covered px)`);
