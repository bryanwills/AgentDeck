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
const EXPECTED_TOKEN_COUNT = 96;
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

/* Non-image canonical design sources that belong in the asset library as
 * pointers. They are source-only: the viewer links them, never renders them. */
const SPEC_POINTERS = [
  {
    source: 'design/icons.jsx',
    name: 'icons',
    note: 'Canonical UI icon set — 22px marks on a 24px viewbox, 1.6px stroke (DESIGN.md §6.3). JSX source, not rendered here.',
  },
];

async function loadAssets() {
  const brandDir = path.join(repoRoot, 'design', 'brand');
  const entries = await readdir(brandDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (files.length === 0) fail('design/brand contains no brand assets');

  const assets = [];
  for (const file of files) {
    const info = await stat(path.join(brandDir, file));
    assets.push({
      name: file.replace(/\.[^.]+$/, ''),
      file,
      type: path.extname(file).slice(1).toUpperCase(),
      bytes: info.size,
      url: `assets/brand/${file}`,
      source: `design/brand/${file}`,
      kind: 'image',
    });
  }

  for (const pointer of SPEC_POINTERS) {
    const info = await stat(safeSourcePath(pointer.source));
    assets.push({
      name: pointer.name,
      file: path.basename(pointer.source),
      type: path.extname(pointer.source).slice(1).toUpperCase(),
      bytes: info.size,
      url: `https://github.com/puritysb/AgentDeck/blob/master/${pointer.source}`,
      source: pointer.source,
      kind: 'spec',
      note: pointer.note,
    });
  }
  return assets;
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
      `[design-system] ${manifest.documents.length} documents, ${manifest.tokens.length} tokens, ${manifest.assets.length} assets verified`,
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
