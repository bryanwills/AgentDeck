/**
 * APME Rubric Auto-Tuner — Phase 3.
 *
 * Closes the improvement loop between deterministic results, the LLM judge,
 * and the user's vibe check. Algorithm (OPRO-style, ACE-inspired):
 *
 *   1. Collect recent runs + their evals + vibe feedback.
 *   2. Detect disagreement samples:
 *        - tests_pass=1 but llm_judge.overall<0.5 (false negative)
 *        - tests_pass=0 but llm_judge.overall>0.8 (false positive)
 *        - user vibe rejected but judge.overall>0.7
 *        - user vibe approved but judge.overall<0.5
 *   3. Compute baseline correlation between llm_judge.overall and vibe.
 *   4. Ask the same judge backend to propose a new rubric prompt + weights,
 *      conditioned on the disagreement samples (this is OPRO's meta-optimizer
 *      step — the model learns from its own mistakes).
 *   5. Shadow-score the samples under the proposed rubric; keep it only if
 *      vibe-correlation improves. Never auto-accept a worse rubric.
 *   6. On accept, append to `rubrics` with parentVer lineage; on reject, log
 *      the attempt so a human can inspect later.
 *
 * The tuner never silently falls back to a different backend per the
 * cost-sensitive defaults contract.
 */

import { debug } from '../logger.js';
import type { ApmeStore } from './store.js';
import type { ApmeConfig, ApmeJudgeConfig } from './settings.js';
import { loadApmeConfig } from './settings.js';
import { callJudge } from './runner.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface DisagreementSample {
  runId: string;
  taskPrompt: string;
  judgeOverall: number | null;
  testsPass: number | null;
  vibe: 'approve' | 'reject' | 'neutral' | null;
  note: string;
}

export interface TuneOutcome {
  accepted: boolean;
  reason: string;
  baselineCorrelation: number | null;
  proposedCorrelation: number | null;
  newVersion: number | null;
}

// ─── Tuner ─────────────────────────────────────────────────────────────────────

export class ApmeTuner {
  private configOverride: ApmeConfig | null = null;
  private judgeOverride: ((prompt: string, cfg: ApmeJudgeConfig) => Promise<string>) | null = null;

  constructor(private readonly store: ApmeStore) {}

  _setConfig(cfg: ApmeConfig): void { this.configOverride = cfg; }
  _setJudgeFn(fn: ((prompt: string, cfg: ApmeJudgeConfig) => Promise<string>) | null): void {
    this.judgeOverride = fn;
  }

