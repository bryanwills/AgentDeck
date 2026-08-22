#!/usr/bin/env node
/**
 * Emit `dist/flash/THIRD-PARTY.txt` — the notices the browser flasher owes for
 * what it bundles.
 *
 * The flasher is the one Pages surface that ships someone else's code in its
 * JavaScript: esptool-js is Apache-2.0, whose §4(d) requires the NOTICE to
 * travel with any redistribution, and a bundled `.js` is a redistribution. Every
 * other surface here renders our own output.
 *
 * Read from `node_modules` at build time rather than checked in: a pinned copy
 * of a licence goes stale silently the first time a dependency bumps, and the
 * one thing this file must be is accurate about what actually shipped.
 *
 *   node scripts/generate-flash-third-party.mjs [outDir]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages whose code lands in the browser bundle, each named with the package
 * that pulls it in. Under pnpm a transitive dependency is NOT resolvable from
 * the repo root — `pako` is esptool-js's dependency and lives in its subtree —
 * so the importer is part of the identity, not a detail.
 */
const BUNDLED = [
  { name: 'esptool-js', from: 'root' },
  { name: 'pako', from: 'esptool-js' },
  { name: 'atob-lite', from: 'esptool-js' },
  { name: 'tslib', from: 'esptool-js' },
];

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license'];
const NOTICE_NAMES = ['NOTICE', 'NOTICE.txt', 'NOTICE.md'];

function pick(dir, names) {
  for (const n of names) {
    const p = join(dir, n);
    if (existsSync(p)) return readFileSync(p, 'utf8').trimEnd();
  }
  return undefined;
}

export function renderThirdParty(entries) {
  const head = [
    'AgentDeck web flasher — third-party notices',
    '',
    'The page you are using bundles the packages below. AgentDeck itself is MIT',
    'licensed (https://github.com/puritysb/AgentDeck/blob/master/LICENSE).',
    '',
  ];
  const body = entries.flatMap((e) => [
    '='.repeat(78),
    `${e.name} ${e.version} — ${e.license}`,
    e.homepage ? e.homepage : '',
    '='.repeat(78),
    '',
    e.license_text ?? '(no licence file published with this package)',
    '',
    ...(e.notice_text ? ['-- NOTICE --', '', e.notice_text, ''] : []),
  ]);
  return [...head, ...body].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/**
 * pnpm's store is not flat: `pako` is a dependency OF esptool-js and lives under
 * its own tree (or `.pnpm/`), not at `node_modules/pako`. So each package is
 * resolved the way Node would resolve it — from the importer that pulls it in —
 * rather than by path assembly, which is what fails here on a pnpm install and
 * would go on failing silently on npm the day a hoist changes.
 */
export function packageDir(name, fromFile) {
  const req = createRequire(fromFile);
  try {
    return dirname(req.resolve(`${name}/package.json`));
  } catch {
    // Not every package exports its package.json; fall back to walking up from
    // whatever entry point does resolve.
    let dir = dirname(req.resolve(name));
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, 'package.json'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    throw new Error(`third-party: cannot locate ${name} from ${fromFile}`);
  }
}

export function collect(bundled, rootPackageJson) {
  const dirs = new Map([['root', rootPackageJson]]);
  return bundled.map(({ name, from }) => {
    const importer = dirs.get(from);
    if (!importer) throw new Error(`third-party: ${name} names an unresolved importer "${from}"`);
    const dir = packageDir(name, importer);
    dirs.set(name, join(dir, 'package.json'));
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return {
      name,
      version: pkg.version,
      license: pkg.license ?? 'see licence text',
      homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url),
      license_text: pick(dir, LICENSE_NAMES),
      notice_text: pick(dir, NOTICE_NAMES),
    };
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = resolve(root, process.argv[2] ?? 'dist/flash');
  // Resolve from the repo root's own package.json: esptool-js is a direct
  // dependency there, and its transitive deps resolve onward from it.
  const entries = collect(BUNDLED, join(root, 'package.json'));
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'THIRD-PARTY.txt');
  writeFileSync(out, renderThirdParty(entries));
  console.log(`third-party notices → ${out} (${entries.length} packages)`);
}
