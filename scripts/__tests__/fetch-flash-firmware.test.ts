/**
 * Which release the Pages flasher serves.
 *
 * The order matters and neither rule works alone: `config.h` alone breaks on
 * every master push between a version bump and its tag (the release does not
 * exist yet), and "newest release" alone makes the deployed firmware
 * non-deterministic — a rebuild of an old commit would ship a newer image than
 * the page was written for.
 */
import { describe, it, expect } from 'vitest';
import { firmwareVersionFromConfig, resolveTag } from '../fetch-flash-firmware.mjs';

describe('firmwareVersionFromConfig', () => {
  it('reads the constant', () => {
    expect(firmwareVersionFromConfig('constexpr const char* FIRMWARE_VERSION = "1.0.6";')).toBe('1.0.6');
  });
  it('returns undefined rather than a guess', () => {
    expect(firmwareVersionFromConfig('int x = 3;')).toBeUndefined();
  });
});

describe('resolveTag', () => {
  const latest = () => 'esp32-v1.0.9';
  const existsAll = () => true;
  const existsNone = () => false;

  it('an explicit --tag wins outright, without probing anything', () => {
    let probed = 0;
    const r = resolveTag({
      flag: 'esp32-v1.0.4',
      configVersion: '1.0.6',
      exists: () => { probed++; return true; },
      latest: () => { probed++; return 'esp32-v1.0.9'; },
    });
    expect(r).toEqual({ tag: 'esp32-v1.0.4', source: 'flag' });
    expect(probed).toBe(0);
  });

  it('prefers the checkout version when that release exists', () => {
    expect(resolveTag({ configVersion: '1.0.6', exists: existsAll, latest })).toEqual({
      tag: 'esp32-v1.0.6',
      source: 'config',
    });
  });

  it('falls back to the newest release when the checkout version has no tag yet', () => {
    // The window between a version bump on master and the tag that follows it —
    // the case that makes rule 2 insufficient on its own.
    expect(resolveTag({ configVersion: '1.0.7', exists: existsNone, latest })).toEqual({
      tag: 'esp32-v1.0.9',
      source: 'latest',
    });
  });

  it('falls back when the checkout has no version at all (installed, not cloned)', () => {
    expect(resolveTag({ exists: existsAll, latest }).source).toBe('latest');
  });

  it('refuses rather than deploying an unnamed firmware', () => {
    expect(() => resolveTag({ exists: existsNone, latest: () => undefined }))
      .toThrow(/no esp32-v\* release found/);
  });

  it('reports WHICH rule it used — a silently chosen tag is unauditable', () => {
    // The source is the whole point of the return shape: a wrong firmware
    // deployment and a right one look identical without it.
    const sources = [
      resolveTag({ flag: 'esp32-v1.0.1', exists: existsAll, latest }).source,
      resolveTag({ configVersion: '1.0.6', exists: existsAll, latest }).source,
      resolveTag({ configVersion: '1.0.6', exists: existsNone, latest }).source,
    ];
    expect(sources).toEqual(['flag', 'config', 'latest']);
  });
});
