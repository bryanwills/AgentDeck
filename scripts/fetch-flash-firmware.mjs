#!/usr/bin/env node
/**
 * Place the firmware the browser flasher writes NEXT TO the page that writes it.
 *
 * WHY THIS EXISTS AT ALL. GitHub Release assets carry no CORS headers —
 * measured with `curl -I -H 'Origin: https://puritysb.github.io'` against both
 * the 302 and the 200, neither answers `access-control-allow-origin` — so a
 * page on github.io simply cannot read them. Pages deploys from a workflow
 * here, so the images can be fetched at deploy time and served same-origin.
 * Nothing is committed to git.
 *
 *   node scripts/fetch-flash-firmware.mjs --out _site/flash/fw [--tag esp32-v1.0.7]
 *
 * TAG RESOLUTION, in this order, and it SAYS which one it used:
 *   1. --tag
 *   2. esp32-v<FIRMWARE_VERSION from esp32/src/config.h>, if that release exists
 *   3. the newest esp32-v* release
 * Rule 2 alone breaks on the master pushes between a version bump and its tag;
 * rule 3 alone makes the deployed firmware non-deterministic. Both, in order.
 *
 * Only `webFlash` boards are fetched: the full set is ~26MB of merged images
 * and the offered set is ~6MB, and a board the page will not write is a board
 * whose image nobody can reach from here.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function firmwareVersionFromConfig(source) {
  const m = /FIRMWARE_VERSION\s*=\s*"([^"]+)"/.exec(source);
  return m ? m[1] : undefined;
}

const gh = (args, opts = {}) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function releaseExists(tag) {
  try {
    gh(['release', 'view', tag, '--json', 'tagName']);
    return true;
  } catch {
    return false;
  }
}

function releaseAssets(tag) {
  try {
    return JSON.parse(gh(['release', 'view', tag, '--json', 'assets'])).assets.map((a) => a.name);
  } catch {
    return [];
  }
}

function latestEsp32Tag() {
  const out = gh(['release', 'list', '--limit', '100', '--json', 'tagName,createdAt']);
  const rows = JSON.parse(out)
    .filter((r) => /^esp32-v/.test(r.tagName))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows[0]?.tagName;
}

/** @returns {{tag: string, source: 'flag'|'config'|'latest'}} */
export function resolveTag({ flag, configVersion, exists, latest }) {
  if (flag) return { tag: flag, source: 'flag' };
  if (configVersion) {
    const candidate = `esp32-v${configVersion}`;
    if (exists(candidate)) return { tag: candidate, source: 'config' };
  }
  const l = latest();
  if (!l) throw new Error('no esp32-v* release found and no --tag given');
  return { tag: l, source: 'latest' };
}

const sha256 = (file) => crypto.createHash('sha256').update(readFileSync(file)).digest('hex');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const outRoot = resolve(root, arg('out') ?? '_site/flash/fw');
  // `--print-tag` resolves and prints, writing nothing. The Pages workflow needs
  // the tag BEFORE actions/cache runs (it is the cache key), and having the
  // workflow re-derive it in bash meant the real decision was made by an
  // untested duplicate while the tested resolveTag() only ever saw an explicit
  // --tag. One implementation, used twice.
  const printOnly = process.argv.includes('--print-tag');
  const configVersion = existsSync(join(root, 'esp32/src/config.h'))
    ? firmwareVersionFromConfig(readFileSync(join(root, 'esp32/src/config.h'), 'utf8'))
    : undefined;

  const { tag, source } = resolveTag({
    flag: arg('tag'),
    configVersion,
    exists: releaseExists,
    latest: latestEsp32Tag,
  });
  const why = { flag: '--tag', config: 'esp32/src/config.h FIRMWARE_VERSION', latest: 'newest esp32-v* release' }[source];
  if (printOnly) {
    // stderr carries the reasoning so stdout stays a bare tag the caller can capture.
    console.error(`firmware tag: ${tag} (from ${why})`);
    process.stdout.write(`${tag}\n`);
    return;
  }
  console.log(`firmware tag: ${tag} (from ${why})`);

  const dir = join(outRoot, tag);
  mkdirSync(dir, { recursive: true });

  // TWO DIFFERENT FAILURES, and they must not be conflated.
  //
  // A release with NO manifest at all predates the merged-image pipeline —
  // every esp32-v* up to and including 1.0.6 is in that state. That is not a
  // fault to fail a Pages deploy over: the flasher still deploys, its own
  // "no firmware deployed" branch tells the user so in their language, and it
  // hands them the CLI. Failing here would take the whole site down for a
  // condition the next firmware cut fixes on its own.
  //
  // A manifest that IS published and does not match its files is the opposite:
  // it means the deployed page would write bytes nobody can vouch for, and
  // that fails hard, below.
  if (!releaseAssets(tag).includes('manifest.json')) {
    console.log(
      `${tag} publishes no manifest.json — it predates the merged-image pipeline.\n` +
        '  The flasher will deploy WITHOUT firmware and will say so. Cut an esp32-v* release\n' +
        '  from current master to give it something to write.',
    );
    return;
  }

  // The manifest names the files AND their hashes, so it is downloaded first
  // and everything after is checked against it.
  gh(['release', 'download', tag, '--pattern', 'manifest.json', '--dir', dir, '--clobber']);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

  const offered = manifest.boards.filter((b) => b.webFlash && b.merged);
  if (offered.length === 0) {
    throw new Error(`${tag} publishes no webFlash board with a merged image — nothing to serve`);
  }

  let bytes = 0;
  for (const b of offered) {
    const file = b.merged.file;
    const dest = join(dir, file);
    // A cache hit is re-verified, never trusted: a bit-rotted cached image is a
    // bricked board, and the cache key only proves which tag it came from.
    if (!existsSync(dest) || statSync(dest).size !== b.merged.size || sha256(dest) !== b.merged.sha256) {
      gh(['release', 'download', tag, '--pattern', file, '--dir', dir, '--clobber']);
    }
    const got = sha256(dest);
    if (got !== b.merged.sha256) {
      // Fail the deploy. A flasher that ships without firmware, or with the
      // wrong firmware, is worse than a deploy that went red.
      throw new Error(
        `${file}: sha256 ${got} ≠ manifest ${b.merged.sha256} — refusing to publish a flasher that cannot be trusted`,
      );
    }
    bytes += b.merged.size;
    console.log(`  ok ${file}  ${(b.merged.size / 1e6).toFixed(2)} MB  ${got.slice(0, 12)}…`);
  }

  // The one file at a stable URL. Everything else lives under the tag, so a
  // stale cache can at worst point at a previous release's directory — it can
  // never serve last release's bits under this release's name.
  writeFileSync(
    join(outRoot, 'index.json'),
    `${JSON.stringify(
      {
        tag,
        firmwareVersion: manifest.firmwareVersion,
        resolvedFrom: source,
        boards: offered.map((b) => b.id),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${offered.length} board(s), ${(bytes / 1e6).toFixed(1)} MB → ${outRoot}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
