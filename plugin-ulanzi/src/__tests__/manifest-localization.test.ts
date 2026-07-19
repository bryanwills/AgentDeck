import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Ulanzi SDK maps a localization file's `Actions` array onto
// `manifest.json`'s by index, so a longer or reordered array silently
// mislabels the action in the palette (this shipped once: en.json still
// carried the five pre-consolidation actions while the manifest declared
// one, so the palette read "Session" instead of "AgentDeck").
const PLUGIN_DIR = join(
  __dirname,
  '..',
  '..',
  'com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin',
);

const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(PLUGIN_DIR, name), 'utf8'));

describe('ulanzi manifest ↔ localization alignment', () => {
  const manifest = readJson('manifest.json');
  const manifestActions = manifest.Actions as Array<{ Name: string; Tooltip?: string }>;

  it('declares exactly one dynamic action', () => {
    expect(manifestActions).toHaveLength(1);
    expect(manifestActions[0].Name).toBe('AgentDeck');
  });

  for (const locale of ['en'] as const) {
    it(`${locale}.json Actions is index-aligned with the manifest`, () => {
      const localization = readJson(`${locale}.json`);
      const actions = localization.Actions as Array<{ Name: string; Tooltip?: string }>;

      expect(actions).toHaveLength(manifestActions.length);
      actions.forEach((action, index) => {
        expect(action.Name).toBe(manifestActions[index].Name);
        expect(action.Tooltip).toBe(manifestActions[index].Tooltip);
      });
    });
  }
});
