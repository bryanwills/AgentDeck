/**
 * Hook-driven awaiting overlay for observed (non-PTY) sessions.
 *
 * When the user runs `claude` directly (not `agentdeck claude`), there is no
 * PTY for the OutputParser to read, so permission prompts ("Do you want to
 * proceed?") never reach the state machine. Instead Claude Code fires a
 * `Notification` hook, which the daemon receives with a `session_id` and a
 * free-text `message`. We stash that here, keyed by the Claude session UUID,
 * and the daemon's session enricher overlays it onto the matching observed
 * session so devices flip to the awaiting (attention) tier and show the
 * question text.
 *
 * This intentionally lives OUTSIDE the passive observer (which recomputes
 * idle/processing from the transcript every 5s and would clobber an inline
 * flag) and outside the single aggregate state machine (whose hardcoded
 * `daemon-hook` id can't attribute awaiting to a specific session). Mirrors
 * the `pushStateCache` TTL-map pattern in session-aggregator.ts.
 */

interface AwaitingEntry {
  question: string;
  /** Set when the awaiting state is an actionable, device-approvable PreToolUse
   *  gate (vs. a display-only Notification prompt). Devices render Allow/Deny
   *  and reply with permission_decision keyed by this id. */
  requestId?: string;
  updatedAt: number;
}

/** A permission prompt is a genuine wait that can sit unanswered for hours (the
 *  user stepped away) — so the overlay must NOT self-clear on a short clock, or
 *  the observed session's PERMIT state vanishes from the dashboard while it is
 *  still legitimately pending. Clear-on-next-hook is the primary signal (fires
 *  the instant the user answers), and a dead `claude` process is reaped by the
 *  passive observer / liveness — so this TTL is only a last-resort backstop for
 *  a truly orphaned entry and is deliberately generous. */
const OVERLAY_TTL_MS = 6 * 60 * 60_000; // 6 hours

/** Cap question length at the source so every sessions_list broadcast stays small. */
const MAX_QUESTION_LEN = 120;

const overlay = new Map<string, AwaitingEntry>();

export function setAwaitingOverlay(sessionId: string, question: string, requestId?: string): void {
  const trimmed = (question || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_LEN);
  overlay.set(sessionId, { question: trimmed, requestId, updatedAt: Date.now() });
}

/** Returns the overlay entry if it exists and is still fresh (< TTL). Stale
 *  entries are pruned on read. */
export function getAwaitingOverlay(sessionId: string): { question: string; requestId?: string } | undefined {
  const entry = overlay.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > OVERLAY_TTL_MS) {
    overlay.delete(sessionId);
    return undefined;
  }
  return { question: entry.question, requestId: entry.requestId };
}

/** Called on any subsequent hook for a session (tool_start/tool_end/
 *  user_prompt_submit/stop/session_end) — ANY later event means the prompt
 *  was answered, so the awaiting overlay should drop. Order-independent.
 *  Returns true if an entry was actually removed, so callers can skip a
 *  needless broadcast on the common (no-overlay) path. */
export function clearAwaitingOverlay(sessionId: string): boolean {
  return overlay.delete(sessionId);
}

/** Test/diagnostic helper. */
export function _resetAwaitingOverlay(): void {
  overlay.clear();
}

/**
 * Overlay any fresh awaiting state onto a list of observed (`observed:claude:…`
 * / `observed:codex:…`) sessions, keyed by the embedded Claude session UUID.
 * Returns a new array; unaffected sessions are passed through unchanged.
 * Pure (reads the module overlay map but mutates nothing), so the daemon
 * enricher can call it on every broadcast and tests can assert it directly.
 */
export function applyAwaitingOverlayToObserved<
  T extends { id: string; state?: string; question?: string; requestId?: string },
>(sessions: T[]): T[] {
  return sessions.map((s) => {
    const uuid = s.id.replace(/^observed:(?:claude|codex):/, '');
    const ov = getAwaitingOverlay(uuid);
    if (ov) return { ...s, state: 'awaiting_permission', question: ov.question, requestId: ov.requestId };
    return s;
  });
}

/**
 * FALLBACK heuristic (see `isPermissionNotification` for the primary path):
 * does a Notification `message` look like an actual permission prompt rather
 * than an idle-timeout reminder? Claude's Notification hook fires for BOTH
 * "Claude needs your permission to use Bash" (a real decision) and "Claude is
 * waiting for your input" (a 60s idle ping). Only the former is an awaiting
 * state — the latter must NOT flip a session to attention, or every idle
 * session falsely shows a permission popup with no answerable choice.
 *
 * So this matches genuine permission phrasing ONLY. Earlier alternatives like
 * `waiting for your` / `wants to` / `confirm` / `to proceed` were too broad and
 * caught the idle ping (and arbitrary status text), which was the root cause of
 * false "Attention" popups. Biased toward precision: a missed permission
 * Notification just means no attention badge (the user still sees the prompt in
 * their terminal), whereas a false positive nags with a dead popup.
 *
 * Used only when Claude omits the structured `notification_type` (older
 * versions); current Claude is classified by `isPermissionNotification`.
 */
export function looksLikePermissionMessage(message: string): boolean {
  if (!message) return false;
  return /needs? your permission|permission to use|requesting permission/i.test(message);
}

/**
 * Is a Notification hook an actual permission prompt (awaiting decision)?
 *
 * Current Claude Code carries an authoritative `notification_type`
 * (`permission_prompt` | `idle_prompt` | `auth_success` | `elicitation_*`).
 * Prefer it — only `permission_prompt` is an awaiting state; everything else
 * (idle pings, auth toasts, elicitation) must never flip a session to
 * attention. Fall back to the brittle free-text `message` regex only when the
 * field is absent (older Claude). Mirrors the Swift
 * `DaemonServer.isPermissionNotification`.
 */
export function isPermissionNotification(
  notificationType: string | undefined,
  message: string,
): boolean {
  if (typeof notificationType === 'string' && notificationType.length > 0) {
    return notificationType === 'permission_prompt';
  }
  return looksLikePermissionMessage(message);
}

/** Edit-family tools that Claude auto-approves in `acceptEdits` mode. */
const EDIT_FAMILY_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Should the daemon HOLD a gated PreToolUse for device approval, given the
 * session's `permission_mode`?
 *
 * Claude's PreToolUse hook fires for EVERY tool call regardless of mode or
 * allowlist — even when Claude will auto-approve and never prompt the user.
 * `permission_mode` is the session's global decision posture, so gate only in
 * modes where Claude could still surface its own prompt; otherwise the device
 * nags for a decision the agent never asked for (the reported false-attention
 * bug). Mirrors the Swift `DaemonServer.shouldGate(permissionMode:tool:)`.
 *
 *  - `bypassPermissions` / `dontAsk` → never prompts            → don't gate
 *  - `plan`                          → tools don't execute       → don't gate
 *  - `acceptEdits`                   → edits auto-approved, Bash still prompts
 *  - `default` / `auto` / unknown    → Claude may prompt         → gate
 *
 * Unknown/absent mode is treated as `default` (gate) to preserve behavior on
 * older Claude versions that don't send the field.
 */
export function shouldGatePreToolUse(permissionMode: string | undefined, tool: string): boolean {
  switch ((permissionMode || 'default').trim()) {
    case 'bypassPermissions':
    case 'dontAsk':
    case 'plan':
      return false;
    case 'acceptEdits':
      return !EDIT_FAMILY_TOOLS.has(tool);
    default:
      return true;
  }
}
