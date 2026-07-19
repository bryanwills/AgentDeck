#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const productVersion = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
const failures = [];

if (!/^\d+\.\d+\.\d+$/.test(productVersion)) {
  failures.push(`VERSION: expected numeric X.Y.Z SemVer, found ${productVersion || '<empty>'}`);
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function expectValue(path, actual, expected) {
  if (actual !== expected) failures.push(`${path}: expected ${expected}, found ${actual ?? '<missing>'}`);
}

function jsonVersion(path, key = 'version') {
  return JSON.parse(read(path))[key];
}

for (const path of [
  'package.json',
  'shared/package.json',
  'bridge/package.json',
  'setup/package.json',
  'hooks/package.json',
  'plugin/package.json',
  'plugin-ulanzi/package.json',
]) {
  expectValue(path, jsonVersion(path), productVersion);
}

for (const path of [
  'hooks/package.json',
  'shared/package.json',
  'bridge/package.json',
  'setup/package.json',
]) {
  const manifest = JSON.parse(read(path));
  if (manifest.private === true) failures.push(`${path}: required public npm package must not be private`);
}

const bridgeManifest = JSON.parse(read('bridge/package.json'));
for (const dependency of ['@agentdeck/hooks', '@agentdeck/shared']) {
  if (bridgeManifest.dependencies?.[dependency] !== 'workspace:*') {
    failures.push(`bridge/package.json: ${dependency} must remain a workspace runtime dependency`);
  }
}

expectValue(
  'plugin-ulanzi/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/manifest.json',
  jsonVersion('plugin-ulanzi/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/manifest.json', 'Version'),
  productVersion,
);
const streamDeckManifestPath = 'plugin/bound.serendipity.agentdeck.sdPlugin/manifest.json';
const streamDeckManifest = JSON.parse(read(streamDeckManifestPath));
expectValue(streamDeckManifestPath, streamDeckManifest.Version, `${productVersion}.0`);
for (const [name, deviceType] of [
  ['agentdeck-sd', 0],
  ['agentdeck-sdmini', 1],
  ['agentdeck-sdplus', 7],
]) {
  const profile = streamDeckManifest.Profiles?.find((candidate) => candidate.Name === name);
  expectValue(`${streamDeckManifestPath} profile ${name}`, profile?.DeviceType, deviceType);
}

const textChecks = [
  ['apple/project.yml', /MARKETING_VERSION:\s*"([^"]+)"/, productVersion],
  ['android/app/build.gradle.kts', /versionName\s*=\s*"([^"]+)"/, productVersion],
  ['esp32/src/config.h', /FIRMWARE_VERSION\s*=\s*"([^"]+)"/, productVersion],
  ['bridge/src/daemon.ts', /\.version\('([^']+)'\)/, productVersion],
];
for (const [path, pattern, expected] of textChecks) {
  expectValue(path, read(path).match(pattern)?.[1], expected);
}

const xcodeVersions = [...read('apple/AgentDeck.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g)]
  .map((match) => match[1]);
if (xcodeVersions.length === 0 || xcodeVersions.some((version) => version !== productVersion)) {
  failures.push(`apple/AgentDeck.xcodeproj/project.pbxproj: MARKETING_VERSION mirrors must all be ${productVersion}`);
}

/**
 * Bundled profiles are DISCOVERED, not listed.
 *
 * This used to be six hardcoded paths, three of which pointed at `.sdProfile`
 * copies. Deleting those copies (the manifest schema references
 * `.streamDeckProfile`) made this script crash with ENOENT instead of
 * reporting a version mismatch — a check that fails on its own file list is
 * worse than no check. Walking the plugin directory keeps it correct when
 * profiles are added, removed or renamed.
 */
function findProfileManifests() {
  const pluginDir = 'plugin/bound.serendipity.agentdeck.sdPlugin';
  const abs = resolve(root, pluginDir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.streamDeckProfile')) continue;
    const pagesDir = resolve(abs, entry.name, 'Profiles');
    if (!existsSync(pagesDir)) continue;
    for (const page of readdirSync(pagesDir, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      const manifest = `${pluginDir}/${entry.name}/Profiles/${page.name}/manifest.json`;
      if (existsSync(resolve(root, manifest))) out.push(manifest);
    }
  }
  return out;
}

const profilePaths = findProfileManifests();
if (profilePaths.length === 0) {
  failures.push('plugin/bound.serendipity.agentdeck.sdPlugin: no bundled .streamDeckProfile page manifests found');
}
for (const path of profilePaths) {
  const versions = [...read(path).matchAll(/"Version"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  if (versions.length === 0 || versions.some((version) => version !== `${productVersion}.0`)) {
    failures.push(`${path}: embedded plugin versions must all be ${productVersion}.0`);
  }
}

if (failures.length > 0) {
  console.error(`Product version drift (VERSION=${productVersion}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Product version ${productVersion} is synchronized across all release surfaces.`);