  /** Trigger a tuning pass. Returns the new rubric version if accepted. */
  async tune(): Promise<TuneOutcome> {
    if (!this.store.enabled) {
      return { accepted: false, reason: 'store disabled', baselineCorrelation: null, proposedCorrelation: null, newVersion: null };
    }
    const cfg = this.configOverride ?? loadApmeConfig();
    if (!cfg.autoTune) {
      return { accepted: false, reason: 'autoTune disabled', baselineCorrelation: null, proposedCorrelation: null, newVersion: null };
    }

    const samples = collectDisagreements(this.store, 30);
    if (samples.length < 3) {
      return { accepted: false, reason: `insufficient samples (${samples.length}/3)`, baselineCorrelation: null, proposedCorrelation: null, newVersion: null };
    }

    const rubric = this.store.getCurrentRubric('general');
    if (!rubric) {
      return { accepted: false, reason: 'no base rubric', baselineCorrelation: null, proposedCorrelation: null, newVersion: null };
    }

    const baseline = vibeCorrelation(samples);
    debug('APME', `tune baseline correlation=${baseline ?? 'n/a'} samples=${samples.length}`);

    // Ask the judge to propose a new rubric.
    const metaPrompt = buildMetaPrompt(rubric.prompt, rubric.weights, samples);
    let judgeText: string;
    try {
      judgeText = this.judgeOverride
        ? await this.judgeOverride(metaPrompt, cfg.judge)
        : await callJudge(metaPrompt, cfg.judge);
    } catch (err) {
      debug('APME', `tune judge call failed: ${String(err)}`);
      return { accepted: false, reason: `judge call failed: ${String(err)}`, baselineCorrelation: baseline, proposedCorrelation: null, newVersion: null };
    }

    const proposed = parseProposal(judgeText);
    if (!proposed) {
      return { accepted: false, reason: 'proposal unparseable', baselineCorrelation: baseline, proposedCorrelation: null, newVersion: null };
    }

    // Shadow-score: re-run the judge on each disagreement sample using the
    // proposed rubric. Correlate the new overall scores against user vibe.
    const shadowScores: Array<{ judgeOverall: number; vibe: DisagreementSample['vibe'] }> = [];
    for (const sample of samples) {
      if (!sample.vibe || sample.vibe === 'neutral') continue;
      const scorePrompt = buildShadowPrompt(proposed.prompt, sample);
      let shadowText: string;
      try {
        shadowText = this.judgeOverride
          ? await this.judgeOverride(scorePrompt, cfg.judge)
          : await callJudge(scorePrompt, cfg.judge);
      } catch (err) {
        debug('APME', `tune shadow call failed: ${String(err)}`);
        continue;
      }
      const overall = extractOverall(shadowText);
      if (overall !== null) {
        shadowScores.push({ judgeOverall: overall, vibe: sample.vibe });
      }
    }

    const proposedCorr = shadowScores.length >= 3 ? correlation(
      shadowScores.map((s) => s.judgeOverall),
      shadowScores.map((s) => vibeToNumber(s.vibe!)),
    ) : null;

    debug('APME', `tune proposed correlation=${proposedCorr ?? 'n/a'} shadow=${shadowScores.length}`);

    const improves = (baseline === null || proposedCorr !== null) &&
      (proposedCorr ?? -Infinity) > (baseline ?? -Infinity) + 0.05;
    if (!improves) {
      return {
        accepted: false,
        reason: `proposed correlation did not improve (baseline=${baseline ?? 'n/a'}, proposed=${proposedCorr ?? 'n/a'})`,
        baselineCorrelation: baseline,
        proposedCorrelation: proposedCorr,
        newVersion: null,
      };
    }

    const newVersion = this.store.appendRubric({
      purpose: rubric.purpose,
      prompt: proposed.prompt,
      weights: JSON.stringify(proposed.weights),
      createdAt: Date.now(),
      parentVer: rubric.version,
      notes: `auto-tune: baseline=${baseline ?? 'n/a'} → proposed=${proposedCorr ?? 'n/a'} over ${shadowScores.length} samples`,
    });
    debug('APME', `tune accepted v${newVersion} (parent=${rubric.version})`);
    return {
      accepted: true,
      reason: `correlation improved ${baseline ?? 'n/a'} → ${proposedCorr ?? 'n/a'}`,
      baselineCorrelation: baseline,
      proposedCorrelation: proposedCorr,
      newVersion,
    };
  }

  /** Check if the current rubric should be re-tuned. */
  async shouldRetune(): Promise<boolean> {
    if (!this.store.enabled) return false;
    const samples = collectDisagreements(this.store, 30);
    if (samples.length < 10) return false;
    const corr = vibeCorrelation(samples);
    // Low correlation with user vibe ⇒ rubric drifted.
    return corr !== null && corr < 0.4;
  }
}

// ─── Disagreement detection ───────────────────────────────────────────────────

