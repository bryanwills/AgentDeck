import { describe, it, expect } from 'vitest';
import {
  renderReviewHtml, renderJudgeGuidanceHtml, judgeTierNote,
  type ReviewFinding,
} from '../review-runner.js';

const FINDINGS: ReviewFinding[] = [
  { severity: 'high', title: 'rm -rf on user path', detail: 'destructive', file: 'x.sh' },
  { severity: 'low', title: 'TODO left', detail: 'incomplete' },
];

describe('renderReviewHtml', () => {
  it('is self-contained (no external asset URLs) and shows risk + findings', () => {
    const html = renderReviewHtml({
      projectName: 'proj', sessionLabel: 'sid',
      outcome: { risk: 'high', summary: 'risky change', findings: FINDINGS, backend: 'mlx:qwen3-30b' },
      deltaStat: ' x.sh | 3 +++', generatedAt: new Date(0),
      tierNote: judgeTierNote('mlx'),
    });
    expect(html).not.toMatch(/https?:\/\//); // fully offline
    expect(html).toContain('RISK HIGH');
    expect(html).toContain('rm -rf on user path');
    expect(html).toContain('mlx:qwen3-30b');
    expect(html).toContain('judge tier'); // tier note in footer
  });

  it('escapes HTML in judge-provided text (no injection)', () => {
    const html = renderReviewHtml({
      projectName: 'p', sessionLabel: 's',
      outcome: { risk: 'low', summary: '<script>alert(1)</script>', findings: [], backend: 'b' },
      deltaStat: '', generatedAt: new Date(0),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('empty findings renders a calm "nothing worth flagging" note, not an empty grid', () => {
    const html = renderReviewHtml({
      projectName: 'p', sessionLabel: 's',
      outcome: { risk: 'low', summary: 'clean', findings: [], backend: 'foundation-models' },
      deltaStat: '', generatedAt: new Date(0),
    });
    expect(html).toContain('No risky findings');
  });
});

describe('judgeTierNote — honest capability labelling', () => {
  it('flags on-device models as basic screening', () => {
    expect(judgeTierNote('foundationModels')).toMatch(/basic screening/i);
  });
  it('flags local MLX depth as model-size dependent', () => {
    expect(judgeTierNote('mlx')).toMatch(/8B|model size/i);
  });
  it('does not append a caveat for frontier backends', () => {
    expect(judgeTierNote('api')).toBeUndefined();
    expect(judgeTierNote('openclaw')).toBeUndefined();
  });
});

describe('renderJudgeGuidanceHtml — no-judge setup flow', () => {
  it('ranks API first, then OpenClaw, MLX, Apple Intelligence, and states the local model minimum', () => {
    const html = renderJudgeGuidanceHtml({ backend: 'foundationModels', reason: 'not ready' });
    const apiIdx = html.indexOf('Anthropic API');
    const openclawIdx = html.indexOf('OpenClaw');
    const mlxIdx = html.indexOf('Local MLX');
    const appleIdx = html.indexOf('Apple Intelligence');
    expect(apiIdx).toBeGreaterThan(0);
    expect(apiIdx).toBeLessThan(openclawIdx);
    expect(openclawIdx).toBeLessThan(mlxIdx);
    expect(mlxIdx).toBeLessThan(appleIdx);
    expect(html).toMatch(/8B/); // realistic local minimum
    expect(html).toMatch(/ANTHROPIC_API_KEY|ant auth login/);
  });

  it('reassures that not using REVIEW is a supported choice (no background nagging)', () => {
    const html = renderJudgeGuidanceHtml({ backend: 'mlx' });
    expect(html).toMatch(/Not planning to use REVIEW/i);
    expect(html).toMatch(/nothing runs in the background/i);
  });

  it('surfaces the current backend + reason so the user knows what failed', () => {
    const html = renderJudgeGuidanceHtml({ backend: 'mlx', model: 'tinyllama', reason: 'connection refused' });
    expect(html).toContain('mlx');
    expect(html).toContain('tinyllama');
    expect(html).toContain('connection refused');
  });
});
