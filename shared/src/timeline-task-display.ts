/**
 * timeline-task-display.ts — the SINGLE source of truth for how task
 * hierarchy rows (`task_start` / `task_end`) are RENDERED.
 *
 * Contract (2026-07-19, "one row per task"):
 *   - `task_end` is a DATA-ONLY closure record. It stays on the wire and in
 *     every store — it stops the in-flight spinner (`isInFlightTask`), is the
 *     judge-result upsert vehicle (merge by type='task_end' + taskId), and is
 *     what the orphan reaper synthesizes — but renderers NEVER show it as a
 *     standalone row. Before this contract the visible timeline was dominated
 *     by reaper-synthesized "Interrupted · ~Xh" rows (no judge ever runs for
 *     those), while the judged closures were suppressed as internal
 *     boundaries: the noise showed and the signal hid.
 *   - A task renders as at most ONE row: its `task_start` header, which FOLDS
 *     IN the matching closure's fields — closure label (`task_end.raw`, e.g.
 *     "Session end · 2 turns · 6m 5s"), judge summary as the title when the
 *     header's own title is a bare "Task N", and the score/outcome badge.
 *   - Header visibility: meaningful title OR eval payload (own or closure).
 *     `_empty` category always hides. Bare unjudged tasks — including every
 *     interrupted reaper closure — render nothing; the timeline stays an
 *     activity log of actual turns.
 *
 * Mirrors (update in the same commit):
 *   - Apple  `timelineShouldShowTaskMarker` / `timelineTaskClosure` /
 *     `timelineTaskHeaderDisplay` (apple/.../UI/Monitor/TimelineStripView.swift)
 *   - Android `shouldShowTaskMarker` / `taskClosure` / `taskHeaderDisplay`
 *     (android/.../state/TimelineDisplay.kt)
 *   - ESP32 boards exclude task rows from milestone/ticker selection
 *     (esp32/src/ui/eink/eink_display.cpp, esp32/src/ui/widgets/hud_bar.cpp)
 *     — no closure fold there; glance surfaces show turn rows only.
 */

import type { TimelineEntry } from './timeline.js';

/** Fields a task header needs from its row or its closure. */
type TaskRowLike = Pick<
  TimelineEntry,
  'type' | 'taskId' | 'raw' | 'ts' | 'endedAt' |
  'taskScore' | 'taskOutcome' | 'taskCategory' | 'taskSummary' | 'boundarySignal'
>;

const TASK_NUMBER_TITLES = [/^task\s+\d+$/i, /^작업\s*\d+$/];

/** False for empty titles and the auto-minted "Task N" / "작업 N" labels —
 *  those carry no information a reader can act on. */
export function timelineIsMeaningfulTaskTitle(raw: string | undefined | null): boolean {
  const title = (raw ?? '').trim();
  if (!title) return false;
  return !TASK_NUMBER_TITLES.some((rx) => rx.test(title));
}

/** The matching `task_end` closure record for a `task_start` header, if it
 *  has arrived among `siblings`. Undefined for non-headers and open tasks. */
export function timelineTaskClosure<T extends Pick<TimelineEntry, 'type' | 'taskId'>>(
  entry: Pick<TimelineEntry, 'type' | 'taskId'>,
  siblings: ReadonlyArray<T>,
): T | undefined {
  if (entry.type !== 'task_start' || !entry.taskId) return undefined;
  return siblings.find((s) => s.type === 'task_end' && s.taskId === entry.taskId);
}

function hasEvalPayload(e: TaskRowLike | undefined): boolean {
  if (!e) return false;
  return e.taskScore != null ||
    !!e.taskOutcome?.trim() ||
    (!!e.taskCategory?.trim() && e.taskCategory !== '_empty') ||
    !!e.taskSummary?.trim();
}

/**
 * Canonical render predicate for task hierarchy rows. Non-task rows pass
 * through (`true`); callers keep their own rules for those.
 */
export function timelineShouldRenderTaskRow(
  entry: TaskRowLike,
  siblings: ReadonlyArray<TaskRowLike>,
): boolean {
  if (entry.type === 'task_end') return false;
  if (entry.type !== 'task_start') return true;
  if (entry.taskCategory === '_empty') return false;
  const closure = timelineTaskClosure(entry, siblings);
  if (closure?.taskCategory === '_empty') return false;
  if (timelineIsMeaningfulTaskTitle(entry.raw)) return true;
  return hasEvalPayload(entry) || hasEvalPayload(closure);
}

export interface TaskHeaderDisplay {
  /** Header title: the row's own title when meaningful, else the judge's
   *  one-line summary from the closure, else the raw title as-is. */
  title: string;
  /** Closure label to render as a trailing chip ("Session end · 2 turns ·
   *  6m 5s"). Undefined while the task is open. */
  closureText?: string;
  /** True once the matching `task_end` exists (spinner should be static). */
  closed: boolean;
  /** Badge inputs — closure fields win over the header's own (the judge
   *  upserts onto the closure record). */
  taskScore?: number;
  taskOutcome?: string;
  /** Epoch ms the task closed at, for pending→unscored badge timing. */
  closedAtMs?: number;
}

/** Decompose a `task_start` header + its closure into the displayed pieces.
 *  Callers must have already passed `timelineShouldRenderTaskRow`. */
export function timelineTaskHeaderDisplay(
  entry: TaskRowLike,
  siblings: ReadonlyArray<TaskRowLike>,
): TaskHeaderDisplay {
  const closure = timelineTaskClosure(entry, siblings);
  const ownTitle = (entry.raw ?? '').trim();
  const summary = (closure?.taskSummary ?? entry.taskSummary ?? '').trim();
  const title = timelineIsMeaningfulTaskTitle(ownTitle) ? ownTitle : (summary || ownTitle);
  const closureText = closure?.raw?.trim() || undefined;
  const score = closure?.taskScore ?? entry.taskScore;
  const outcome = (closure?.taskOutcome ?? entry.taskOutcome)?.trim() || undefined;
  const closedAtMs = closure ? (closure.endedAt ?? closure.ts) : undefined;
  return {
    title,
    ...(closureText ? { closureText } : {}),
    closed: !!closure,
    ...(score != null ? { taskScore: score } : {}),
    ...(outcome ? { taskOutcome: outcome } : {}),
    ...(closedAtMs != null ? { closedAtMs } : {}),
  };
}