export function collectDisagreements(store: ApmeStore, limit: number): DisagreementSample[] {
  const runs = store.listRuns({ limit: Math.max(limit * 3, 60) });
  const out: DisagreementSample[] = [];
  for (const run of runs) {
    const evals = store.listEvalsForRun(run.id);
    const tests = evals.find((e) => e.layer === 'deterministic' && e.metric === 'tests_pass');
    const judge = evals.find((e) => e.layer === 'llm_judge' && e.metric === 'overall');
    const vibeRow = store.latestVibeForRun(run.id);
    const vibeVerdict = vibeRow ? vibeRow.verdict : null;

    const judgeOverall = judge?.score ?? null;
    const testsPass = tests?.score ?? null;

    // Disagreement heuristics:
    let note = '';
    if (tests && judge && tests.score === 1 && judge.score < 0.5) note = 'tests pass but judge fails';
    else if (tests && judge && tests.score === 0 && judge.score > 0.8) note = 'tests fail but judge passes';
    else if (vibeVerdict === 'reject' && judge && judge.score > 0.7) note = 'user rejected but judge approved';
    else if (vibeVerdict === 'approve' && judge && judge.score < 0.5) note = 'user approved but judge rejected';
    else if (vibeVerdict && vibeVerdict !== 'neutral' && judge) {
      // Even without explicit disagreement, vibe-labeled runs are valuable.
      note = 'vibe labeled';
    } else {
      continue;
    }

    out.push({
      runId: run.id,
      taskPrompt: (run.taskPrompt ?? '').slice(0, 400),
      judgeOverall,
      testsPass,
      vibe: vibeVerdict,
      note,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Correlation math ─────────────────────────────────────────────────────────

export function vibeCorrelation(samples: DisagreementSample[]): number | null {
  const pairs = samples
    .filter((s) => s.vibe && s.vibe !== 'neutral' && s.judgeOverall !== null)
    .map((s) => [s.judgeOverall as number, vibeToNumber(s.vibe as 'approve' | 'reject')]);
  if (pairs.length < 3) return null;
  return correlation(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
}

export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

function vibeToNumber(v: 'approve' | 'reject' | 'neutral'): number {
  if (v === 'approve') return 1;
  if (v === 'reject') return 0;
  return 0.5;
}

// ─── Meta-prompts ─────────────────────────────────────────────────────────────

function buildMetaPrompt(currentPrompt: string, currentWeights: string, samples: DisagreementSample[]): string {
  const lines: string[] = [];
  lines.push('You are a rubric meta-optimizer. The current judge rubric disagrees with ground truth on the following samples.');
  lines.push('Propose a *revised* rubric prompt and axis weights that would resolve these disagreements while staying concise (<800 chars).');
  lines.push('');
  lines.push('--- CURRENT RUBRIC PROMPT ---');
  lines.push(currentPrompt);
  lines.push('');
  lines.push(`--- CURRENT WEIGHTS ---`);
  lines.push(currentWeights);
  lines.push('');
  lines.push('--- DISAGREEMENT SAMPLES ---');
  for (const s of samples) {
    lines.push(`- runId=${s.runId} tests_pass=${s.testsPass ?? 'n/a'} judge_overall=${s.judgeOverall ?? 'n/a'} vibe=${s.vibe ?? 'n/a'} :: ${s.note}`);
    if (s.taskPrompt) lines.push(`  task: ${s.taskPrompt}`);
  }
  lines.push('');
  lines.push('Respond with strict JSON only:');
  lines.push('{"prompt":"...","weights":{"intent":N,"correctness":N,"style":N,"convention":N},"notes":"..."}');
  return lines.join('\n');
}

function buildShadowPrompt(newRubricPrompt: string, sample: DisagreementSample): string {
  return [
    newRubricPrompt,
    '',
    '--- SAMPLE ---',
    `task: ${sample.taskPrompt || '(not captured)'}`,
    `tests_pass: ${sample.testsPass ?? 'n/a'}`,
    `prior_judge_overall: ${sample.judgeOverall ?? 'n/a'}`,
    `user_vibe: ${sample.vibe ?? 'n/a'}`,
    '',
    'Respond with strict JSON only: {"overall":N,"reasoning":"..."}',
  ].join('\n');
}

// ─── Proposal parsing ─────────────────────────────────────────────────────────

export interface RubricProposal {
  prompt: string;
  weights: Record<string, number>;
  notes?: string;
}

export function parseProposal(text: string): RubricProposal | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof obj.prompt !== 'string' || obj.prompt.length < 20) return null;
    if (!obj.weights || typeof obj.weights !== 'object') return null;
    const weights: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.weights as Record<string, unknown>)) {
      if (typeof v === 'number' && isFinite(v) && v >= 0) weights[k] = v;
    }
    if (Object.keys(weights).length === 0) return null;
    return {
      prompt: obj.prompt,
      weights,
      notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    };
  } catch {
    return null;
  }
}

export function extractOverall(text: string): number | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const v = obj.overall;
    if (typeof v !== 'number' || !isFinite(v)) return null;
    let n = v;
    if (n > 1 && n <= 10) n = n / 10;
    return Math.max(0, Math.min(1, n));
  } catch {
    return null;
  }
}
