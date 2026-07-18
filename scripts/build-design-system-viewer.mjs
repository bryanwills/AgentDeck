#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const systemRoot = path.join(repoRoot, 'agentdeck-design-system');
const outputRoot = path.join(repoRoot, 'dist', 'design-system');
const checkOnly = process.argv.includes('--check');
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
  if (tokens.length < 40) fail(`expected at least 40 design tokens, found ${tokens.length}`);
  return tokens;
}

async function loadAssets() {
  const files = [
    'agentdeck-icon.png',
    'antigravity.svg',
    'claudecode.svg',
    'codex.svg',
    'openclaw.svg',
    'opencode.svg',
  ];
  const assets = [];
  for (const file of files) {
    const absolute = path.join(repoRoot, 'design', 'brand', file);
    const info = await stat(absolute);
    assets.push({
      name: file.replace(/\.[^.]+$/, ''),
      file,
      type: path.extname(file).slice(1).toUpperCase(),
      bytes: info.size,
      url: `assets/brand/${file}`,
      source: `design/brand/${file}`,
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
