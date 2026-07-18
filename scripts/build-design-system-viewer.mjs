#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const systemRoot = path.join(repoRoot, 'agentdeck-design-system');
const outputRoot = path.join(repoRoot, 'dist', 'design-system');
const checkOnly = process.argv.includes('--check');

/* Exact pin, not a floor: a silently dropped token is as much a regression as a
 * silently added one. Bump this deliberately when design/tokens.css changes. */
const EXPECTED_TOKEN_COUNT = 97;
const requiredFields = [
  'id',
  'title',
  'description',
  'category',
  'locale',
  'canonical',
  'status',
  'owner',
  'reviewed',
  'revision',
  'source_of_truth',
  'validators',
];

function fail(message) {
  throw new Error(`[design-system] ${message}`);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => item.trim()) : [];
  }
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function parseMarkdown(source, sourcePath) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') fail(`${sourcePath} must start with YAML frontmatter`);
  const end = lines.indexOf('---', 1);
  if (end < 0) fail(`${sourcePath} has no closing frontmatter delimiter`);

  const metadata = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) fail(`${sourcePath} has unsupported frontmatter line: ${line}`);
    const key = line.slice(0, colon).trim();
    metadata[key] = parseScalar(line.slice(colon + 1));
  }

  for (const field of requiredFields) {
    if (metadata[field] === undefined || metadata[field] === '') {
      fail(`${sourcePath} is missing required frontmatter field ${field}`);
    }
  }
  if (!Array.isArray(metadata.validators) || metadata.validators.length === 0) {
    fail(`${sourcePath} validators must be a non-empty inline array`);
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .trim();
  if (!body.startsWith('# ')) fail(`${sourcePath} body must start with one H1`);
  return { metadata, body, raw: source.trim() };
}

function safeSourcePath(relativePath) {
  const absolute = path.resolve(repoRoot, relativePath);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`)) fail(`source escapes repository: ${relativePath}`);
  return absolute;
}

function tokenGroup(name) {
  if (name.startsWith('tide-')) return 'Tide';
  if (name.startsWith('ink-')) return 'Ink';
  if (name.startsWith('kelp-')) return 'Kelp';
  if (name.startsWith('coral-')) return 'Coral';
  if (name.startsWith('amber-')) return 'Amber';
  if (name.startsWith('brand-')) return 'Brand';
  if (name.startsWith('status-')) return 'Status';
  if (name.startsWith('ui-')) return 'Product UI';
  if (name.startsWith('font-') || name.startsWith('t-') || name.startsWith('tr-')) return 'Type';
  if (name.startsWith('s-') || name.startsWith('container-') || name === 'section-y') return 'Layout';
  if (name.startsWith('r-')) return 'Radius';
  if (name.startsWith('sh-')) return 'Shadow';
  if (name.startsWith('d-') || name.startsWith('ease-')) return 'Motion';
  return 'Other';
}

async function loadTokens() {
  const css = await readFile(path.join(repoRoot, 'design', 'tokens.css'), 'utf8');
  const tokens = [];
  for (const match of css.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) {
    tokens.push({ name: `--${match[1]}`, value: match[2].trim(), group: tokenGroup(match[1]) });
  }
  if (tokens.length !== EXPECTED_TOKEN_COUNT) {
    fail(
      `expected exactly ${EXPECTED_TOKEN_COUNT} design tokens, found ${tokens.length}. ` +
        'If you intentionally added or removed a token in design/tokens.css, update EXPECTED_TOKEN_COUNT ' +
        'in scripts/build-design-system-viewer.mjs (and the token mirrors listed in DESIGN.md §11).',
    );
  }
  return tokens;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);

function blobUrl(relativePath) {
  // Several reference surfaces have spaces in their filenames.
  return `https://github.com/puritysb/AgentDeck/blob/master/${encodeURI(relativePath)}`;
}

