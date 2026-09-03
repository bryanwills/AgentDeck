import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const expectedEngine = '22.x || 24.x || 26.x';

describe('Node runtime support contract', () => {
  it.each(['package.json', 'bridge/package.json', 'hooks/package.json', 'shared/package.json', 'setup/package.json'])(
    '%s advertises only the prebuild-verified maintained lines',
    (relativePath) => {
      const pkg = JSON.parse(readFileSync(`${root}/${relativePath}`, 'utf-8')) as {
        engines?: { node?: string };
      };
      expect(pkg.engines?.node).toBe(expectedEngine);
    },
  );

  it('makes the workspace engine contract an install-time failure', () => {
    const workspace = readFileSync(`${root}/pnpm-workspace.yaml`, 'utf-8');
    expect(workspace).toMatch(/^engineStrict: true$/m);
  });
});
