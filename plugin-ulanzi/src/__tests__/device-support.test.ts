import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(
  new URL('../../com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/manifest.json', import.meta.url),
  'utf8',
)) as {
  Devices: string[];
  Actions: Array<{ Controllers?: string[]; Encoder?: unknown }>;
};

describe('Ulanzi device support contract', () => {
  it('offers the existing 14-key action on both D200H and D200X', () => {
    expect(manifest.Devices).toEqual(['D200H', 'D200X']);
    expect(manifest.Actions).toHaveLength(1);
    expect(manifest.Actions[0]?.Controllers).toEqual(['Keypad']);
  });

  it('does not claim D200X encoder support before an encoder action exists', () => {
    expect(manifest.Actions[0]?.Controllers).not.toContain('Encoder');
    expect(manifest.Actions[0]?.Encoder).toBeUndefined();
  });
});
