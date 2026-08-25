/**
 * "Latest version" on a dev checkout is a fact about two clocks — source vs
 * build — and about two processes: the daemon holding the port vs the code on
 * disk. Neither is visible anywhere else, because `dist/cli.js` is overwritten
 * in place: a daemon started before a rebuild reports the same pid, port and
 * package version as one started after it.
 *
 * These tests drive the two predicates that answer those questions. The
 * staleness one is exercised against a real temp tree with real mtimes rather
 * than a mocked `statSync`, because the failure it exists to catch is about
 * WHICH files count (a test edit must not read as a stale build, a package with
 * no dist at all must).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeDistBuildIdentity,
  distBuildIdentity,
  distBuildId,
  findStaleSources,
  findSourceCheckout,
  buildPackages,
} from '../daemon-build-identity.js';

let root: string;

/** Seconds since epoch, so utimes takes it directly. */
const T0 = 1_700_000_000;

function write(path: string, body: string, atSeconds: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  utimesSync(path, atSeconds, atSeconds);
}

/** A workspace with one built package: src at T0, dist at T0 + 60s. */
function seedPackage(pkg: string, opts: { srcAt?: number; distAt?: number | null } = {}): void {
  const srcAt = opts.srcAt ?? T0;
  write(join(root, pkg, 'src', 'index.ts'), 'export const x = 1;\n', srcAt);
  const distAt = opts.distAt === undefined ? srcAt + 60 : opts.distAt;
  if (distAt !== null) write(join(root, pkg, 'dist', 'index.js'), 'export const x = 1;\n', distAt);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentdeck-build-id-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "*"\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('findStaleSources', () => {
  it('reports nothing when every build is newer than its source', () => {
    for (const pkg of ['shared', 'hooks', 'bridge']) seedPackage(pkg);
    expect(findStaleSources(root)).toEqual([]);
  });

  it('names the package and the newest unbuilt file', () => {
    seedPackage('shared');
    seedPackage('hooks');
    seedPackage('bridge');
    // An edit after the last build — the case the whole feature is about.
    write(join(root, 'bridge', 'src', 'daemon-server.ts'), 'export const y = 2;\n', T0 + 600);

    const stale = findStaleSources(root);
    expect(stale.map((s) => s.pkg)).toEqual(['bridge']);
    expect(stale[0].newestSource.endsWith('daemon-server.ts')).toBe(true);
    expect(stale[0].sourceMtimeMs).toBeGreaterThan(stale[0].distMtimeMs);
  });

  it('compares per package, not against one global build time', () => {
    // shared was edited after ITS build; bridge was built later still. A single
    // newest-dist timestamp would call shared current — and the daemon would
    // load a stale shared/dist with nothing saying so.
    seedPackage('shared', { srcAt: T0 + 300, distAt: T0 + 60 });
    seedPackage('bridge', { srcAt: T0, distAt: T0 + 900 });
    expect(findStaleSources(root).map((s) => s.pkg)).toEqual(['shared']);
  });

  it('treats a package that has never been built as stale', () => {
    seedPackage('bridge', { distAt: null });
    const stale = findStaleSources(root);
    expect(stale.map((s) => s.pkg)).toEqual(['bridge']);
    expect(stale[0].distMtimeMs).toBe(0);
  });

  it('ignores test sources — they compile to nothing the daemon loads', () => {
    // Counting them would report a stale build after every test edit, and a
    // warning that fires constantly is one nobody reads.
    seedPackage('bridge');
    write(join(root, 'bridge', 'src', '__tests__', 'thing.test.ts'), 'test\n', T0 + 900);
    write(join(root, 'bridge', 'src', 'other.test.ts'), 'test\n', T0 + 900);
    write(join(root, 'bridge', 'src', 'types.d.ts'), 'declare const z: 1;\n', T0 + 900);
    expect(findStaleSources(root)).toEqual([]);
  });

  it('says nothing about a package it cannot see', () => {
    // A checkout without `hooks` is not a checkout with a stale `hooks`.
    seedPackage('bridge');
    expect(findStaleSources(root)).toEqual([]);
  });
});

describe('findSourceCheckout', () => {
  it('finds the workspace root from a package inside it', () => {
    mkdirSync(join(root, 'bridge', 'src'), { recursive: true });
    mkdirSync(join(root, 'bridge', 'dist'), { recursive: true });
    expect(findSourceCheckout(join(root, 'bridge'))).toBe(root);
  });

  it('returns null for an installed package (a dist with no src beside it)', () => {
    // Both markers are required: an installed @agentdeck/bridge has neither a
    // sibling `src` nor a workspace file above it, and rebuilding there is not
    // a thing that can succeed.
    const installed = join(root, 'node_modules', '@agentdeck', 'bridge');
    mkdirSync(join(installed, 'dist'), { recursive: true });
    rmSync(join(root, 'pnpm-workspace.yaml'));
    expect(findSourceCheckout(installed)).toBeNull();
  });
});

describe('distBuildIdentity', () => {
  it('answers the same digest every time within a process', () => {
    const first = distBuildIdentity();
    const second = distBuildIdentity();
    expect(second).toBe(first);
    // The memo is the contract, not an optimisation: the daemon captures this
    // once at startup, so a rebuild underneath it must show as a mismatch
    // rather than being absorbed by a fresh read.
    expect(distBuildId()).toBe(first.id);
  });

  it('recomputes on demand for the before/after comparison around a build', () => {
    // Same tree, so the same digest — what matters is that the uncached entry
    // point READ the tree rather than answering from the memo the daemon
    // depends on staying frozen.
    expect(computeDistBuildIdentity().id).toBe(distBuildIdentity().id);
    expect(computeDistBuildIdentity()).not.toBe(distBuildIdentity());
  });

  it('is a short hex digest over real build output', () => {
    const identity = distBuildIdentity();
    // This suite runs against a built repo; if that ever stops being true the
    // assertion below should fail loudly rather than be relaxed to `?.`.
    expect(identity.files).toBeGreaterThan(0);
    expect(identity.id).toMatch(/^[0-9a-f]{12}$/);
    expect(identity.trees.length).toBeGreaterThan(0);
  });
});

describe('buildPackages', () => {
  it('does nothing when nothing is stale', () => {
    expect(buildPackages(root, [])).toEqual({ ok: true });
  });

  it('reports a missing package manager as a reason, not as a failed build', () => {
    // "pnpm is not installed" and "your code does not compile" call for
    // different actions, and a bare ok:false would collapse them.
    const result = buildPackages(root, ['bridge'], join(root, 'no-such-pnpm'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not on PATH/);
  });
});
