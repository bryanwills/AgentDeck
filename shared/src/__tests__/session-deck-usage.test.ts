import { describe, it, expect } from 'vitest';
import { buildSessionDeck } from '../d200h-layout.js';

// Locks the list-view USAGE behaviour of the shared session deck (D200H /
// Ulanzi): with `showUsage`, the 2×2 block directly ABOVE the wide bottom-right
// button (cols 3–4, rows 0–1) is pinned to the quota gauges — Claude 5H/7D on
// the top row (3_0/4_0), Codex 5H/7D on the row below (3_1/4_1). Sessions/paging
// reflow into the remaining keys, and the tiles refresh usage on press.

const POS = ['0_0', '1_0', '2_0', '3_0', '4_0', '0_1', '1_1', '2_1', '3_1', '4_1', '0_2', '1_2', '2_2', '3_2', '4_2'];

// Usage placement: the block above the wide button.
const C5H = '3_0';   // Claude 5H (top-left of block)
const C7D = '4_0';   // Claude 7D (top-right of block)
const CX5H = '3_1';  // Codex 5H (below Claude 5H)
const CX7D = '4_1';  // Codex 7D
// With only Claude reserved (3_0/4_0), the last free slot is the wide-button cell
// 4_2, where the overflow NEXT→ button lands.
const NEXT_POS = '4_2';

const mkSessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, alive: true, port: 9121 + i, projectName: `p${i}`,
    agentType: 'claude-code', state: 'idle',
  }));

const baseState = (sessions: number, over: Record<string, unknown> = {}) => ({
  state: 'IDLE',
  allSessions: mkSessions(sessions),
  fiveHourPercent: 42,
  sevenDayPercent: 17,
  usageKnown: true,
  ...over,
});

