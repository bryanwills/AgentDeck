#!/usr/bin/env node
// Drift gate for hand-maintained preview mirrors.
//
// Some Device Preview renderers are hand-ported (Swift ← TS/C++/Kotlin) because
// the origin renderer can't run on that surface. Each such mirror declares the
// origin file(s) it was synced against with pin lines:
//
//   // SYNC-HASH <origin-repo-path> <git-blob-sha>
//
// where the sha is `git hash-object <origin-path>` at sync time. This script
// scans the repo for SYNC-HASH markers and fails when an origin's current
// content hash no longer matches its pin — i.e. the origin changed and the
// mirror was not re-synced (or the pin not consciously bumped).
//
// To fix a failure: port the origin change into the mirror (or verify the
// change is invisible to the mirrored surface), then update the pin to the new
// hash printed below. Bumping the pin is the explicit "I checked" ack —
// never bump it without looking at the origin diff.
//
// Run: node scripts/check-preview-mirror-sync.mjs   (CI runs this on every push)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = /SYNC-HASH\s+(\S+)\s+([0-9a-f]{40})/g;

const tracked = execFileSync('git', ['grep', '-l', 'SYNC-HASH'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => f !== 'scripts/check-preview-mirror-sync.mjs' && !f.endsWith('.md'));

let pins = 0;
const failures = [];
for (const mirror of tracked) {
  const text = fs.readFileSync(path.join(root, mirror), 'utf8');
  for (const [, origin, pinned] of text.matchAll(MARKER)) {
    pins++;
    if (!fs.existsSync(path.join(root, origin))) {
      failures.push({ mirror, origin, pinned, actual: '(missing file)' });
      continue;
    }
    const actual = execFileSync('git', ['hash-object', origin], { cwd: root, encoding: 'utf8' }).trim();
    if (actual !== pinned) failures.push({ mirror, origin, pinned, actual });
  }
}

if (pins === 0) {
  console.error('check-preview-mirror-sync: no SYNC-HASH markers found — expected pins in the hand-maintained preview mirrors.');
  process.exit(1);
}

if (failures.length) {
  console.error(`\n✘ ${failures.length} preview mirror pin(s) out of sync:\n`);
  for (const f of failures) {
    console.error(`  mirror : ${f.mirror}`);
    console.error(`  origin : ${f.origin}`);
    console.error(`  pinned : ${f.pinned}`);
    console.error(`  actual : ${f.actual}\n`);
  }
  console.error('The origin renderer changed after the mirror was last synced.');
  console.error('Port the visual change into the mirror (or confirm it does not affect the mirrored surface),');
  console.error('then update the SYNC-HASH pin in the mirror to the "actual" hash above — in the same commit.');
  process.exit(1);
}

console.log(`check-preview-mirror-sync: ${pins} pin(s) across ${tracked.length} mirror(s) — all in sync.`);
