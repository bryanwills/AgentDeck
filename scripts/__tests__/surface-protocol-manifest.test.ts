import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = resolve(projectRoot, 'schemas/surface-protocol/v1/integration-manifest.schema.json');
const fixturePaths = [
  'schemas/surface-protocol/v1/fixtures/pocket-daily-reader.json',
  'schemas/surface-protocol/v1/fixtures/bitfocus-companion.json',
];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8')) as Record<string, unknown>;
}

describe('Surface Protocol integration manifest', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  it.each(fixturePaths)('validates %s', (fixturePath) => {
    const fixture = readJson(fixturePath);
    expect(validate(fixture), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('keeps product identity separate from board and update channel', () => {
    const fixture = readJson(fixturePaths[0]) as {
      products: Array<{
        productId: string;
        otaIdentities: Array<{ board: string; updateChannel: string }>;
      }>;
    };
    const [product] = fixture.products;

    expect(product.productId).toBe('io.pocketdaily.reader');
    expect(product.otaIdentities).toEqual([
      { board: 'xteink_x3', updateChannel: 'stable' },
      { board: 'xteink_x4', updateChannel: 'stable' },
    ]);
  });

  it('rejects duplicate capabilities instead of hiding a malformed declaration', () => {
    const fixture = readJson(fixturePaths[1]) as {
      profiles: Array<{ capabilities: string[] }>;
    };
    fixture.profiles[0].capabilities.push(fixture.profiles[0].capabilities[0]);

    expect(validate(fixture)).toBe(false);
  });

  it('requires evidence for Verified Compatible and Official claims', () => {
    const fixture = readJson(fixturePaths[1]) as {
      compatibilityTier: string;
      conformance: { status: string };
    };
    fixture.compatibilityTier = 'verified-compatible';
    fixture.conformance = { status: 'passed' };

    expect(validate(fixture)).toBe(false);
    expect(validate.errors?.some((error) => error.instancePath === '/conformance')).toBe(true);
  });

  it('does not allow an independently owned project to claim Official', () => {
    const fixture = readJson(fixturePaths[1]) as {
      compatibilityTier: string;
      ownership: { type: string };
      conformance: Record<string, unknown>;
    };
    fixture.compatibilityTier = 'official';
    fixture.conformance = {
      status: 'passed',
      verifiedAt: '2026-08-24T00:00:00Z',
      evidence: 'https://example.com/conformance.json',
      daemonVersions: ['node/1.0.24'],
      manifestDigest: `sha256:${'0'.repeat(64)}`,
    };

    expect(validate(fixture)).toBe(false);
    expect(validate.errors?.some((error) => error.instancePath === '/ownership/type')).toBe(true);
  });
});
