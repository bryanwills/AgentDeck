// The APME dashboard is a self-contained HTML+JS SPA string. These tests lock
// the data-quality affordances that are easy to regress: honest empty/degenerate
// states and the manual-review surface.

import { describe, it, expect } from 'vitest';
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
});
