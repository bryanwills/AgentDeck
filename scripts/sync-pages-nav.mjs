#!/usr/bin/env node
// Render the canonical GNB into every committed Pages surface: the markup from
// scripts/pages-nav.html between <!-- GNB:BEGIN --> / <!-- GNB:END -->, and the
// styling from scripts/pages-nav.css between /* GNB-CSS:BEGIN */ / /* GNB-CSS:END */.
// Build Health is not in this list: scripts/generate-html-report.py reads the
// same two files at generation time, so it cannot drift by hand.
//
// The markup was single-sourced before the CSS was, which is how the five navs
// ended up a few pixels apart — same HTML, five hand-written stylesheets. Both
// are single-sourced now.
//
//   node scripts/sync-pages-nav.mjs           # rewrite surfaces in place
//   node scripts/sync-pages-nav.mjs --check   # exit 1 if any surface drifted

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partialPath = resolve(root, 'scripts/pages-nav.html');
const cssPath = resolve(root, 'scripts/pages-nav.css');

// `file` holds the GNB markup markers; `cssFile` holds the GNB-CSS markers
// (defaults to `file`). The design-system viewer keeps its CSS in a linked
// stylesheet, so its two markers live in different files.
const SURFACES = [
  { file: 'scripts/pages-index.html', base: './', active: 'overview' },
  { file: 'docs/hardware/index.html', base: '../', active: 'devices' },
  { file: 'tools/creature-simulator/index.html', base: '../', active: 'demo' },
  {
    file: 'agentdeck-design-system/viewer/index.html',
    cssFile: 'agentdeck-design-system/viewer/styles.css',
    base: '../',
    active: 'design',
  },
];

const HTML_BEGIN = '<!-- GNB:BEGIN (generated from scripts/pages-nav.html — do not edit by hand) -->';
const HTML_END = '<!-- GNB:END -->';
const CSS_BEGIN = '/* GNB-CSS:BEGIN (generated from scripts/pages-nav.css — do not edit by hand) */';
const CSS_END = '/* GNB-CSS:END */';

export function renderNav(partial, base, active) {
  return partial
    .replace(/<!--[\s\S]*?-->\s*/, '') // strip the leading usage comment
    .replaceAll('{{base}}', base)
    .replace(/\{\{active:([a-z]+)\}\}/g, (_, key) =>
      key === active ? ' class="active"' : ''
    )
    .trimEnd();
}

export function renderNavCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\/\s*/, '').trimEnd(); // strip the leading usage comment
}

const partial = readFileSync(partialPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const check = process.argv.includes('--check');
let drift = 0;

// Replace a single marked region in `html`; returns { html, changed } or logs drift.
function applyRegion(file, html, begin, end, body) {
  const b = html.indexOf(begin);
  const e = html.indexOf(end);
  if (b === -1 || e === -1) {
    console.error(`${file}: missing markers ${begin.slice(0, 24)}…`);
    return { html, missing: true };
  }
  const rendered = `${begin}\n${body}\n${end}`;
  const current = html.slice(b, e + end.length);
  if (current === rendered) return { html, changed: false };
  return { html: html.slice(0, b) + rendered + html.slice(e + end.length), changed: true, drifted: true };
}

// Each region names the file it lives in, the marker pair, and the body to inject.
for (const { file, cssFile, base, active } of SURFACES) {
  const regions = [
    { file, begin: HTML_BEGIN, end: HTML_END, body: renderNav(partial, base, active), kind: 'markup' },
    { file: cssFile || file, begin: CSS_BEGIN, end: CSS_END, body: renderNavCss(css), kind: 'CSS' },
  ];

  // Group by target file so a surface whose markup and CSS share one file is
  // written once.
  const byFile = new Map();
  for (const r of regions) {
    if (!byFile.has(r.file)) byFile.set(r.file, { html: readFileSync(resolve(root, r.file), 'utf8'), dirty: false });
    const entry = byFile.get(r.file);
    const res = applyRegion(r.file, entry.html, r.begin, r.end, r.body);
    if (res.missing) { drift += 1; continue; }
    if (!res.drifted) continue;
    if (check) {
      console.error(`${r.file}: GNB ${r.kind} drifted`);
      drift += 1;
    } else {
      entry.html = res.html;
      entry.dirty = true;
    }
  }

  if (!check) {
    for (const [f, entry] of byFile) {
      if (entry.dirty) {
        writeFileSync(resolve(root, f), entry.html);
        console.log(`updated ${f}`);
      }
    }
  }
}

if (check && drift === 0) {
  console.log(`GNB markup + CSS in sync across ${SURFACES.length} surfaces (+ Build Health renders at build time)`);
}
process.exit(drift > 0 ? 1 : 0);
