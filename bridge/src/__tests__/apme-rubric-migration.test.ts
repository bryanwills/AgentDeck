import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore, DEFAULT_RUBRIC_PROMPT_LEGACY } from '../apme/store.js';

// Seed-time upgrade of the general judge rubric (missed-axis clarification,
// found by model-eval J02: judges filed style nits under `missed`, which the
// scorecard renders as skipped work). Rules under test:
//   - an untouched legacy prompt is upgraded via append (history kept)
//   - the upgrade is idempotent across daemon restarts
//   - a user-edited prompt is never touched

const CLARIFICATION = '"missed" lists only parts of the user\'s request that were not done';

async function openStore(path: string): Promise<ApmeStore> {
  const store = new ApmeStore(path);
  const ok = await store.init();
  if (!ok) throw new Error('APME store failed to initialize');
  return store;
}

describe('general rubric missed-axis migration', () => {
  it('fresh install seeds the clarified prompt directly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apme-rubmig-'));
    const store = await openStore(join(dir, 'apme.sqlite'));
    try {
      const general = store.getCurrentRubric('general');
      expect(general?.prompt).toContain(CLARIFICATION);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a byte-identical legacy prompt on reopen, appending with parentVer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apme-rubmig-'));
    const path = join(dir, 'apme.sqlite');
    let store = await openStore(path);
    // Simulate an old install: latest general rubric carries the legacy text.
    const legacyVer = store.appendRubric({
      purpose: 'general',
      prompt: DEFAULT_RUBRIC_PROMPT_LEGACY,
      weights: JSON.stringify({ task_completion: 0.5, code_quality: 0.3, efficiency: 0.2 }),
      createdAt: Date.now(),
      parentVer: null,
      notes: 'seeded default',
    });
    store.close();
    try {
      store = await openStore(path);
      const general = store.getCurrentRubric('general');
      expect(general?.prompt).toContain(CLARIFICATION);
      expect(general?.parentVer).toBe(legacyVer);
      expect(general?.notes).toBe('seeded default (missed-axis clarified)');

      // Idempotent: reopening again must not append another version.
      const upgradedVer = general?.version;
      store.close();
      store = await openStore(path);
      expect(store.getCurrentRubric('general')?.version).toBe(upgradedVer);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a user-edited general rubric alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apme-rubmig-'));
    const path = join(dir, 'apme.sqlite');
    let store = await openStore(path);
    const customVer = store.appendRubric({
      purpose: 'general',
      prompt: 'My own judge prompt — score everything as art.',
      weights: JSON.stringify({ overall: 1 }),
      createdAt: Date.now(),
      parentVer: null,
      notes: 'user edit',
    });
    store.close();
    try {
      store = await openStore(path);
      const general = store.getCurrentRubric('general');
      expect(general?.version).toBe(customVer);
      expect(general?.prompt).toBe('My own judge prompt — score everything as art.');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
