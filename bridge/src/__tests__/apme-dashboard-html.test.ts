// The APME dashboard is a self-contained HTML+JS SPA string. These tests lock
// the data-quality affordances that are easy to regress: honest empty/degenerate
// states and the manual-review surface.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apmeDashboardHtml } from '../apme/dashboard-html.js';

const HTML = apmeDashboardHtml();

describe('apmeDashboardHtml — data-quality affordances', () => {
  it('explains an un-scored completed run instead of showing a bare header', () => {
    expect(HTML).toContain('Not evaluated');
    // Points at the fix (judge setup) rather than dead-ending.
    expect(HTML).toContain('apme.judge');
    // Makes clear the run still has non-score data.
    expect(HTML).toMatch(/trajectory, cost, and outcome/);
  });

  it('surfaces manual reviews as a distinct, layer-filtered section', () => {
    expect(HTML).toContain('Manual Reviews');
    expect(HTML).toContain("e.layer==='manual_review'");
  });

  it('each aggregate tab has a graceful empty state (no NaN / blank grid)', () => {
    expect(HTML).toContain('No scorecard data yet');
    expect(HTML).toContain('No category data yet');
    expect(HTML).toMatch(/Not enough evaluated tasks yet/);
  });

  it('active sessions are flagged as pending, not silently score-less', () => {
    expect(HTML).toContain('Session active');
  });

  it('opens on the simple deduplicated activity view', () => {
    expect(HTML).toContain("showTab('activity')");
    expect(HTML).toContain('/apme/activity');
    expect(HTML).toContain('Swift + CLI merged');
  });
});

describe('bundled Swift-daemon dashboard copy', () => {
  // The Swift daemon serves apple/AgentDeck/Resources/apme-dashboard.html at
  // GET /apme (ApmeHttpRoutes.dashboardHtml). Before this gate it was a
  // hand-copied snapshot that silently fell a whole feature behind (31 KB vs
  // 66 KB — App Store users never saw the Work board). The renderer stays the
  // SSOT; the bundle is a generated mirror.
  it('matches apmeDashboardHtml() byte-for-byte (pnpm generate-apme-dashboard)', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const bundled = readFileSync(
      `${repoRoot}apple/AgentDeck/Resources/apme-dashboard.html`, 'utf-8');
    // Hash compare so a drift failure prints one line, not a 66 KB diff.
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(
      `${bundled.length} bytes sha256:${sha(bundled)}`,
    ).toBe(`${HTML.length} bytes sha256:${sha(HTML)}`);
  });
});
