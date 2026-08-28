/**
 * task-title.ts — the SINGLE source of truth for deriving a task's display
 * title from its first user prompt.
 *
 * Why this exists (2026-08-28): the auto-minted task header was literally
 * `Task N`, which `timelineIsMeaningfulTaskTitle` rejects — so a task had no
 * name anywhere until the judge's one-line summary arrived (and single-turn
 * tasks never got one at all). The material for a real name was already
 * collected: the task's first user prompt. This module turns that prompt into
 * an anchor title — the task's INTENT. The judge summary remains the OUTCOME
 * and, when present, still wins the one-line timeline slot (see
 * `timelineTaskHeaderDisplay`); the intent title fills the unjudged void.
 *
 * Consumers (keep in the same commit):
 *   - ApmeCollector.emitDeferredTaskStartIfNeeded → `task_start.raw`
 *     (bridge/src/apme/collector.ts, mirrored in ApmeCollector.swift
 *     `deriveTaskTitle` — parity is pinned by the shared vector file
 *     `shared/task-title-vectors.json`, which BOTH test suites replay;
 *     change rules here → regenerate expectations there → both suites)
 *   - GET /apme/tasks response `title` field (bridge/src/apme/http.ts)
 */

/** Max title length in code points. Chosen to fit one Work-board row beside
 *  its chips; long prompts are cut at a word boundary where one exists. */
export const TASK_TITLE_MAX_CHARS = 72;

/** Minimum meaningful length in code points — anything shorter ("ok", "ㅇㅇ",
 *  "go") names nothing a reader can act on, so we keep the `Task N` fallback
 *  rather than promote noise to an anchor. */
export const TASK_TITLE_MIN_CHARS = 4;

/** A slash COMMAND, not a slash PATH: `/task close`, `/compact` — one
 *  ASCII-word token after the slash, then end-of-line or whitespace. A path
 *  (`/Users/x/cli.ts crashes`) has a second `/` immediately after the first
 *  token and must NOT be swallowed; slash commands are ASCII by construction,
 *  so `[a-z]` (not a Unicode letter class) keeps `/작업 정리해줘` a title. */
const SLASH_COMMAND_LINE = /^\/[a-z][\w-]*(?:\s|$)/i;

const MARKUP_LINE = /^</; // <system-reminder>, <task-notification>, pasted XML/HTML
const CODE_FENCE_LINE = /^```/;

/**
 * Derive a display title from a task's first user prompt.
 *
 * Returns null when the prompt yields nothing meaningful — an empty prompt, a
 * bare slash command, a machine-injected markup prompt, or a fragment shorter
 * than {@link TASK_TITLE_MIN_CHARS}. Callers keep their existing fallback
 * (`Task N`) on null; they must NOT pass null through as an empty title.
 *
 * Rules, in order:
 *   1. If the first non-blank line is markup (`<...`), the whole prompt is
 *      machine plumbing (a `<task-notification>` injection, a pasted
 *      reminder) — return null rather than promote its inner body to a title.
 *   2. Otherwise take the first line that is not blank, not a bare slash
 *      command, and not a code fence.
 *   3. Strip leading markdown furniture (heading `#`, list `-`/`*`, quote `>`).
 *   4. Collapse internal whitespace runs to single spaces.
 *   5. Cap at {@link TASK_TITLE_MAX_CHARS} CODE POINTS (all index math is in
 *      code points — never UTF-16 units) with `…`, preferring the last word
 *      boundary in the back half of the window (Korean and CJK prompts often
 *      have none — then the hard cut stands).
 */
export function deriveTaskTitle(firstPrompt: string | null | undefined): string | null {
  const prompt = (firstPrompt ?? '').trim();
  if (!prompt) return null;

  let line = '';
  let sawAnyLine = false;
  let inFence = false;
  for (const rawLine of prompt.split(/\r?\n/)) {
    const candidate = rawLine.trim();
    if (!candidate) continue;
    // A fence swallows its whole BODY, not just the marker lines — a
    // paste-code-then-ask prompt must be titled by the ask, never by the
    // first line of the pasted code.
    if (CODE_FENCE_LINE.test(candidate)) { inFence = !inFence; sawAnyLine = true; continue; }
    if (inFence) { sawAnyLine = true; continue; }
    if (!sawAnyLine && MARKUP_LINE.test(candidate)) return null;
    sawAnyLine = true;
    if (SLASH_COMMAND_LINE.test(candidate)) continue;
    if (MARKUP_LINE.test(candidate)) continue;
    line = candidate;
    break;
  }
  if (!line) return null;

  line = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const points = Array.from(line);
  if (points.length < TASK_TITLE_MIN_CHARS) return null;
  if (points.length <= TASK_TITLE_MAX_CHARS) return line;

  const window = points.slice(0, TASK_TITLE_MAX_CHARS);
  // Word-boundary search in CODE POINTS (array index), so an emoji-heavy
  // prompt cannot shift the boundary the way a UTF-16 lastIndexOf would.
  const lastSpace = window.lastIndexOf(' ');
  const cutLen = lastSpace >= Math.floor(TASK_TITLE_MAX_CHARS / 2) ? lastSpace : TASK_TITLE_MAX_CHARS;
  return `${window.slice(0, cutLen).join('').trimEnd()}…`;
}