describe('buildSessionDeck list-view usage tiles', () => {
  it('pins 5H/7D to the block above the wide button and wires them to query_usage', () => {
    const deck = buildSessionDeck(baseState(3), { mode: 'list', showUsage: true }, POS);
    const c5 = deck.get(C5H)!;
    const c7 = deck.get(C7D)!;
    expect(c5.svg).toContain('5H');
    // Full-bleed gauge headline is the USED percent (fill rises with usage).
    expect(c5.svg).toContain('>42<'); // 42% used
    expect(c7.svg).toContain('7D');
    expect(c7.svg).toContain('>17<'); // 17% used
    expect(c5.action).toEqual({ kind: 'command', command: { type: 'query_usage' } });
    expect(c7.action).toEqual({ kind: 'command', command: { type: 'query_usage' } });
  });

  it('does not reserve usage slots when showUsage is off (regression: full grid)', () => {
    const deck = buildSessionDeck(baseState(3), { mode: 'list' }, POS);
    expect(deck.get(C7D)!.svg).not.toContain('7D');
    // No query_usage command anywhere.
    const cmds = [...deck.values()].map((c) => c.action).filter((a) => a?.kind === 'command');
    expect(cmds).toHaveLength(0);
  });

  it('draws "—" when usage is unknown', () => {
    const deck = buildSessionDeck(baseState(1, { usageKnown: false, fiveHourPercent: 0, sevenDayPercent: 0 }),
      { mode: 'list', showUsage: true }, POS);
    expect(deck.get(C5H)!.svg).toContain('—');
    expect(deck.get(C7D)!.svg).toContain('—');
  });

  it('fits sessions into the 13 non-usage keys without paging', () => {
    const deck = buildSessionDeck(baseState(13), { mode: 'list', showUsage: true }, POS);
    const opens = [...deck.values()].filter((c) => c.action?.kind === 'open');
    expect(opens).toHaveLength(13);
    // No NEXT page button — everything fits.
    const pages = [...deck.values()].filter((c) => c.action?.kind === 'page');
    expect(pages).toHaveLength(0);
    // Usage still pinned above the wide button.
    expect(deck.get(C5H)!.svg).toContain('5H');
    expect(deck.get(C7D)!.svg).toContain('7D');
  });

  it('paginates when sessions exceed capacity, NEXT→ sits on the last free key', () => {
    // 15 sessions, 15 keys, 2 reserved for usage → cap 13; overflow → 12/page + NEXT.
    const deck = buildSessionDeck(baseState(15), { mode: 'list', showUsage: true }, POS);
    const next = deck.get(NEXT_POS)!;
    expect(next.action).toEqual({ kind: 'page', delta: 1 });
    expect(next.svg).toContain('1/2'); // page indicator
    // 12 sessions on page 1.
    const opens = [...deck.values()].filter((c) => c.action?.kind === 'open');
    expect(opens).toHaveLength(12);
    // Usage tiles still present on the paginated page.
    expect(deck.get(C5H)!.svg).toContain('5H');
    expect(deck.get(C7D)!.svg).toContain('7D');
  });

  it('page 2 keeps the usage tiles pinned and shows the remainder', () => {
    const deck = buildSessionDeck(baseState(15), { mode: 'list', page: 1, showUsage: true }, POS);
    const opens = [...deck.values()].filter((c) => c.action?.kind === 'open');
    expect(opens).toHaveLength(3); // 15 - 12
    expect(deck.get(C5H)!.svg).toContain('5H');
    expect(deck.get(C7D)!.svg).toContain('7D');
  });

  it('shows usage even with zero sessions', () => {
    const deck = buildSessionDeck(baseState(0), { mode: 'list', showUsage: true }, POS);
    expect(deck.get(C5H)!.svg).toContain('5H');
    expect(deck.get(C7D)!.svg).toContain('7D');
  });

  it('appends Codex 5H/7D below Claude when codexRateLimits is present (each datum)', () => {
    const codex = {
      codexRateLimits: {
        primary: { usedPercent: 30, windowMinutes: 300, resetsAt: undefined },
        secondary: { usedPercent: 10, windowMinutes: 10080, resetsAt: undefined },
        planType: 'plus',
      },
    };
    const deck = buildSessionDeck(baseState(2, codex), { mode: 'list', showUsage: true }, POS);
    // 2×2 block: Claude 5H/7D top row (3_0/4_0), Codex 5H/7D below (3_1/4_1).
    // Labels are short ("5H"/"7D") on both agents; the agent is conveyed by the
    // provider LOGO — terracotta-tinted Claude mark, blue Codex mark.
    const claude5 = deck.get(C5H)!.svg, claude7 = deck.get(C7D)!.svg;
    const codex5 = deck.get(CX5H)!.svg, codex7 = deck.get(CX7D)!.svg;
    expect(claude5).toContain('5H');
    expect(claude5).toContain('#C07058');
    expect(claude5).toContain('M4.709 15.955'); // Claude provider logo path
    // Legibility without a dark overlay: subtle toned level fill, no chip.
    expect(claude5).toContain('opacity="0.38"');
    expect(claude5).not.toContain('opacity="0.72"');
    expect(claude7).toContain('7D');
    expect(claude7).toContain('#C07058');
    expect(codex5).toContain('5H');       // Codex 5H, used 30%
    expect(codex5).toContain('>30<');
    expect(codex5).toContain('#6166E0');
    expect(codex5).toContain('M8.086.457'); // Codex provider logo path
    expect(codex5).toContain('opacity="0.38"');
    expect(codex7).toContain('7D');       // Codex 7D, used 10%
    expect(codex7).toContain('>10<');
    expect(codex7).toContain('#6166E0');
  });

  it('renders only the Codex window whose datum exists', () => {
    const onlyPrimary = {
      codexRateLimits: { primary: { usedPercent: 25, windowMinutes: 300 } },
    };
    const deck = buildSessionDeck(baseState(2, onlyPrimary), { mode: 'list', showUsage: true }, POS);
    // 3 tiles reserved (Claude 5H/7D + Codex 5H) → fill 3_0, 4_0, 3_1 in reading
    // order; the absent Codex 7D reserves no key (4_1 stays free for a session).
    expect(deck.get(CX5H)!.svg).toContain('#6166E0'); // Codex 5H lands below Claude 5H
    expect(deck.get(CX5H)!.svg).toContain('>25<');
    const block = [C5H, C7D, CX5H, CX7D].map((p) => deck.get(p)!.svg);
    const codexTiles = block.filter((s) => s.includes('#6166E0'));
    expect(codexTiles).toHaveLength(1); // only the Codex 5H window
  });

  it('shows a credits tile when Codex reports a credit-based plan (null windows)', () => {
    const credits = {
      codexRateLimits: {
        limitId: 'premium',
        credits: { hasCredits: false, unlimited: false, balance: '0' },
      },
    };
    const deck = buildSessionDeck(baseState(2, credits), { mode: 'list', showUsage: true }, POS);
    // No Codex windows → a single credits readout lands at the first free Codex
    // slot below Claude (3_1), carrying the limit label + balance + Codex logo.
    const tile = deck.get(CX5H)!.svg;
    expect(tile).toContain('PREMIUM');
    expect(tile).toContain('CREDITS');
    expect(tile).toContain('>0<');           // balance
    expect(tile).toContain('#6166E0');       // Codex brand mark
    expect(deck.get(CX5H)!.action).toEqual({ kind: 'command', command: { type: 'query_usage' } });
  });

  it('renders ∞ for an unlimited-credits Codex plan', () => {
    const credits = {
      codexRateLimits: { limitId: 'premium', credits: { hasCredits: true, unlimited: true } },
    };
    const deck = buildSessionDeck(baseState(2, credits), { mode: 'list', showUsage: true }, POS);
    expect(deck.get(CX5H)!.svg).toContain('∞');
  });

  it('falls back to trailing keys on a tiny deck where the block is not placed', () => {
    // Only 3 keys placed (none of 3_0/4_0/3_1/4_1) → preferred block empty, so
    // usage falls back to the trailing keys. Old `slots.length >= 6` gate dropped
    // ALL usage here; the adaptive reserve keeps it.
    const tiny = ['0_0', '1_0', '2_0'];
    const deck = buildSessionDeck(baseState(1), { mode: 'list', showUsage: true }, tiny);
    // 2 trailing keys = Claude 5H/7D; first key stays for the session.
    expect(deck.get('1_0')!.svg).toContain('5H');
    expect(deck.get('2_0')!.svg).toContain('7D');
    const opens = [...deck.values()].filter((c) => c.action?.kind === 'open');
    expect(opens.length).toBeGreaterThanOrEqual(1);
  });

  it('never starves the only key on a 1-key deck (usage yields to the session)', () => {
    const deck = buildSessionDeck(baseState(1), { mode: 'list', showUsage: true }, ['0_0']);
    // maxReserve = 0 → no usage tile; the single key shows the session.
    expect(deck.get('0_0')!.action?.kind).toBe('open');
  });
});
