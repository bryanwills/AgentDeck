#!/usr/bin/env node

import { resolve } from 'node:path';

import { readTargetVersion, releaseTargets, validateReleaseVersion } from './release-version.mjs';

const [target, tagVersion] = process.argv.slice(2);

if (!target || !tagVersion) {
  console.error(`Usage: node scripts/verify-release-version.mjs <${releaseTargets.join('|')}> <X.Y.Z>`);
  process.exit(2);
}

try {
  const declaredVersion = readTargetVersion(resolve(import.meta.dirname, '..'), target);
  validateReleaseVersion(target, tagVersion, declaredVersion);
  console.log(`${target} release tag ${tagVersion} matches its target source version.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
