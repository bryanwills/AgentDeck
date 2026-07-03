// Preview the Timebox Mini 11×11 micro glyphs across creatures × states.
// Renders via the real SSOT (bridge/dist/pixoo/micro-glyphs.js) so the preview
// matches the device pipeline. Usage: node scripts/micro-preview.mjs [out.png]
import sharp from 'sharp';
import { paintMicroGlyph, microStatusBg, MICRO_SIZE } from '../bridge/dist/pixoo/micro-glyphs.js';

const SCALE = 26;
const GAP = 10;
const creatures = ['octopus', 'jellyfish', 'opencode', 'crayfish', 'antigravity'];
// state field ↔ glyph state pairing (mirrors renderMicroFrame)
const cols = [
  { label: 'idle', bg: 'idle', gs: 'idle' },
  { label: 'working', bg: 'processing', gs: 'working' },
  { label: 'asking', bg: 'awaiting', gs: 'asking' },
];

function cellPng(creature, bg, gs, animFrame) {
  const base = new Uint8Array(MICRO_SIZE * MICRO_SIZE * 3);
  const c = microStatusBg(bg, animFrame);
  for (let i = 0; i < MICRO_SIZE * MICRO_SIZE; i++) {
    base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
  }
  paintMicroGlyph(base, creature, gs, animFrame);
  return sharp(Buffer.from(base), { raw: { width: MICRO_SIZE, height: MICRO_SIZE, channels: 3 } })
    .resize(MICRO_SIZE * SCALE, MICRO_SIZE * SCALE, { kernel: 'nearest' })
    .png().toBuffer();
}

const out = process.argv[2] || '/private/tmp/claude-501/-Users-puritysb-github-AgentDeck/3a3fe318-9602-4826-b037-45e1729ddc8b/scratchpad/micro-current.png';
const animFrame = Number(process.argv[3] ?? 6);
const cellW = MICRO_SIZE * SCALE;
const W = creatures.length * cellW + (creatures.length + 1) * GAP;
const H = cols.length * cellW + (cols.length + 1) * GAP;

const composites = [];
for (let r = 0; r < cols.length; r++) {
  for (let cI = 0; cI < creatures.length; cI++) {
    const buf = await cellPng(creatures[cI], cols[r].bg, cols[r].gs, animFrame);
    composites.push({ input: buf, left: GAP + cI * (cellW + GAP), top: GAP + r * (cellW + GAP) });
  }
}
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 40, g: 40, b: 40 } } })
  .composite(composites).png().toFile(out);
console.log(`wrote ${out}  (${W}×${H}) — rows: ${cols.map(c => c.label).join(', ')} · cols: ${creatures.join(', ')}`);
