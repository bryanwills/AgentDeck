#!/usr/bin/env node
// Render the canonical GNB partial (scripts/pages-nav.html) into every
// committed Pages surface, between <!-- GNB:BEGIN --> / <!-- GNB:END -->
// markers. Build Health is not in this list: scripts/generate-html-report.py
// reads the same partial at generation time, so it cannot drift by hand.
//
//   node scripts/sync-pages-nav.mjs           # rewrite surfaces in place
//   node scripts/sync-pages-nav.mjs --check   # exit 1 if any surface drifted

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partialPath = resolve(root, 'scripts/pages-nav.html');

const SURFACES = [
  { file: 'scripts/pages-index.html', base: './', active: 'overview' },
  { file: 'docs/hardware/index.html', base: '../', active: 'devices' },
  { file: 'tools/creature-simulator/index.html', base: '../', active: 'demo' },
  { file: 'agentdeck-design-system/viewer/index.html', base: '../', active: 'design' },
];

const BEGIN = '<!-- GNB:BEGIN (generated from scripts/pages-nav.html — do not edit by hand) -->';
const END = '<!-- GNB:END -->';

export function renderNav(partial, base, active) {
  return partial
    .replace(/<!--[\s\S]*?-->\s*/, '') // strip the leading usage comment
    .replaceAll('{{base}}', base)
    .replace(/\{\{active:([a-z]+)\}\}/g, (_, key) =>
      key === active ? ' class="active"' : ''
    )
    .trimEnd();
}

const partial = readFileSync(partialPath, 'utf8');
const check = process.argv.includes('--check');
let drift = 0;

for (const { file, base, active } of SURFACES) {
  const path = resolve(root, file);
  const html = readFileSync(path, 'utf8');
  const begin = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  if (begin === -1 || end === -1) {
    console.error(`${file}: missing GNB markers`);
    drift += 1;
    continue;
  }
  const rendered = `${BEGIN}\n${renderNav(partial, base, active)}\n${END}`;
  const current = html.slice(begin, end + END.length);
  if (current === rendered) continue;
  if (check) {
    console.error(`${file}: GNB drifted from scripts/pages-nav.html`);
    drift += 1;
  } else {
    writeFileSync(path, html.slice(0, begin) + rendered + html.slice(end + END.length));
    console.log(`updated ${file}`);
  }
}

if (check && drift === 0) console.log(`GNB in sync across ${SURFACES.length} surfaces (+ Build Health renders at build time)`);
process.exit(drift > 0 ? 1 : 0);
