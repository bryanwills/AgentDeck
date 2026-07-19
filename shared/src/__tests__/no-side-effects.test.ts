/**
 * Guard for the `"sideEffects": false` declaration in shared/package.json.
 *
 * That flag is a promise to every bundler that importing any module here can be
 * skipped when its exports go unused. The Stream Deck plugin relies on it to
 * drop modules it never touches. If someone later adds import-time work — a
 * registry population, a global mutation, a timer, a file read — the bundler is
 * entitled to delete it, and the failure appears only in a bundled artifact.
 * Normal unit tests import source directly and would stay green, so the
 * assertion has to be checked structurally instead.
 *
 * This scans for TOP-LEVEL executable statements. Declarations (import/export,
 * const/let/function/class/type/interface) are fine; a bare statement at module
 * scope is not.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments and template/string literals so their contents can't match. */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');
}

/**
 * A line starts a top-level statement if it is at column 0 and does not begin a
 * declaration. Most continuation lines of a multi-line declaration are indented,
 * but closers are not — a multi-line generic ends on a column-0 `>;` — so the
 * bracket/punctuation set below is treated as continuation, not as a statement.
 */
const DECLARATION =
  /^(import|export|const|let|var|function|async|class|type|interface|enum|declare|abstract|[}\])>,;:|&?`/*]|$)/;

/** Import-time work that `sideEffects: false` would let a bundler delete. */
const FORBIDDEN = [
  { pattern: /^\s*(globalThis|process|window|global)\s*[.[]\s*\S+\s*=/, label: 'global mutation' },
  { pattern: /^\s*\w+\.prototype\s*[.[]/, label: 'prototype patching' },
  { pattern: /^\s*(setTimeout|setInterval|setImmediate)\s*\(/, label: 'timer' },
  { pattern: /^\s*Object\.(defineProperty|freeze|assign)\s*\(/, label: 'object mutation' },
  { pattern: /^\s*\(\s*(async\s*)?\(\s*\)\s*=>/, label: 'IIFE' },
  { pattern: /^\s*(readFileSync|writeFileSync|mkdirSync|execSync|execFileSync)\s*\(/, label: 'file/process I/O' },
];

describe('shared is side-effect free', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no top-level executable statements', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = stripNonCode(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, i) => {
        if (line.length === 0 || /^\s/.test(line)) return;   // indented = inside a block
        if (DECLARATION.test(line)) return;
        offenders.push(`${file.replace(SRC, 'shared/src')}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders, `Top-level statements break "sideEffects": false:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('performs no import-time I/O, timers, or global mutation', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = stripNonCode(readFileSync(file, 'utf-8')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s/.test(line)) return;   // only module scope
        for (const { pattern, label } of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${file.replace(SRC, 'shared/src')}:${i + 1}: ${label}`);
          }
        }
      });
    }
    expect(offenders, `Import-time side effects found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('declares sideEffects: false so bundlers actually act on this', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf-8'));
    expect(pkg.sideEffects).toBe(false);
  });
});