async function specPointer({ source, name, note, type, renderUrl }) {
  const absolute = safeSourcePath(source);
  const info = await stat(absolute);
  return {
    kind: 'spec',
    name,
    file: path.basename(source.replace(/\/$/, '')),
    type: type || path.extname(source).slice(1).toUpperCase() || 'DIR',
    bytes: info.isDirectory() ? 0 : info.size,
    // renderUrl points at the rendered copy the build ships under reference/;
    // without it the card falls back to the GitHub blob (source view).
    url: renderUrl || blobUrl(source.replace(/\/$/, '')),
    source,
    note,
  };
}

/* === Generated dot-matrix masks ===
 * `pnpm generate-micro-glyphs` renders design/brand/*.svg down to alpha masks
 * for the LED surfaces. Parsing the generated file (rather than restating the
 * pixels here) is the whole point: the viewer must show what actually ships, so
 * a regenerated mask changes this page without anyone editing it.
 */
const GLYPH_SOURCE = 'bridge/src/pixoo/official-dot-glyphs.generated.ts';
const GLYPH_BLOCKS = [
  { constant: 'OFFICIAL_DOT_GLYPHS', size: 24, surface: 'Pixoo64 · iDotMatrix' },
  { constant: 'OFFICIAL_TIMEBOX_GLYPHS', size: 9, surface: 'Timebox Mini' },
  { constant: 'OFFICIAL_TC001_GLYPHS', size: 8, surface: 'TC001' },
];
const AGENT_LABELS = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  openCode: 'OpenCode',
  openClaw: 'OpenClaw',
  antigravity: 'Antigravity',
};

function parseGlyphBlock(source, constant, size) {
  const start = source.indexOf(`export const ${constant}`);
  if (start < 0) fail(`${GLYPH_SOURCE} has no ${constant} export`);
  const end = source.indexOf('\n};', start);
  if (end < 0) fail(`${GLYPH_SOURCE} ${constant} block is not terminated`);
  const block = source.slice(start, end);

  const glyphs = {};
  for (const match of block.matchAll(/(\w+):\s*new Uint8Array\(\[([\s\S]*?)\]\)/g)) {
    const values = match[2]
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map(Number);
    if (values.length !== size * size) {
      fail(`${GLYPH_SOURCE} ${constant}.${match[1]} has ${values.length} cells, expected ${size * size}`);
    }
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      fail(`${GLYPH_SOURCE} ${constant}.${match[1]} has a cell outside 0-255`);
    }
    glyphs[match[1]] = values;
  }
  if (Object.keys(glyphs).length === 0) fail(`${GLYPH_SOURCE} ${constant} yielded no glyphs`);
  return glyphs;
}

/* Horizontal run-merge keeps the inline SVG small — a 24×24 mask collapses from
 * ~500 single-cell rects to a few dozen spans without changing a pixel. */
function maskToSvg(cells, size) {
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      const alpha = cells[y * size + x];
      let run = 1;
      while (x + run < size && cells[y * size + x + run] === alpha) run += 1;
      if (alpha > 0) {
        const opacity = Math.round((alpha / 255) * 100) / 100;
        rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" opacity="${opacity}"/>`);
      }
      x += run;
    }
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" fill="currentColor" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

async function loadGlyphMasks() {
  const source = await readFile(safeSourcePath(GLYPH_SOURCE), 'utf8');
  const items = [];
  for (const block of GLYPH_BLOCKS) {
    const glyphs = parseGlyphBlock(source, block.constant, block.size);
    for (const [agent, cells] of Object.entries(glyphs)) {
      items.push({
        kind: 'mask',
        name: `${AGENT_LABELS[agent] || agent} ${block.size}×${block.size}`,
        agent,
        size: block.size,
        surface: block.surface,
        lit: cells.filter((value) => value > 0).length,
        svg: maskToSvg(cells, block.size),
        source: `${GLYPH_SOURCE} · ${block.constant}`,
        url: blobUrl(GLYPH_SOURCE),
      });
    }
  }
  return items;
}

