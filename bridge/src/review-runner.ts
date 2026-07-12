/**
 * On-demand independent review (the REVIEW deck button).
 *
 * NOT a prompt to the agent: the daemon collects the session's latest work
 * product (working-tree delta of its cwd) and has an INDEPENDENT judge model
 * assess risk — the same local-first judge stack APME uses (MLX / Foundation
 * Models relay / opt-in API). Because no agent control is involved, every
 * session type qualifies: managed, observed Claude/OpenCode, and even
 * control-less observed Codex.
 *
 * Output fan-out:
 *   - `review_status` / `review_result` WS events (dashboards, future UIs)
 *   - SessionInfo badge fields via `reviewSnapshot` (REVIEW tile verdict)
 *   - a self-contained HTML report written under <dataDir>/reviews/ and
 *     opened in the default browser — the "no macOS app" tier's popup.
 */

import { execFile } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { callJudgeWithMeta } from './apme/runner.js';
import { loadApmeConfig } from './apme/settings.js';
import { debug, logError } from './logger.js';

export interface ReviewFinding {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  file?: string;
}

export interface ReviewOutcome {
  risk: 'low' | 'medium' | 'high';
  summary: string;
  findings: ReviewFinding[];
  backend: string;
  reportPath?: string;
}

interface ReviewState {
  status: 'running' | 'done' | 'error';
  risk?: 'low' | 'medium' | 'high';
  findings?: number;
  ts: number;
}

const DIFF_BYTE_CAP = 60_000;
const GIT_TIMEOUT_MS = 10_000;
/** Verdicts older than this stop badging the REVIEW tile. */
const BADGE_TTL_MS = 30 * 60_000;

const stateBySession = new Map<string, ReviewState>();

/** Badge fields for the sessions_list enricher. */
export function reviewSnapshot(sessionId: string): {
  reviewStatus?: 'running' | 'done' | 'error';
  reviewRisk?: 'low' | 'medium' | 'high';
  reviewFindings?: number;
} {
  const s = stateBySession.get(sessionId);
  if (!s) return {};
  if (Date.now() - s.ts > BADGE_TTL_MS) {
    stateBySession.delete(sessionId);
    return {};
  }
  return {
    reviewStatus: s.status,
    ...(s.risk ? { reviewRisk: s.risk } : {}),
    ...(s.findings != null ? { reviewFindings: s.findings } : {}),
  };
}

export function isReviewRunning(sessionId: string): boolean {
  return stateBySession.get(sessionId)?.status === 'running';
}

function git(cwd: string, args: string[]): Promise<string> {
  // External-process await: hard timeout is the first line of defense
  // (a wedged git must never wedge a review).
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], {
      timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

interface DeltaBundle {
  diff: string;
  stat: string;
  untracked: string[];
  truncated: boolean;
}

async function collectDelta(cwd: string): Promise<DeltaBundle | null> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return null; // not a git repo — trajectory-less Node review has no input
  }
  const [stat, status] = await Promise.all([
    git(cwd, ['diff', 'HEAD', '--stat']).catch(() => ''),
    git(cwd, ['status', '--porcelain']).catch(() => ''),
  ]);
  let diff = await git(cwd, ['diff', 'HEAD']).catch(() => '');
  const untracked = status.split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  let truncated = false;
  if (diff.length > DIFF_BYTE_CAP) {
    diff = diff.slice(0, DIFF_BYTE_CAP);
    truncated = true;
  }
  return { diff, stat, untracked, truncated };
}

