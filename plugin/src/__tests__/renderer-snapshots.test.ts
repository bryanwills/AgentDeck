/**
 * Snapshot tests for all plugin SVG renderers.
 * Each renderer is a pure function (data → SVG string) — ideal for snapshot regression detection.
 * Run `pnpm test -- --update` to regenerate snapshots after intentional visual changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock label-summarizer before imports (same pattern as text-utils-and-labels.test.ts)
vi.mock('../label-summarizer.js', () => ({
  getCachedLabel: vi.fn(() => null),
  requestAbbreviation: vi.fn(),
}));

import { State, type PromptOption, type SessionInfo } from '@agentdeck/shared';

// ===== voice-renderer =====
import {
  renderVoiceReady,
  renderVoiceRecording,
  renderVoiceTranscribing,
  renderVoiceError,
  renderVoiceDisabled,
  renderVoiceAssistantListening,
  renderVoiceAssistantProcessing,
  renderVoiceAssistantSpeaking,
  renderWideVoiceText,
} from '../renderers/voice-renderer.js';

// ===== utility-renderer =====
import {
  renderSetupUtility,
  renderUtilityGeneric,
  renderUtilityMedia,
  type UtilityRenderData,
} from '../renderers/utility-renderer.js';

// ===== usage-dial-renderer =====
import {
  renderUsageOverview,
  renderUsageDetail,
  renderUsageSession,
  renderUsageExtra,
  renderUsageDisconnected,
} from '../renderers/usage-dial-renderer.js';

// ===== water-tank-gauge =====
import { renderWaterTankGauge, renderUsageEncoderDual } from '../renderers/water-tank-gauge.js';

// ===== response-renderer =====
import {
  renderResponseIdle,
  renderResponseProcessing,
  renderResponseDisconnected,
  renderResponseDisabled,
  renderResponseSuggestion,
  renderResponseInteractive,
  renderSetupPrompt,
} from '../renderers/response-renderer.js';

// ===== option-renderer =====
import {
  renderContextPanel,
  renderFocusPanel,
  renderListPanel,
  renderDetailPanel,
  renderWideOptionList,
} from '../renderers/option-renderer.js';

// ===== button-renderer =====
import {
  renderButton,
  svgToDataUrl,
  labelNeedsHaiku,
} from '../renderers/button-renderer.js';

// ===== session-slot-renderer =====
import {
  renderDisconnectedSlot,
  renderSessionSlot,
  renderStatusCard,
} from '../renderers/session-slot-renderer.js';

// ===== display-tile (non-interactive readouts) =====
import {
  renderStatusReadout,
  renderSessionReadout,
} from '../renderers/display-tile.js';

// ===== timeline-renderer =====
import { renderTimeline } from '../renderers/timeline-renderer.js';

// ===== qr-renderer =====
import {
  extractUrlLabel,
  qrPathData,
  renderQrButtonSvg,
} from '../renderers/qr-renderer.js';

// ===== agent-logos =====
import {
  agentLogoWatermark,
  CLAUDE_LOGO_PATH,
} from '../renderers/agent-logos.js';

// ===== Test data factories =====

function makeOption(overrides: Partial<PromptOption> = {}): PromptOption {
  return { index: 0, label: 'Allow', ...overrides };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    port: 9121,
    projectName: 'AgentDeck',
    agentType: 'claude-code',
    alive: true,
    state: State.IDLE,
    modelName: 'opus-4',
    effortLevel: 'high',
    ...overrides,
  };
}

function stableFrameIds(svg: string): string {
  return svg.replace(/frame-bg-\d+/g, 'frame-bg-test');
}

function makeGroupedEntry(overrides: Partial<{
  ts: number; type: string; raw: string; detail?: string; status?: string;
  count: number; firstTs: number; lastTs: number;
}> = {}) {
  const ts = overrides.ts ?? 1700000000000;
  return {
    entry: {
      ts,
      type: (overrides.type ?? 'tool_request') as any,
      raw: overrides.raw ?? 'Read file.ts',
      detail: overrides.detail,
      status: overrides.status as any,
    },
    count: overrides.count ?? 1,
    firstTs: overrides.firstTs ?? ts,
    lastTs: overrides.lastTs ?? ts,
  };
}

// ===== Determinism =====

let dateNowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000060000); // 60s after epoch reference
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

// ===================================================================
// Voice Renderer
// ===================================================================

describe('voice-renderer snapshots', () => {
  it('renderVoiceReady', () => {
    expect(renderVoiceReady()).toMatchSnapshot();
  });

  it('renderVoiceRecording frame 0', () => {
    expect(renderVoiceRecording(5000, 0)).toMatchSnapshot();
  });

  it('renderVoiceRecording frame 30 (>1min)', () => {
    expect(renderVoiceRecording(65000, 30)).toMatchSnapshot();
  });

  it('renderVoiceTranscribing frame 0', () => {
    expect(renderVoiceTranscribing(0)).toMatchSnapshot();
  });

  it('renderVoiceTranscribing frame 10 (different dot phase)', () => {
    expect(renderVoiceTranscribing(10)).toMatchSnapshot();
  });

  it('renderVoiceError with message', () => {
    expect(renderVoiceError('Microphone not found')).toMatchSnapshot();
  });

  it('renderVoiceError default', () => {
    expect(renderVoiceError()).toMatchSnapshot();
  });

  it('renderVoiceDisabled', () => {
    expect(renderVoiceDisabled()).toMatchSnapshot();
  });

  it('renderVoiceAssistantListening frame 0', () => {
    expect(renderVoiceAssistantListening(0)).toMatchSnapshot();
  });

  it('renderVoiceAssistantProcessing frame 5', () => {
    expect(renderVoiceAssistantProcessing(5, 'What is the weather?')).toMatchSnapshot();
  });

  it('renderVoiceAssistantSpeaking frame 0', () => {
    expect(renderVoiceAssistantSpeaking(0)).toMatchSnapshot();
  });

  it('renderWideVoiceText returns correct panel count', () => {
    const result = renderWideVoiceText('Hello world test text that spans across multiple panels', 4, 0);
    expect(result.panels).toHaveLength(4);
    expect(result.panels[0]).toMatchSnapshot();
  });
});

// ===================================================================
// Utility Renderer
// ===================================================================

describe('utility-renderer snapshots', () => {
  it('renderSetupUtility', () => {
    expect(renderSetupUtility()).toMatchSnapshot();
  });

  it('renderUtilityGeneric with icon', () => {
    const data: UtilityRenderData = {
      title: 'VOLUME',
      icon: '🔊',
      value: '72%',
      indicator: { value: 72, bar_fill_c: '#22c55e' },
      dots: '●○○○○',
    };
    expect(renderUtilityGeneric(data)).toMatchSnapshot();
  });

  it('renderUtilityGeneric text-only (no icon)', () => {
    const data: UtilityRenderData = {
      title: 'MIC',
      value: 'Muted',
      indicator: { value: 0, bar_fill_c: '#ef4444' },
      dots: '○●○○○',
    };
    expect(renderUtilityGeneric(data)).toMatchSnapshot();
  });

  it('renderUtilityMedia', () => {
    const data: UtilityRenderData = {
      title: 'MEDIA',
      icon: '▶',
      track: 'Bohemian Rhapsody',
      artist: 'Queen',
      indicator: { value: 50, bar_fill_c: '#a855f7' },
      dots: '○○●○○',
    };
    expect(renderUtilityMedia(data)).toMatchSnapshot();
  });
});

// ===================================================================
// Usage Dial Renderer
// ===================================================================

describe('usage-dial-renderer snapshots', () => {
  // Use fixed far-future dates so reset time formatting is deterministic
  const sampleData = {
    fiveHourPercent: 45,
    fiveHourResetsAt: '2099-01-01T00:00:00Z',
    sevenDayPercent: 32,
    sevenDayResetsAt: '2099-01-02T00:00:00Z',
    inputTokens: 12500,
    outputTokens: 8300,
    estimatedCostUsd: 0.42,
    sessionDurationSec: 3720,
    extraUsageEnabled: true,
    extraUsageUtilization: 15,
  };

  it('renderUsageOverview', () => {
    expect(renderUsageOverview(sampleData)).toMatchSnapshot();
  });

  it('renderUsageDetail 5h', () => {
    expect(renderUsageDetail(sampleData, '5h')).toMatchSnapshot();
  });

  it('renderUsageDetail 7d', () => {
    expect(renderUsageDetail(sampleData, '7d')).toMatchSnapshot();
  });

  it('renderUsageSession', () => {
    expect(renderUsageSession(sampleData)).toMatchSnapshot();
  });

  it('renderUsageExtra enabled', () => {
    expect(renderUsageExtra(sampleData)).toMatchSnapshot();
  });

  it('renderUsageExtra disabled', () => {
    expect(renderUsageExtra({ extraUsageEnabled: false })).toMatchSnapshot();
  });

  it('renderUsageDisconnected', () => {
    expect(renderUsageDisconnected()).toMatchSnapshot();
  });
});

// ===================================================================
// Water-Tank Gauge (keypad usage tiles)
// ===================================================================

describe('water-tank-gauge snapshots', () => {
  // Date.now is mocked to 1700000060000 in beforeEach → deterministic countdowns.
  // These resolve to "2h13m" (5h window) and "6d" (7d window).
  const reset5h = '2023-11-15T00:27:20Z';
  const reset7d = '2023-11-20T22:14:20Z';

  it('renderWaterTankGauge Claude 5h (healthy)', () => {
    const svg = renderWaterTankGauge({ agent: 'claude', window: '5h', label: '5H', usedPercent: 30, resetsAt: reset5h });
    // Claude water hue + label present.
    expect(svg).toContain('#C07058');
    expect(svg).toContain('>5H<');
    // Headline = remaining quota (100 − 30 = 70%).
    expect(svg).toContain('>70%<');
    expect(svg).toMatchSnapshot();
  });

  it('renderWaterTankGauge Claude 7d', () => {
    expect(renderWaterTankGauge({ agent: 'claude', window: '7d', label: '7D', usedPercent: 12, resetsAt: reset7d })).toMatchSnapshot();
  });

  it('renderWaterTankGauge Codex 5h uses the blue brand hue', () => {
    const svg = renderWaterTankGauge({ agent: 'codex', window: '5h', label: 'CX 5H', usedPercent: 55, resetsAt: reset5h });
    expect(svg).toContain('#6166E0');
    expect(svg).toContain('CX 5H');
    expect(svg).toMatchSnapshot();
  });

  it('renderWaterTankGauge Codex 7d', () => {
    expect(renderWaterTankGauge({ agent: 'codex', window: '7d', label: 'CX 7D', usedPercent: 88, resetsAt: reset7d })).toMatchSnapshot();
  });

  it('renderWaterTankGauge critical (low remaining → warning rim + red headline)', () => {
    const svg = renderWaterTankGauge({ agent: 'claude', window: '5h', label: '5H', usedPercent: 92, resetsAt: reset5h });
    expect(svg).toContain('#ef4444'); // critical color on rim/headline
    expect(svg).toContain('>8%<');
    expect(svg).toMatchSnapshot();
  });

  it('renderWaterTankGauge unknown draws an empty tank + dash', () => {
    const svg = renderWaterTankGauge({ agent: 'codex', window: '5h', label: 'CX 5H', usedPercent: 0, known: false });
    expect(svg).toContain('>—<');
    expect(svg).toMatchSnapshot();
  });
});

// ===================================================================
// Usage Encoder (SD+ 200×100 dual-tank LCD — Phase 2)
// ===================================================================

describe('usage-encoder dual-tank (SD+ 200x100) snapshots', () => {
  const reset5h = '2023-11-15T00:27:20Z';
  const reset7d = '2023-11-20T22:14:20Z';

  it('Claude encoder shows both windows with the terracotta brand hue', () => {
    const svg = renderUsageEncoderDual({
      agent: 'claude',
      title: 'CLAUDE',
      fiveHour: { label: '5H', usedPercent: 30, resetsAt: reset5h, known: true },
      sevenDay: { label: '7D', usedPercent: 12, resetsAt: reset7d, known: true },
    });
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain('#C07058');     // Claude brand water
    expect(svg).toContain('>CLAUDE<');
    expect(svg).toContain('>5H<');
    expect(svg).toContain('>7D<');
    expect(svg).toContain('>70%<');        // 5h remaining = 100−30
    expect(svg).toContain('>88%<');        // 7d remaining = 100−12
    expect(svg).toMatchSnapshot();
  });

  it('Codex encoder uses the blue brand hue', () => {
    const svg = renderUsageEncoderDual({
      agent: 'codex',
      title: 'CODEX',
      fiveHour: { label: '5H', usedPercent: 55, resetsAt: reset5h, known: true },
      sevenDay: { label: '7D', usedPercent: 88, resetsAt: reset7d, known: true },
    });
    expect(svg).toContain('#6166E0');     // Codex brand water
    expect(svg).toContain('>CODEX<');
    expect(svg).toContain('>45%<');        // 5h remaining
    expect(svg).toContain('>12%<');        // 7d remaining
    expect(svg).toMatchSnapshot();
  });

  it('Codex encoder renders a muted note when no rate limits are present', () => {
    const svg = renderUsageEncoderDual({
      agent: 'codex',
      title: 'CODEX',
      fiveHour: { label: '5H', usedPercent: 0, known: false },
      sevenDay: { label: '7D', usedPercent: 0, known: false },
      note: 'No Codex usage',
    });
    expect(svg).toContain('No Codex usage');
    expect(svg).not.toContain('%');        // tanks suppressed in note mode
    expect(svg).toMatchSnapshot();
  });

  it('Waiting note before the first usage payload', () => {
    const svg = renderUsageEncoderDual({
      agent: 'claude',
      title: 'CLAUDE',
      fiveHour: { label: '5H', usedPercent: 0, known: false },
      sevenDay: { label: '7D', usedPercent: 0, known: false },
      note: 'Waiting…',
    });
    expect(svg).toContain('Waiting…');
    expect(svg).toMatchSnapshot();
  });

  it('a single unknown window draws a dash tank, the other a real tank', () => {
    const svg = renderUsageEncoderDual({
      agent: 'codex',
      title: 'CODEX',
      fiveHour: { label: '5H', usedPercent: 40, resetsAt: reset5h, known: true },
      sevenDay: { label: '7D', usedPercent: 0, known: false },
    });
    expect(svg).toContain('>60%<');        // 5h known
    expect(svg).toContain('>—<');          // 7d unknown
    expect(svg).toMatchSnapshot();
  });
});

// ===================================================================
// Response Renderer
// ===================================================================

describe('response-renderer snapshots', () => {
  it('renderResponseIdle', () => {
    expect(renderResponseIdle('Run tests', 0, 5)).toMatchSnapshot();
  });

  it('renderResponseProcessing', () => {
    expect(renderResponseProcessing()).toMatchSnapshot();
  });

  it('renderResponseDisconnected', () => {
    expect(renderResponseDisconnected()).toMatchSnapshot();
  });

  it('renderResponseDisabled', () => {
    expect(renderResponseDisabled()).toMatchSnapshot();
  });

  it('renderResponseSuggestion', () => {
    expect(renderResponseSuggestion('Review the test results for potential errors', 1, 3)).toMatchSnapshot();
  });

  it('renderResponseInteractive', () => {
    expect(renderResponseInteractive('Allow Write', 0, 2, 'PERMISSION', '#fca5a5', '#ef4444')).toMatchSnapshot();
  });

  it('renderSetupPrompt', () => {
    expect(renderSetupPrompt()).toMatchSnapshot();
  });
});

// ===================================================================
// Option Renderer
// ===================================================================

describe('option-renderer snapshots', () => {
  it('renderContextPanel permission', () => {
    expect(renderContextPanel({
      state: State.AWAITING_PERMISSION,
      selectedIndex: 0,
      total: 3,
      currentTool: 'Write',
      question: 'Allow file write?',
    })).toMatchSnapshot();
  });

  it('renderContextPanel diff', () => {
    expect(renderContextPanel({
      state: State.AWAITING_DIFF,
      selectedIndex: 0,
      total: 2,
    })).toMatchSnapshot();
  });

  it('renderFocusPanel with recommended option', () => {
    expect(renderFocusPanel({
      opt: makeOption({ label: 'Yes, allow this', recommended: true }),
      selectedIndex: 0,
      total: 3,
      isPermOrDiff: true,
      state: State.AWAITING_PERMISSION,
      fourEnc: true,
    })).toMatchSnapshot();
  });

  it('renderListPanel 3 options', () => {
    expect(renderListPanel({
      options: [
        makeOption({ label: 'Allow', shortcut: 'y' }),
        makeOption({ label: 'Deny', shortcut: 'n' }),
        makeOption({ label: 'Allow always' }),
      ],
      selectedIndex: 1,
      isPermOrDiff: true,
      state: State.AWAITING_PERMISSION,
    })).toMatchSnapshot();
  });

  it('renderListPanel 6 options (scroll indicator)', () => {
    const options = Array.from({ length: 6 }, (_, i) =>
      makeOption({ label: `Option ${i + 1}`, index: i }),
    );
    expect(renderListPanel({
      options,
      selectedIndex: 3,
      isPermOrDiff: false,
      state: State.AWAITING_OPTION,
    })).toMatchSnapshot();
  });

  it('renderDetailPanel', () => {
    expect(renderDetailPanel({
      opt: makeOption({ label: 'Allow' }),
      isPermOrDiff: true,
      state: State.AWAITING_PERMISSION,
      selectedIndex: 0,
      total: 3,
      toolInput: '/Users/dev/project/src/main.ts',
      question: 'Allow file write?',
    })).toMatchSnapshot();
  });

  it('renderWideOptionList returns correct panel count', () => {
    const options = Array.from({ length: 5 }, (_, i) =>
      makeOption({ label: `Choice ${i + 1}`, index: i }),
    );
    const result = renderWideOptionList(options, 2, false, State.AWAITING_OPTION, 3, 0);
    expect(result.panels).toHaveLength(3);
    expect(result.panels[0]).toMatchSnapshot();
  });
});

// ===================================================================
// Button Renderer
// ===================================================================

describe('button-renderer snapshots', () => {
  it('basic text button', () => {
    expect(renderButton({
      title: 'GO ON',
      color: '#1e3a5f',
      textColor: '#93c5fd',
      enabled: true,
    })).toMatchSnapshot();
  });

  it('button with subtitle', () => {
    expect(renderButton({
      title: 'Session',
      subtitle: 'claude-code',
      color: '#1e293b',
      textColor: '#e2e8f0',
      enabled: true,
    })).toMatchSnapshot();
  });

  it('disabled button', () => {
    expect(renderButton({
      title: 'Stop',
      color: '#1e293b',
      textColor: '#ef4444',
      enabled: false,
    })).toMatchSnapshot();
  });

  it('loading button', () => {
    expect(renderButton({
      title: 'Installing',
      color: '#1e293b',
      textColor: '#818cf8',
      enabled: true,
      loading: true,
    })).toMatchSnapshot();
  });

  it('long text that needs abbreviation', () => {
    expect(renderButton({
      title: "Yes, allow and don't ask again",
      color: '#14532d',
      textColor: '#86efac',
      enabled: true,
    })).toMatchSnapshot();
  });

  it('svgToDataUrl returns data URI', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>';
    const url = svgToDataUrl(svg);
    expect(url).toMatch(/^data:image\/svg\+xml,/);
    expect(url).toContain('svg');
  });

  it('labelNeedsHaiku detects long labels', () => {
    expect(labelNeedsHaiku('OK')).toBe(false);
    expect(labelNeedsHaiku('Yes, allow and don\'t ask again for: /very/long/path/to/file.ts')).toBe(true);
  });
});

// ===================================================================
// Session Slot Renderer
// ===================================================================

describe('session-slot-renderer snapshots', () => {
  it('disconnected hero is icon-rich', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'open-app' }))).toMatchSnapshot();
  });

  it('disconnected non-center slot is empty', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'empty' }))).toMatchSnapshot();
  });

  it('disconnected cluster quadrant tl', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'open-app', quadrant: 'tl' }))).toMatchSnapshot();
  });

  it('disconnected cluster quadrant tr', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'open-app', quadrant: 'tr' }))).toMatchSnapshot();
  });

  it('disconnected cluster quadrant bl', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'open-app', quadrant: 'bl' }))).toMatchSnapshot();
  });

  it('disconnected cluster quadrant br', () => {
    expect(stableFrameIds(renderDisconnectedSlot({ kind: 'open-app', quadrant: 'br' }))).toMatchSnapshot();
  });

  it('connected no-session card is icon-rich', () => {
    expect(stableFrameIds(renderStatusCard({ icon: 'no-session', label: 'NO SESSION', subtitle: 'WAITING', tone: 'idle' }))).toMatchSnapshot();
  });

  it('active idle session uses orbiting focus border', () => {
    expect(renderSessionSlot(makeSession(), true, 4)).toMatchSnapshot();
  });

  it('stale session dims the render and shows a STALE badge', () => {
    const fresh = renderSessionSlot(makeSession(), false, 4);
    const stale = renderSessionSlot(makeSession(), false, 4, undefined, { isStale: true });
    expect(fresh).not.toContain('STALE');
    expect(stale).toContain('STALE');
    expect(stale).toMatchSnapshot();
  });
});

// ===================================================================
// Display Tiles (non-interactive readouts)
// ===================================================================

describe('display-tile snapshots', () => {
  it('renderStatusReadout MODEL is flat (no raised bezel, no glyph)', () => {
    const svg = renderStatusReadout({ label: 'MODEL', subtitle: 'sonnet 4.6', tone: 'info' });
    // Flat readout: no raised inner key bezel rect, carries the left accent bar.
    expect(svg).not.toContain('128');           // no 128×128 raised bezel rect
    expect(svg).toContain('width="4"');          // left accent strip
    expect(svg).toContain('MODEL');
    expect(svg).toContain('sonnet 4.6');
    expect(svg).toMatchSnapshot();
  });

  it('renderStatusReadout READY (label only)', () => {
    expect(renderStatusReadout({ label: 'READY', subtitle: 'idle', tone: 'ready' })).toMatchSnapshot();
  });

  it('renderStatusReadout AWAITING', () => {
    expect(renderStatusReadout({ label: 'AWAITING', subtitle: 'choose option', tone: 'warning' })).toMatchSnapshot();
  });

  it('renderStatusReadout HUB READY (no-session hub state)', () => {
    expect(renderStatusReadout({ label: 'HUB READY', subtitle: 'CONNECTED', tone: 'ready' })).toMatchSnapshot();
  });

  it('renderSessionReadout keeps name/model/state, flat & non-interactive', () => {
    const svg = renderSessionReadout(makeSession(), State.IDLE, 'opus-4', undefined, 'AgentDeck', 'high');
    expect(svg).not.toContain('128');           // no raised bezel
    expect(svg).not.toContain('INFO');           // no button-style INFO badge
    expect(svg).toContain('AgentDeck');
    expect(svg).toContain('IDLE');
    expect(svg).toMatchSnapshot();
  });

  it('renderSessionReadout openclaw hides model, shows STANDBY', () => {
    const svg = renderSessionReadout(
      makeSession({ agentType: 'openclaw', state: State.IDLE, projectName: 'Gateway' }),
      State.IDLE,
      'opus-4',
      undefined,
      'Gateway',
    );
    expect(svg).toContain('STANDBY');
    expect(svg).toMatchSnapshot();
  });
});

// ===================================================================
// Timeline Renderer
// ===================================================================

describe('timeline-renderer snapshots', () => {
  it('empty timeline', () => {
    const result = renderTimeline([], 0, false);
    expect(result.panels).toHaveLength(2);
    expect(result.panels[0]).toMatchSnapshot();
  });

  it('single entry', () => {
    const groups = [makeGroupedEntry({ type: 'chat_start', raw: 'Hello world' })];
    const result = renderTimeline(groups, 0, false);
    expect(result.panels[0]).toMatchSnapshot();
  });

  it('multiple entries fisheye', () => {
    const groups = [
      makeGroupedEntry({ ts: 1700000000000, type: 'chat_start', raw: 'Start coding' }),
      makeGroupedEntry({ ts: 1700000010000, type: 'tool_request', raw: 'Read main.ts' }),
      makeGroupedEntry({ ts: 1700000020000, type: 'tool_request', raw: 'Write test.ts', count: 3 }),
      makeGroupedEntry({ ts: 1700000030000, type: 'chat_end', raw: 'Done' }),
      makeGroupedEntry({ ts: 1700000040000, type: 'error', raw: 'Connection timeout' }),
    ];
    const result = renderTimeline(groups, 2, false);
    expect(result.panels[0]).toMatchSnapshot();
  });

  it('detail mode', () => {
    const groups = [
      makeGroupedEntry({ ts: 1700000000000, type: 'tool_request', raw: 'Read file.ts', detail: '/src/file.ts' }),
      makeGroupedEntry({ ts: 1700000010000, type: 'chat_end', raw: 'Analysis complete' }),
    ];
    const result = renderTimeline(groups, 0, true);
    expect(result.panels[0]).toMatchSnapshot();
  });

  it('with session status', () => {
    const groups = [makeGroupedEntry({ type: 'chat_start', raw: 'Working' })];
    const result = renderTimeline(groups, 0, true, { state: 'processing', model: 'opus-4' });
    expect(result.panels[0]).toMatchSnapshot();
  });
});

// ===================================================================
// QR Renderer
// ===================================================================

describe('qr-renderer snapshots', () => {
  it('extractUrlLabel extracts host:port', () => {
    expect(extractUrlLabel('http://192.168.1.42:9120')).toBe('192.168.1.42:9120');
    expect(extractUrlLabel('https://example.com')).toBe('example.com');
    expect(extractUrlLabel('not-a-url')).toBe('not-a-url');
  });

  it('qrPathData deterministic', () => {
    const result = qrPathData('https://example.com', 4, 10, 10);
    expect(result.modules).toBeGreaterThan(0);
    expect(result.d).toMatchSnapshot();
  });

  it('renderQrButtonSvg', () => {
    expect(renderQrButtonSvg('https://example.com', '192.168.1.42:9120', 3, 1, '#818cf8')).toMatchSnapshot();
  });
});

// ===================================================================
// Agent Logos
// ===================================================================

describe('agent-logos snapshots', () => {
  it('claude-code watermark', () => {
    expect(agentLogoWatermark('claude-code', '#ffffff', 0.08)).toMatchSnapshot();
  });

  it('openclaw watermark', () => {
    expect(agentLogoWatermark('openclaw', '#ffffff', 0.08)).toMatchSnapshot();
  });

  it('CLAUDE_LOGO_PATH is defined', () => {
    expect(CLAUDE_LOGO_PATH).toBeDefined();
    expect(CLAUDE_LOGO_PATH.length).toBeGreaterThan(100);
  });
});
