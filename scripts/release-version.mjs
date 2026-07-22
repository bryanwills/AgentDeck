import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseNumericVersion } from './version-policy.mjs';

function read(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function jsonVersion(root, path) {
  return JSON.parse(read(root, path)).version;
}

export const releaseTargets = Object.freeze(['npm', 'streamdeck', 'ulanzi', 'android', 'esp32', 'apple']);

export function readTargetVersion(root, target) {
  switch (target) {
    case 'npm':
      return jsonVersion(root, 'bridge/package.json');
    case 'streamdeck':
      return jsonVersion(root, 'plugin/package.json');
    case 'ulanzi':
      return jsonVersion(root, 'plugin-ulanzi/package.json');
    case 'android':
      return read(root, 'android/app/build.gradle.kts').match(/versionName\s*=\s*"([^"]+)"/)?.[1];
    case 'esp32':
      return read(root, 'esp32/src/config.h').match(/FIRMWARE_VERSION\s*=\s*"([^"]+)"/)?.[1];
    case 'apple':
      return read(root, 'apple/project.yml').match(/MARKETING_VERSION:\s*"([^"]+)"/)?.[1];
    default:
      throw new Error(`Unknown release target ${target}; expected one of: ${releaseTargets.join(', ')}`);
  }
}

export function validateReleaseVersion(target, tagVersion, declaredVersion) {
  if (!parseNumericVersion(tagVersion)) {
    throw new Error(`${target} tag: expected numeric X.Y.Z SemVer, found ${tagVersion || '<empty>'}`);
  }
  if (!parseNumericVersion(declaredVersion)) {
    throw new Error(`${target} source: expected numeric X.Y.Z SemVer, found ${declaredVersion || '<missing>'}`);
  }
  if (tagVersion !== declaredVersion) {
    throw new Error(`${target} tag ${tagVersion} does not match target source version ${declaredVersion}`);
  }
}