async function loadBrandMarks() {
  const brandDir = path.join(repoRoot, 'design', 'brand');
  const entries = await readdir(brandDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (files.length === 0) fail('design/brand contains no brand assets');

  const marks = [];
  for (const file of files) {
    const info = await stat(path.join(brandDir, file));
    marks.push({
      kind: 'image',
      name: file.replace(/\.[^.]+$/, ''),
      file,
      type: path.extname(file).slice(1).toUpperCase(),
      bytes: info.size,
      url: `assets/brand/${file}`,
      source: `design/brand/${file}`,
    });
  }
  return marks;
}

async function loadCreatures() {
  const items = Object.entries(AGENT_LABELS).map(([agent, label]) => ({
    kind: 'link',
    name: label,
    agent,
    url: '../demo/',
    note: `Canonical ${label} creature. Rendered live — with state, motion, and the terrarium — on the Live Preview surface.`,
  }));
  items.push(
    await specPointer({
      source: 'shared/src/terrarium-rules.ts',
      name: 'terrarium-rules.ts',
      note: 'Terrarium behaviour SSOT — generated outward to Swift/Kotlin/C++ behind a vitest drift gate. New creature rules land here first.',
    }),
    await specPointer({
      source: 'android/app/src/main/kotlin/dev/agentdeck/terrarium/CreatureGeometry.kt',
      name: 'CreatureGeometry.kt',
      note: 'Canonical creature geometry. ESP32 alpha masks are generated from the same shapes by `pnpm generate-creature-glyphs`.',
    }),
    await specPointer({
      source: 'docs/design/creatures.jsx',
      name: 'creatures.jsx',
      note: 'Creature reference drawings used by the legacy Design System page. Reference only — the geometry SSOT above wins.',
    }),
  );
  return items;
}

async function loadReferenceSurfaces() {
  return Promise.all([
    specPointer({
      source: 'docs/design/Design System.html',
      name: 'Design System.html',
      renderUrl: encodeURI('reference/docs/design/Design System.html'),
      note: 'Legacy visual style guide. Superseded by this viewer for anything it covers; kept for the mockups it still hosts.',
    }),
    specPointer({
      source: 'docs/design/Design Audit.html',
      name: 'Design Audit.html',
      renderUrl: encodeURI('reference/docs/design/Design Audit.html'),
      note: 'Coverage matrix and the R1–R8 lint rules in narrative form. The enforced version is `bash design/lint.sh`.',
    }),
    specPointer({
      source: 'docs/design/AgentDeck Tide Bento (D1).html',
      name: 'Tide Bento (D1).html',
      renderUrl: encodeURI('reference/docs/design/AgentDeck Tide Bento (D1).html'),
      note: 'Bento landing exploration that set the current tide palette direction. Historical.',
    }),
    specPointer({
      source: 'docs/design/tenin',
      name: 'tenin/',
      type: 'DIR',
      note: 'Mockup application built on the tide system. Design provenance, not a shipped surface.',
    }),
    specPointer({
      source: 'docs/design-mockups',
      name: 'design-mockups/',
      type: 'DIR',
      note: 'Interactive React explorations (menubar popup, e-ink screens, options A–D). Non-production per DESIGN.md §11.',
    }),
  ]);
}

async function loadAssets() {
  const groups = [
    { id: 'brand', items: await loadBrandMarks() },
    { id: 'masks', items: await loadGlyphMasks() },
    { id: 'creatures', items: await loadCreatures() },
    {
      id: 'icons',
      items: [
        await specPointer({
          source: 'design/icons.jsx',
          name: 'icons.jsx',
          note: 'Canonical UI icon set — 22px marks on a 24px viewbox, 1.6px stroke (DESIGN.md §6.3). JSX source, not rendered here.',
        }),
      ],
    },
    { id: 'reference', items: await loadReferenceSurfaces() },
  ];
  return { groups, total: groups.reduce((sum, group) => sum + group.items.length, 0) };
}

async function buildManifest() {
  const catalog = JSON.parse(await readFile(path.join(systemRoot, 'catalog.json'), 'utf8'));
  if (catalog.defaultLocale !== 'en') fail('English must remain the default locale');
  if (JSON.stringify(catalog.locales) !== JSON.stringify(['en', 'ko', 'ja'])) {
    fail('locale order must be en, ko, ja');
  }

  const seen = new Set();
  const documents = [];
  for (const entry of catalog.documents) {
    if (seen.has(entry.id)) fail(`duplicate catalog id ${entry.id}`);
    seen.add(entry.id);
    if (!entry.sources?.en) fail(`${entry.id} has no English canonical source`);

    const localized = {};
    for (const [locale, relativePath] of Object.entries(entry.sources)) {
      if (!catalog.locales.includes(locale)) fail(`${entry.id} uses unsupported locale ${locale}`);
      const source = await readFile(safeSourcePath(relativePath), 'utf8');
      const parsed = parseMarkdown(source, relativePath);
      if (parsed.metadata.id !== entry.id) fail(`${relativePath} id must be ${entry.id}`);
      if (parsed.metadata.locale !== locale) fail(`${relativePath} locale must be ${locale}`);
      localized[locale] = { ...parsed, path: relativePath };
    }

    const canonical = localized.en.metadata;
    if (canonical.canonical !== true) fail(`${entry.sources.en} must set canonical: true`);
    for (const locale of ['ko', 'ja']) {
      const translation = localized[locale];
      if (!translation) continue;
      const meta = translation.metadata;
      if (meta.canonical !== false) fail(`${translation.path} must set canonical: false`);
      if (meta.translation_of !== entry.id) fail(`${translation.path} translation_of must be ${entry.id}`);
      if (meta.source_revision !== canonical.revision) {
        fail(`${translation.path} source_revision ${meta.source_revision} does not match ${canonical.revision}`);
      }
    }

    documents.push({ id: entry.id, locales: localized });
  }

  return {
    generatedAt: new Date().toISOString(),
    defaultLocale: catalog.defaultLocale,
    locales: catalog.locales,
    documents,
    tokens: await loadTokens(),
    assets: await loadAssets(),
  };
}

async function main() {
  const manifest = await buildManifest();
  if (checkOnly) {
    console.log(
      `[design-system] ${manifest.documents.length} documents, ${manifest.tokens.length} tokens, ${manifest.assets.total} assets in ${manifest.assets.groups.length} groups verified`,
    );
    return;
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.join(outputRoot, 'assets'), { recursive: true });
  await cp(path.join(systemRoot, 'viewer'), outputRoot, { recursive: true });
  await cp(path.join(repoRoot, 'design', 'brand'), path.join(outputRoot, 'assets', 'brand'), { recursive: true });
  await cp(path.join(repoRoot, 'design', 'tokens.css'), path.join(outputRoot, 'assets', 'tokens.css'));
  await cp(path.join(repoRoot, 'design', 'components.css'), path.join(outputRoot, 'assets', 'components.css'));
  await cp(path.join(repoRoot, 'design', 'patterns.css'), path.join(outputRoot, 'assets', 'patterns.css'));
  // Rendered copies of the reference HTML surfaces (asset cards open real
  // pages, not GitHub source). docs/design/*.html reference ../../design/*,
  // so mirroring both directory levels under reference/ keeps them working.
  const referenceRoot = path.join(outputRoot, 'reference');
  await mkdir(path.join(referenceRoot, 'design'), { recursive: true });
  for (const file of ['tokens.css', 'components.css', 'patterns.css', 'tokens.js', 'icons.jsx']) {
    await cp(path.join(repoRoot, 'design', file), path.join(referenceRoot, 'design', file));
  }
  await cp(path.join(repoRoot, 'design', 'brand'), path.join(referenceRoot, 'design', 'brand'), { recursive: true });
  await cp(path.join(repoRoot, 'docs', 'design'), path.join(referenceRoot, 'docs', 'design'), { recursive: true });
  await writeFile(
    path.join(outputRoot, 'manifest.js'),
    `window.AGENTDECK_DESIGN_SYSTEM = ${JSON.stringify(manifest)};\n`,
    'utf8',
  );
  console.log(
    `[design-system] built ${path.relative(repoRoot, outputRoot)} with ${manifest.documents.length} documents`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
