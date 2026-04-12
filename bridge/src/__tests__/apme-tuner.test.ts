import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApmeStore } from '../apme/store.js';
import { ApmeCollector } from '../apme/collector.js';
import {
  ApmeTuner,
  collectDisagreements,
  parseProposal,
  extractOverall,
  correlation,
  vibeCorrelation,
} from '../apme/tuner.js';
import { DEFAULT_APME_CONFIG } from '../apme/settings.js';
import type { ApmeConfig } from '../apme/settings.js';

async function makeStore(): Promise<ApmeStore | null> {
  const dir = mkdtempSync(join(tmpdir(), 'apme-tuner-'));
  const store = new ApmeStore(join(dir, 'apme.sqlite'));
  if (!(await store.init())) { rmSync(dir, { recursive: true, force: true }); return null; }
  (store as unknown as { _tmp: string })._tmp = dir;
  return store;
}

function closeStore(s: ApmeStore) {
  if (!s) return;
  s.close();
  const dir = (s as unknown as { _tmp?: string })._tmp;
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a synthetic run with deterministic + judge + vibe signal so the
 * tuner has something to correlate against.
 */
function seedRun(
  store: ApmeStore,
  collector: ApmeCollector,
  opts: { id: string; task: string; testsPass: number; judgeOverall: number; vibe: 'approve' | 'reject' | 'neutral' | null },
): string {
  const runId = collector.openRun({
    sessionId: 's-' + opts.id, agentType: 'claude-code', projectName: 'p',
    projectPath: '/tmp/' + opts.id, taskPrompt: opts.task,
  });
  collector.closeRun('s-' + opts.id, 0, '/tmp/' + opts.id);
  store.insertEval({
    runId, layer: 'deterministic', metric: 'tests_pass',
    score: opts.testsPass, createdAt: Date.now(),
  });
  store.insertEval({
    runId, layer: 'llm_judge', metric: 'overall',
    score: opts.judgeOverall, rubricVer: 1, judgeModel: 'mlx:qwen3-30b',
    createdAt: Date.now(),
  });
  if (opts.vibe) {
    store.insertVibe({ runId, verdict: opts.vibe, ts: Date.now() });
  }
  return runId;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

describe('correlation', () => {
  it('returns 1 for perfectly aligned arrays', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });
  it('returns -1 for anti-aligned arrays', () => {
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it('returns null when variance is zero', () => {
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it('returns null when arrays are too short', () => {
    expect(correlation([1], [1])).toBeNull();
  });
});

describe('parseProposal', () => {
  it('extracts prompt + weights from a clean JSON blob', () => {
    const txt = `{"prompt": "Be strict about correctness first, style second. Penalize unrelated churn.", "weights": {"intent": 0.4, "correctness": 0.4, "style": 0.1, "convention": 0.1}, "notes": "try again"}`;
    const p = parseProposal(txt);
    expect(p).not.toBeNull();
    expect(p?.prompt.length).toBeGreaterThan(20);
    expect(p?.weights.intent).toBeCloseTo(0.4);
    expect(p?.notes).toBe('try again');
  });

  it('rejects proposals with too-short prompts', () => {
    const txt = `{"prompt": "short", "weights": {"intent": 1}}`;
    expect(parseProposal(txt)).toBeNull();
  });

  it('rejects proposals with no weights', () => {
    const txt = `{"prompt": "${'x'.repeat(30)}", "weights": {}}`;
    expect(parseProposal(txt)).toBeNull();
  });
});

describe('extractOverall', () => {
  it('parses overall score from a JSON blob', () => {
    expect(extractOverall('{"overall": 0.75}')).toBeCloseTo(0.75);
  });
  it('rescales 0-10 values', () => {
    expect(extractOverall('{"overall": 7}')).toBeCloseTo(0.7);
  });
  it('returns null when overall is missing', () => {
    expect(extractOverall('{"intent": 0.9}')).toBeNull();
  });
});

// ─── Disagreement collection ──────────────────────────────────────────────────

describe('collectDisagreements', () => {
  let store: ApmeStore = null;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { closeStore(store); store = null; });

  it('picks up tests-pass-judge-fail and user-reject-judge-approve cases', () => {
    const collector = new ApmeCollector(store);
    // Clear pass — should be ignored
    seedRun(store, collector, { id: 'a', task: 'clean refactor', testsPass: 1, judgeOverall: 0.9, vibe: 'approve' });
    // Disagreement: tests pass but judge says no
    seedRun(store, collector, { id: 'b', task: 'sloppy fix', testsPass: 1, judgeOverall: 0.3, vibe: null });
    // Disagreement: user rejects but judge approves
    seedRun(store, collector, { id: 'c', task: 'wrong approach', testsPass: 1, judgeOverall: 0.85, vibe: 'reject' });
    // Disagreement: tests fail but judge approves
    seedRun(store, collector, { id: 'd', task: 'broken but looks nice', testsPass: 0, judgeOverall: 0.9, vibe: null });

    const samples = collectDisagreements(store, 10);
    const ids = samples.map((s) => s.runId).length;
    expect(ids).toBeGreaterThanOrEqual(3);
    expect(samples.some((s) => s.note.includes('tests pass but judge fails'))).toBe(true);
    expect(samples.some((s) => s.note.includes('user rejected'))).toBe(true);
    expect(samples.some((s) => s.note.includes('tests fail but judge passes'))).toBe(true);
  });
});

// ─── vibeCorrelation ──────────────────────────────────────────────────────────

describe('vibeCorrelation', () => {
  it('returns high positive correlation when judge and user agree', () => {
    const samples = [
      { runId: '1', taskPrompt: '', judgeOverall: 0.9, testsPass: null, vibe: 'approve' as const, note: '' },
      { runId: '2', taskPrompt: '', judgeOverall: 0.85, testsPass: null, vibe: 'approve' as const, note: '' },
      { runId: '3', taskPrompt: '', judgeOverall: 0.2, testsPass: null, vibe: 'reject' as const, note: '' },
      { runId: '4', taskPrompt: '', judgeOverall: 0.1, testsPass: null, vibe: 'reject' as const, note: '' },
    ];
    const corr = vibeCorrelation(samples);
    expect(corr).not.toBeNull();
    expect(corr!).toBeGreaterThan(0.9);
  });

  it('returns null when there are too few labeled samples', () => {
    expect(vibeCorrelation([
      { runId: '1', taskPrompt: '', judgeOverall: 0.5, testsPass: null, vibe: 'approve', note: '' },
    ])).toBeNull();
  });
});

// ─── End-to-end tuner ─────────────────────────────────────────────────────────

describe('ApmeTuner.tune', () => {
  let store: ApmeStore = null;
  beforeEach(async () => { store = await makeStore(); });
  afterEach(() => { closeStore(store); store = null; });

  function cfg(): ApmeConfig { return { ...DEFAULT_APME_CONFIG, autoTune: true }; }

  function seedDisagreementCorpus(store: ApmeStore) {
    const collector = new ApmeCollector(store);
    // 4 cases where judge disagrees badly with user vibe
    seedRun(store, collector, { id: 'x1', task: 't1', testsPass: 1, judgeOverall: 0.9, vibe: 'reject' });
    seedRun(store, collector, { id: 'x2', task: 't2', testsPass: 1, judgeOverall: 0.85, vibe: 'reject' });
    seedRun(store, collector, { id: 'x3', task: 't3', testsPass: 1, judgeOverall: 0.2, vibe: 'approve' });
    seedRun(store, collector, { id: 'x4', task: 't4', testsPass: 1, judgeOverall: 0.25, vibe: 'approve' });
    seedRun(store, collector, { id: 'x5', task: 't5', testsPass: 0, judgeOverall: 0.9, vibe: 'reject' });
  }

  it('accepts a proposal that improves vibe correlation', async () => {
    seedDisagreementCorpus(store);
    const tuner = new ApmeTuner(store);
    tuner._setConfig(cfg());

    const proposal = {
      prompt: 'Prefer user intent over surface style. Give high overall when the change matches the task goal.',
      weights: { intent: 0.5, correctness: 0.3, style: 0.1, convention: 0.1 },
      notes: 'lean on intent',
    };
    tuner._setJudgeFn(async (prompt) => {
      if (prompt.includes('rubric meta-optimizer')) {
        // This is the meta call — return the new rubric.
        return JSON.stringify(proposal);
      }
      // Shadow scoring pass — invert the previous judge so it now aligns
      // with user vibe. Use the sample marker embedded in the prompt.
      if (prompt.includes('user_vibe: approve')) return '{"overall": 0.95}';
      if (prompt.includes('user_vibe: reject')) return '{"overall": 0.15}';
      return '{"overall": 0.5}';
    });

    const outcome = await tuner.tune();
    expect(outcome.accepted).toBe(true);
    expect(outcome.newVersion).toBeGreaterThan(1);
    expect(outcome.proposedCorrelation).not.toBeNull();
    expect(outcome.proposedCorrelation!).toBeGreaterThan((outcome.baselineCorrelation ?? -1));

    // A new rubric row should be in the store.
    const latest = store.getCurrentRubric('general');
    expect(latest?.version).toBe(outcome.newVersion);
    expect(latest?.parentVer).toBe(1);
    expect(latest?.prompt).toContain('intent');
  });

  it('rejects a proposal that makes correlation worse', async () => {
    seedDisagreementCorpus(store);
    const tuner = new ApmeTuner(store);
    tuner._setConfig(cfg());

    tuner._setJudgeFn(async (prompt) => {
      if (prompt.includes('rubric meta-optimizer')) {
        return JSON.stringify({
          prompt: 'Random worse rubric text that is obviously long enough to pass validation.',
          weights: { intent: 0.1, correctness: 0.1, style: 0.4, convention: 0.4 },
        });
      }
      // Shadow pass — stay incorrect (same disagreement pattern).
      if (prompt.includes('user_vibe: approve')) return '{"overall": 0.2}';
      if (prompt.includes('user_vibe: reject')) return '{"overall": 0.9}';
      return '{"overall": 0.5}';
    });

    const outcome = await tuner.tune();
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toMatch(/did not improve/);

    const latest = store.getCurrentRubric('general');
    expect(latest?.version).toBe(1); // unchanged
  });

  it('rejects when the judge returns unparseable text', async () => {
    seedDisagreementCorpus(store);
    const tuner = new ApmeTuner(store);
    tuner._setConfig(cfg());
    tuner._setJudgeFn(async () => 'just some prose, no JSON here at all');

    const outcome = await tuner.tune();
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('proposal unparseable');
  });

  it('refuses to run when there are fewer than 3 disagreement samples', async () => {
    // Only seed clear-pass runs — nothing to learn from.
    const collector = new ApmeCollector(store);
    seedRun(store, collector, { id: 'p1', task: 'ok', testsPass: 1, judgeOverall: 0.9, vibe: 'approve' });

    const tuner = new ApmeTuner(store);
    tuner._setConfig(cfg());
    tuner._setJudgeFn(async () => { throw new Error('should not be called'); });

    const outcome = await tuner.tune();
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toMatch(/insufficient samples/);
  });

  it('refuses when autoTune is disabled', async () => {
    const tuner = new ApmeTuner(store);
    tuner._setConfig({ ...DEFAULT_APME_CONFIG, autoTune: false });
    const outcome = await tuner.tune();
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('autoTune disabled');
  });
});
