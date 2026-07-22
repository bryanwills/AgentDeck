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

const productMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(productVersion);
const productMajor = Number(productMatch?.[1]);
const productMinor = Number(productMatch?.[2]);
const productPatch = Number(productMatch?.[3]);

function expectCompatible(path, actual) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(actual ?? '');
  if (!match) {
    failures.push(`${path}: expected numeric X.Y.Z SemVer, found ${actual ?? '<missing>'}`);
    return;
  }
  const [, major, minor, patch] = match.map(Number);
  if (major !== productMajor || minor !== productMinor) {
    failures.push(`${path}: expected compatibility line ${productMajor}.${productMinor}.x, found ${actual}`);
  } else if (patch > productPatch) {
    failures.push(`${path}: patch ${actual} is ahead of root VERSION ${productVersion}`);
  }
}

function jsonVersion(path, key = 'version') {
  return JSON.parse(read(path))[key];
}

expectValue('package.json', jsonVersion('package.json'), productVersion);

// Major.minor is the cross-target compatibility contract. Patch versions are
// delivery counters and may lag on targets that were not part of a hotfix.
// Packages that ship together inside one target must still agree exactly.
const npmVersion = jsonVersion('bridge/package.json');
expectCompatible('bridge/package.json', npmVersion);
for (const path of ['hooks/package.json', 'shared/package.json', 'setup/package.json']) {
  expectValue(path, jsonVersion(path), npmVersion);
}

const streamDeckVersion = jsonVersion('plugin/package.json');
expectCompatible('plugin/package.json', streamDeckVersion);
const ulanziVersion = jsonVersion('plugin-ulanzi/package.json');
expectCompatible('plugin-ulanzi/package.json', ulanziVersion);

for (const path of ['hooks/package.json', 'shared/package.json', 'bridge/package.json', 'setup/package.json']) {
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
  ulanziVersion,
);
const streamDeckManifestPath = 'plugin/bound.serendipity.agentdeck.sdPlugin/manifest.json';
const streamDeckManifest = JSON.parse(read(streamDeckManifestPath));
expectValue(streamDeckManifestPath, streamDeckManifest.Version, `${streamDeckVersion}.0`);
for (const [name, deviceType] of [
  ['agentdeck-sd', 0],
  ['agentdeck-sdmini', 1],
  ['agentdeck-sdplus', 7],
]) {
  const profile = streamDeckManifest.Profiles?.find((candidate) => candidate.Name === name);
  expectValue(`${streamDeckManifestPath} profile ${name}`, profile?.DeviceType, deviceType);
}

const appleVersion = read('apple/project.yml').match(/MARKETING_VERSION:\s*"([^"]+)"/)?.[1];
const androidVersion = read('android/app/build.gradle.kts').match(/versionName\s*=\s*"([^"]+)"/)?.[1];
const esp32Version = read('esp32/src/config.h').match(/FIRMWARE_VERSION\s*=\s*"([^"]+)"/)?.[1];
const daemonVersion = read('bridge/src/daemon.ts').match(/\.version\('([^']+)'\)/)?.[1];
expectCompatible('apple/project.yml', appleVersion);
expectCompatible('android/app/build.gradle.kts', androidVersion);
expectCompatible('esp32/src/config.h', esp32Version);
expectValue('bridge/src/daemon.ts', daemonVersion, npmVersion);

const xcodeVersions = [
  ...read('apple/AgentDeck.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g),
].map((match) => match[1]);
if (xcodeVersions.length === 0 || xcodeVersions.some((version) => version !== appleVersion)) {
  failures.push(`apple/AgentDeck.xcodeproj/project.pbxproj: MARKETING_VERSION mirrors must all be ${appleVersion}`);
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
  if (versions.length === 0 || versions.some((version) => version !== `${streamDeckVersion}.0`)) {
    failures.push(`${path}: embedded plugin versions must all be ${streamDeckVersion}.0`);
  }
}

if (failures.length > 0) {
  console.error(`Compatibility/version drift (VERSION=${productVersion}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Compatibility line ${productMajor}.${productMinor} is synchronized; target patches: ` +
    `npm ${npmVersion}, Apple ${appleVersion}, Android ${androidVersion}, ESP32 ${esp32Version}, ` +
    `Stream Deck ${streamDeckVersion}, Ulanzi ${ulanziVersion}.`,
);
