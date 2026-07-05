import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  setAwaitingOverlay,
  getAwaitingOverlay,
  clearAwaitingOverlay,
  looksLikePermissionMessage,
  isPermissionNotification,
  shouldGatePreToolUse,
  applyAwaitingOverlayToObserved,
  _resetAwaitingOverlay,
} from '../awaiting-overlay.js';

describe('awaiting-overlay', () => {
  beforeEach(() => {
    _resetAwaitingOverlay();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('set then get returns the trimmed question', () => {
    setAwaitingOverlay('sid-1', '  Claude needs your   permission to use Bash  ');
    expect(getAwaitingOverlay('sid-1')).toEqual({ question: 'Claude needs your permission to use Bash', requestId: undefined });
  });

  it('carries an optional requestId (actionable PreToolUse gate)', () => {
    setAwaitingOverlay('sid-1b', 'Allow Bash: npm test?', 'req-123');
    expect(getAwaitingOverlay('sid-1b')).toEqual({ question: 'Allow Bash: npm test?', requestId: 'req-123' });
  });

  it('returns undefined for an unknown session', () => {
    expect(getAwaitingOverlay('nope')).toBeUndefined();
  });

  it('survives a long away-wait, then expires past the generous backstop', () => {
    setAwaitingOverlay('sid-2', 'wants to run a command');
    expect(getAwaitingOverlay('sid-2')).toBeDefined();
    // A genuine prompt the user hasn't answered in half an hour is still shown.
    vi.advanceTimersByTime(30 * 60_000);
    expect(getAwaitingOverlay('sid-2')).toBeDefined();
    // Only a truly orphaned entry clears, well past any realistic wait.
    vi.advanceTimersByTime(6 * 60 * 60_000 + 1);
    expect(getAwaitingOverlay('sid-2')).toBeUndefined();
  });

  it('re-setting refreshes the TTL (a follow-up prompt keeps the overlay alive)', () => {
    setAwaitingOverlay('sid-2b', 'first prompt');
    vi.advanceTimersByTime(4 * 60_000);
    setAwaitingOverlay('sid-2b', 'second prompt');
    // A fresh re-set keeps the entry alive; the question updates to the latest.
    vi.advanceTimersByTime(4 * 60_000);
    expect(getAwaitingOverlay('sid-2b')).toEqual({ question: 'second prompt', requestId: undefined });
  });

  it('clear removes the entry and reports whether one existed', () => {
    setAwaitingOverlay('sid-3', 'permission to use Edit');
    expect(clearAwaitingOverlay('sid-3')).toBe(true);
    expect(getAwaitingOverlay('sid-3')).toBeUndefined();
    expect(clearAwaitingOverlay('sid-3')).toBe(false);
  });

  it('caps question length at 120 chars', () => {
    setAwaitingOverlay('sid-4', 'x'.repeat(300));
    expect(getAwaitingOverlay('sid-4')!.question.length).toBe(120);
  });

  describe('looksLikePermissionMessage', () => {
    it('matches genuine permission prompts', () => {
      expect(looksLikePermissionMessage('Claude needs your permission to use Bash')).toBe(true);
      expect(looksLikePermissionMessage('Claude needs your permission to run this command')).toBe(true);
      expect(looksLikePermissionMessage('Requesting permission to use Edit')).toBe(true);
    });
    it('rejects the idle ping, non-permission status text, and empty messages', () => {
      expect(looksLikePermissionMessage('')).toBe(false);
      // The 60s idle reminder fires through the SAME Notification hook — it must
      // NOT flip a session to attention (this was the false-positive root cause).
      expect(looksLikePermissionMessage('Claude is waiting for your input')).toBe(false);
      expect(looksLikePermissionMessage('Claude has been idle for 60 seconds')).toBe(false);
      expect(looksLikePermissionMessage('Claude wants to run npm test')).toBe(false);
    });
  });

  describe('isPermissionNotification', () => {
    it('uses notification_type when present — only permission_prompt awaits', () => {
      expect(isPermissionNotification('permission_prompt', 'anything')).toBe(true);
      // Other structured types must NOT flip to attention, even if the message
      // happens to contain permission-ish words.
      expect(isPermissionNotification('idle_prompt', 'Claude needs your permission')).toBe(false);
      expect(isPermissionNotification('auth_success', 'permission to use')).toBe(false);
      expect(isPermissionNotification('elicitation_dialog', 'requesting permission')).toBe(false);
    });
    it('falls back to the message regex only when notification_type is absent', () => {
      expect(isPermissionNotification(undefined, 'Claude needs your permission to use Bash')).toBe(true);
      expect(isPermissionNotification(undefined, 'Claude is waiting for your input')).toBe(false);
      expect(isPermissionNotification('', 'requesting permission')).toBe(true);
    });
  });

  describe('shouldGatePreToolUse', () => {
    it('gates in default / auto / unknown modes (Claude may prompt)', () => {
      expect(shouldGatePreToolUse('default', 'Bash')).toBe(true);
      expect(shouldGatePreToolUse('auto', 'Edit')).toBe(true);
      expect(shouldGatePreToolUse(undefined, 'Bash')).toBe(true);
      expect(shouldGatePreToolUse('something-new', 'Write')).toBe(true);
    });
    it('never gates when Claude will not prompt or execute', () => {
      for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
        expect(shouldGatePreToolUse('bypassPermissions', tool)).toBe(false);
        expect(shouldGatePreToolUse('dontAsk', tool)).toBe(false);
        expect(shouldGatePreToolUse('plan', tool)).toBe(false);
      }
    });
    it('acceptEdits auto-approves edits but still gates Bash', () => {
      expect(shouldGatePreToolUse('acceptEdits', 'Edit')).toBe(false);
      expect(shouldGatePreToolUse('acceptEdits', 'Write')).toBe(false);
      expect(shouldGatePreToolUse('acceptEdits', 'MultiEdit')).toBe(false);
      expect(shouldGatePreToolUse('acceptEdits', 'NotebookEdit')).toBe(false);
      expect(shouldGatePreToolUse('acceptEdits', 'Bash')).toBe(true);
    });
  });

  describe('applyAwaitingOverlayToObserved', () => {
    const observed = (id: string, state: string) => ({ id, state });

    it('flips a matching observed session to awaiting_permission with the question', () => {
      setAwaitingOverlay('uuid-abc', 'Claude needs your permission to use Bash');
      const out = applyAwaitingOverlayToObserved([
        observed('observed:claude:uuid-abc', 'processing'),
        observed('observed:claude:uuid-other', 'idle'),
      ]);
      expect(out[0]).toMatchObject({
        state: 'awaiting_permission',
        question: 'Claude needs your permission to use Bash',
      });
      // Unaffected session passes through unchanged.
      expect(out[1]).toEqual({ id: 'observed:claude:uuid-other', state: 'idle' });
    });

    it('matches the uuid after stripping the observed:claude: / observed:codex: prefix', () => {
      setAwaitingOverlay('uuid-xyz', 'wants to run a command');
      const claude = applyAwaitingOverlayToObserved([observed('observed:claude:uuid-xyz', 'processing')]);
      expect(claude[0].state).toBe('awaiting_permission');
      const codex = applyAwaitingOverlayToObserved([observed('observed:codex:uuid-xyz', 'processing')]);
      expect(codex[0].state).toBe('awaiting_permission');
    });

    it('leaves sessions untouched when no overlay exists', () => {
      const input = [observed('observed:claude:fresh', 'processing')];
      expect(applyAwaitingOverlayToObserved(input)).toEqual(input);
    });

    it('propagates the requestId for actionable gates', () => {
      setAwaitingOverlay('uuid-gate', 'Allow Bash: ls?', 'req-xyz');
      const out = applyAwaitingOverlayToObserved([observed('observed:claude:uuid-gate', 'processing')]);
      expect(out[0]).toMatchObject({ state: 'awaiting_permission', question: 'Allow Bash: ls?', requestId: 'req-xyz' });
    });
  });

  // Locks the daemon-server notification-branch contract restored on
  // 2026-07-05 (display-only; the held PreToolUse gate stays removed).
  // Mirrors the /hooks/ handler sequence in daemon-server.ts.
  describe('display-only notification flow (daemon restore contract)', () => {
    const observed = (id: string, state: string) => ({ id, state });

    it('permission_prompt notification → awaiting with NO requestId; next hook clears', () => {
      const sid = 'uuid-flow';
      // 1. Notification hook arrives — gate on the authoritative type.
      expect(isPermissionNotification('permission_prompt', 'Claude needs your permission to use Bash')).toBe(true);
      setAwaitingOverlay(sid, 'Claude needs your permission to use Bash'); // no requestId — display-only
      // 2. Observed enrich renders respond-in-terminal (requestId undefined).
      const out = applyAwaitingOverlayToObserved([observed(`observed:claude:${sid}`, 'processing')]);
      expect(out[0]).toMatchObject({ state: 'awaiting_permission', requestId: undefined });
      // 3. The user answered in the terminal → the tool fires → clear.
      expect(clearAwaitingOverlay(sid)).toBe(true);
      expect(applyAwaitingOverlayToObserved([observed(`observed:claude:${sid}`, 'processing')])[0].state)
        .toBe('processing');
    });

    it('idle ping / auto-approved tool never sets the overlay (the 2026-06-27 false-attention bug)', () => {
      // Idle reminder rides the same Notification hook — must not gate.
      expect(isPermissionNotification('idle_prompt', 'Claude is waiting for your input')).toBe(false);
      // Auto-approved tools fire PreToolUse but never a permission
      // Notification — so no overlay is ever set for them; nothing to assert
      // beyond the gate above rejecting non-permission types.
      expect(isPermissionNotification(undefined, 'Running npm test')).toBe(false);
    });
  });
});
