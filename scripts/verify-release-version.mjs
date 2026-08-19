#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readTargetVersion, releaseTargets, validateReleaseVersion } from './release-version.mjs';
import { findEntry, parseTag } from './release-notes.mjs';

const [target, tagVersion] = process.argv.slice(2);

if (!target || !tagVersion) {
  console.error(`Usage: node scripts/verify-release-version.mjs <${releaseTargets.join('|')}> <X.Y.Z>`);
  process.exit(2);
}

try {
  const root = resolve(import.meta.dirname, '..');
  const declaredVersion = readTargetVersion(root, target);
  validateReleaseVersion(target, tagVersion, declaredVersion);
  console.log(`${target} release tag ${tagVersion} matches its target source version.`);

  // A release with no changelog entry used to publish anyway, with an install
  // blurb where its notes should have been — every workflow hardcoded a static
  // body, so nothing anywhere noticed that five channels shipped a whole new
  // agent without a line about it. The body is rendered from CHANGELOG.md now,
  // so an absent entry is a release that would ship blank: fail here, before
  // anything is built or published.
  const { label } = parseTag(`${target}-v${tagVersion}`);
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  if (!findEntry(changelog, { version: tagVersion, label })) {
    throw new Error(
      `CHANGELOG.md has no entry for ${target} ${tagVersion}.\n` +
        `Add a section whose heading names this channel and version, e.g.\n` +
        `  ## ${new Date().toISOString().slice(0, 10)} — ${label} ${tagVersion}\n` +
        `A heading may list several channels when one round is cut across them.`,
    );
  }
  console.log(`${target} ${tagVersion} has a CHANGELOG entry.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
