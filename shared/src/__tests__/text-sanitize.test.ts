import { describe, it, expect } from 'vitest';
import { stripUnsafeText, escSvgText } from '../svg-renderers/text-utils.js';
import { renderTrmnlDashboard } from '../trmnl-layout.js';

describe('stripUnsafeText', () => {
  it('strips ANSI CSI sequences but keeps the visible text', () => {
    expect(stripUnsafeText('Fix \x1b[31mred\x1b[0m bug')).toBe('Fix red bug');
  });

  it('strips OSC sequences and bare ESC forms', () => {
    expect(stripUnsafeText('a\x1b]0;title\x07b')).toBe('ab');
    expect(stripUnsafeText('a\x1bMb')).toBe('ab');
  });

  it('strips XML-invalid control characters but keeps tab/newline', () => {
    expect(stripUnsafeText('a\x00\x08\x0b\x0c\x1f\x7fb')).toBe('ab');
    expect(stripUnsafeText('a\tb\nc')).toBe('a\tb\nc');
  });

  it('strips lone surrogate halves but keeps full emoji', () => {
    expect(stripUnsafeText('cut \ud83d end')).toBe('cut  end');
    expect(stripUnsafeText('ok 🚀 한국어')).toBe('ok 🚀 한국어');
  });
});

describe('escSvgText', () => {
  it('entity-escapes after stripping', () => {
    expect(escSvgText('a < b && "q" \x1b[1m')).toBe('a &lt; b &amp;&amp; &quot;q&quot; ');
  });
});

describe('renderTrmnlDashboard — hostile session text stays XML-safe', () => {
  it('emits no raw control characters even when the goal carries ANSI escapes', () => {
    // Regression: a raw ESC in a PTY-derived goal made resvg reject the whole
    // SVG downstream, which blanked the physical e-ink panel.
    const svg = renderTrmnlDashboard({
      state: 'PROCESSING',
      allSessions: [
        {
          id: 's1',
          agentType: 'claude-code',
          state: 'processing',
          projectName: 'proj\x1b[31m',
          modelName: 'claude-opus-4-8',
          goal: 'Fix \x1b[31mred\x1b[0m bug\x00\x08',
          alive: true,
        },
      ],
    });
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(svg)).toBe(false);
    expect(svg).toContain('red');
  });
});