function buildJudgePrompt(projectName: string, delta: DeltaBundle): string {
  return [
    'You are an independent code reviewer assessing RISK in a coding agent\'s',
    'uncommitted changes. Judge only the delta below — not overall project',
    'quality. Focus on: destructive or irreversible operations, security',
    'issues (secrets, injection, permissions), broken or untested code paths,',
    'incomplete work (TODO/FIXME/stubs), and changes that contradict their',
    'apparent intent.',
    '',
    `Project: ${projectName}`,
    delta.truncated ? '(diff truncated to the first 60KB)' : '',
    '',
    '--- git diff --stat ---',
    delta.stat || '(empty)',
    delta.untracked.length ? `Untracked files: ${delta.untracked.slice(0, 20).join(', ')}` : '',
    '--- git diff ---',
    delta.diff || '(no tracked changes)',
    '',
    'Respond with STRICT JSON only, no prose, exactly this shape:',
    '{"risk":"low|medium|high","summary":"<one sentence>","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"optional/path"}]}',
    'Return an empty findings array when nothing is genuinely risky. Do not',
    'invent findings to fill space.',
  ].filter(Boolean).join('\n');
}

function parseJudgeJson(text: string): { risk: 'low' | 'medium' | 'high'; summary: string; findings: ReviewFinding[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const risk = parsed.risk === 'high' || parsed.risk === 'medium' ? parsed.risk : 'low';
    const summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : '';
    const findings: ReviewFinding[] = Array.isArray(parsed.findings)
      ? parsed.findings.slice(0, 20).flatMap((f) => {
        if (!f || typeof f !== 'object') return [];
        const o = f as Record<string, unknown>;
        return [{
          severity: o.severity === 'high' || o.severity === 'medium' ? o.severity : 'low',
          title: typeof o.title === 'string' ? o.title.slice(0, 160) : 'Finding',
          detail: typeof o.detail === 'string' ? o.detail.slice(0, 1000) : '',
          ...(typeof o.file === 'string' ? { file: o.file.slice(0, 200) } : {}),
        } as ReviewFinding];
      })
      : [];
    return { risk, summary, findings };
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Self-contained aquarium-tide report — no external assets (works offline,
 *  same file doubles as the App Store tier's browser fallback template). */
export function renderReviewHtml(opts: {
  projectName: string;
  sessionLabel: string;
  outcome: { risk: string; summary: string; findings: ReviewFinding[]; backend: string };
  deltaStat: string;
  generatedAt: Date;
}): string {
  const { outcome } = opts;
  const riskColor = outcome.risk === 'high' ? '#c2410c' : outcome.risk === 'medium' ? '#b45309' : '#15803d';
  const rows = outcome.findings.map((f) => `
    <div class="finding sev-${f.severity}">
      <div class="head"><span class="sev">${f.severity.toUpperCase()}</span> <strong>${esc(f.title)}</strong>${f.file ? `<code>${esc(f.file)}</code>` : ''}</div>
      <p>${esc(f.detail)}</p>
    </div>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AgentDeck Review — ${esc(opts.projectName)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "IBM Plex Sans", -apple-system, sans-serif; background: #f6f3ec; color: #1c2a25; margin: 0; padding: 32px; }
  .card { max-width: 760px; margin: 0 auto; background: #fffdf8; border: 1px solid #e2dcc9; border-radius: 12px; padding: 28px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #5b6f66; font-size: 13px; margin-bottom: 20px; }
  .risk { display: inline-block; padding: 4px 12px; border-radius: 999px; color: #fffdf8; background: ${riskColor}; font-weight: 600; font-size: 13px; letter-spacing: 0.04em; }
  .summary { font-size: 15px; margin: 16px 0 24px; }
  .finding { border-left: 3px solid #e2dcc9; padding: 8px 14px; margin: 12px 0; }
  .finding.sev-high { border-color: #c2410c; }
  .finding.sev-medium { border-color: #b45309; }
  .finding .sev { font-size: 11px; font-weight: 700; color: #5b6f66; margin-right: 6px; }
  .finding code { margin-left: 8px; font-family: "JetBrains Mono", monospace; font-size: 12px; color: #3b5249; }
  .finding p { margin: 6px 0 0; font-size: 14px; }
  pre { background: #efe9da; border-radius: 8px; padding: 12px; overflow-x: auto; font-family: "JetBrains Mono", monospace; font-size: 12px; }
  .empty { color: #5b6f66; font-style: italic; }
  footer { margin-top: 24px; color: #8a9a91; font-size: 12px; }
</style></head><body><div class="card">
  <h1>Independent Review — ${esc(opts.projectName)}</h1>
  <div class="meta">${esc(opts.sessionLabel)} · ${opts.generatedAt.toISOString()}</div>
  <span class="risk">RISK ${esc(outcome.risk.toUpperCase())}</span>
  <p class="summary">${esc(outcome.summary || 'No summary provided by the judge.')}</p>
  ${outcome.findings.length ? rows : '<p class="empty">No risky findings — the judge saw nothing worth flagging in this delta.</p>'}
  <h2 style="font-size:15px">Changed files</h2>
  <pre>${esc(opts.deltaStat || '(no tracked changes)')}</pre>
  <footer>judge: ${esc(outcome.backend)} · generated by AgentDeck (independent of the coding agent)</footer>
</div></body></html>`;
}

function reviewsDir(): string {
  return join(process.env.AGENTDECK_DATA_DIR ?? join(homedir(), '.agentdeck'), 'reviews');
}

function openInBrowser(path: string): void {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  execFile(opener, args, { timeout: 5_000 }, () => { /* best effort */ });
}

/**
 * Run one review. `onEvent` receives the WS broadcast payloads; badge state is
 * kept here (poll via reviewSnapshot). Rejects double-runs per session.
 */
export async function runSessionReview(opts: {
  sessionId: string;
  cwd: string | undefined;
  projectName: string;
  onEvent: (event: Record<string, unknown>) => void;
}): Promise<void> {
  const { sessionId, cwd, projectName } = opts;
  if (isReviewRunning(sessionId)) return;
  stateBySession.set(sessionId, { status: 'running', ts: Date.now() });
  opts.onEvent({ type: 'review_status', sessionId, status: 'running' });

  const fail = (message: string): void => {
    stateBySession.set(sessionId, { status: 'error', ts: Date.now() });
    opts.onEvent({ type: 'review_status', sessionId, status: 'error', message });
    debug('review', `review failed for ${sessionId}: ${message}`);
  };

  try {
    if (!cwd) return fail('session working directory unknown');
    const delta = await collectDelta(cwd);
    if (!delta) return fail(`not a git repository: ${cwd}`);
    if (!delta.diff.trim() && delta.untracked.length === 0) {
      return fail('working tree is clean — nothing to review');
    }

    const judgeCfg = loadApmeConfig().judge;
    const prompt = buildJudgePrompt(projectName, delta);
    const result = await callJudgeWithMeta(prompt, judgeCfg);
    const parsed = parseJudgeJson(result.text);
    if (!parsed) return fail(`judge returned unparseable output (${result.effectiveLabel})`);

    const outcome: ReviewOutcome = { ...parsed, backend: result.effectiveLabel };

    // HTML report + browser open — the CLI tier's "popup".
    let reportPath: string | undefined;
    try {
      const dir = reviewsDir();
      mkdirSync(dir, { recursive: true });
      reportPath = join(dir, `review-${Date.now()}-${projectName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.html`);
      writeFileSync(reportPath, renderReviewHtml({
        projectName,
        sessionLabel: sessionId,
        outcome,
        deltaStat: delta.stat,
        generatedAt: new Date(),
      }));
      openInBrowser(reportPath);
    } catch (err) {
      logError(`[review] report write failed: ${String(err)}`);
    }

    stateBySession.set(sessionId, {
      status: 'done', risk: outcome.risk, findings: outcome.findings.length, ts: Date.now(),
    });
    opts.onEvent({
      type: 'review_result',
      sessionId,
      risk: outcome.risk,
      findings: outcome.findings.length,
      summary: outcome.summary,
      ...(reportPath ? { reportPath } : {}),
    });
    debug('review', `review done for ${sessionId}: risk=${outcome.risk} findings=${outcome.findings.length} backend=${outcome.backend}`);
  } catch (err) {
    fail(String(err));
  }
}

/** Test helper. */
export function _resetReviewState(): void {
  stateBySession.clear();
}
