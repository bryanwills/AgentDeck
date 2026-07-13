/**
 * Bridge-side timeline store — minimal server-side event buffer.
 * Stores recent timeline entries for relay to Android/plugin clients.
 * No scroll/grouping logic (that's client-side).
 */

import type { TimelineEntry } from './types.js';
import { deduplicateEntry, normalizeTimelineEntryForStorage } from '@agentdeck/shared';
import { readFileSync } from 'fs';

type EntryListener = (entry: TimelineEntry, upsert?: boolean) => void;
/** Attribute an entry with session-scoped metadata (sessionId, projectName,
 *  taskId, runId, ...) before it lands in the buffer. Run once at storage
 *  time so history replay carries the same attribution as the live broadcast.
 *  Must be idempotent: caller already-set fields take precedence. */
type EntryAttributor = (entry: TimelineEntry) => TimelineEntry;

const MAX_ENTRIES = 200;
/** Separate retention cap for task hierarchy rows (task_start/task_end/
 *  task_milestone). Task rows are exempt from the generic FIFO shift —
 *  a long task's `task_start` must not scroll away while its turns stream
 *  in, or the eventual `task_end` renders as an unpaired orphan. ~30 pairs. */
const MAX_TASK_ENTRIES = 60;

function isTaskRow(e: Pick<TimelineEntry, 'type'>): boolean {
  return e.type === 'task_start' || e.type === 'task_end' || e.type === 'task_milestone';
}

/** Chat/tool entry types that, in projection mode, come from the SessionSample
 *  projection instead of the adapters' direct emitters. Locally-emitted entries
 *  of these types are suppressed when projection mode is on so the timeline has
 *  exactly one source. Task hierarchy + error/scheduled rows are never affected. */
const PROJECTED_TYPES: ReadonlySet<string> = new Set([
  'chat_start', 'chat_response', 'chat_end', 'tool_request', 'tool_resolved', 'tool_exec',
]);

export class BridgeTimelineStore {
  private entries: TimelineEntry[] = [];
  private listeners: EntryListener[] = [];
  private attributor: EntryAttributor | null = null;
  /** Phase 6 cutover (default OFF). When true, locally-emitted chat/tool rows
   *  are dropped — the SessionSample projection (added via `bypassSuppression`)
   *  becomes the single source. Relayed + projected entries bypass this. */
  private suppressLocalChatTool = false;

  setSuppressLocalChatTool(v: boolean): void {
    this.suppressLocalChatTool = v;
  }

  /** Install (or replace) the attributor invoked on every addEntry / upsertEntry
   *  before dedup. Wired by `BridgeCore.wireTimeline` so the store and the
   *  live broadcast see identical, fully-attributed entries — critical for
   *  history replay (`timeline_history`). */
  setAttributor(fn: EntryAttributor | null): void {
    this.attributor = fn;
  }

  addEntry(entry: TimelineEntry, opts?: { bypassSuppression?: boolean }): void {
    // Phase 6: in projection mode, drop locally-emitted chat/tool rows — they
    // now come from the SessionSample projection (which bypasses) or are
    // relayed from another bridge (which bypasses). No-op when mode is off.
    if (this.suppressLocalChatTool && !opts?.bypassSuppression && PROJECTED_TYPES.has(entry.type)) {
      return;
    }
    const enriched = this.attributor ? this.attributor(entry) : entry;
    const normalized = normalizeTimelineEntryForStorage(enriched);
    if (!normalized) return;

    if (this.tryMergeTaskEndByTaskId(normalized)) {
      return;
    }

    const result = deduplicateEntry(normalized, this.entries);

    if (result.action === 'skip') return;

    if (result.action === 'merge') {
      // Merge path is an *update* — the existing entry was attributed at its
      // own creation time and that attribution is the truth. Do NOT pull
      // session/task/run/project from `enriched` (the attributor on this call
      // reflects the *current* active task, which may have rotated since the
      // original entry was stored). Use the raw caller `entry` so explicit
      // caller-set fields still win, and otherwise keep `existing.*`.
      const existing = this.entries[result.index];
      existing.repeatCount = (existing.repeatCount || 1) + 1;
      existing.ts = normalized.ts;
      existing.raw = normalized.raw;
      existing.detail = normalized.detail ?? existing.detail;
      existing.agentType = entry.agentType ?? existing.agentType;
      existing.projectName = entry.projectName ?? existing.projectName;
      existing.sessionId = entry.sessionId ?? existing.sessionId;
      existing.runId = entry.runId ?? existing.runId;
      existing.taskId = entry.taskId ?? existing.taskId;
      existing.startedAt = normalized.startedAt ?? existing.startedAt;
      existing.endedAt = normalized.endedAt ?? existing.endedAt;
      existing.automated = normalized.automated ?? existing.automated;
      existing.summaryKind = normalized.summaryKind ?? existing.summaryKind;
      existing.boundarySignal = normalized.boundarySignal ?? existing.boundarySignal;
      existing.taskScore = normalized.taskScore ?? existing.taskScore;
      existing.taskOutcome = normalized.taskOutcome ?? existing.taskOutcome;
      existing.taskCategory = normalized.taskCategory ?? existing.taskCategory;
      existing.taskSummary = normalized.taskSummary ?? existing.taskSummary;
      if (result.removeChatStartIndex != null) {
        this.entries.splice(result.removeChatStartIndex, 1);
      }
      for (const cb of this.listeners) cb(existing, true);
      return;
    }

    // action === 'add' — fresh entry. Push the enriched form so storage and
    // history replay carry attribution from the time of creation.
    this.entries.push(result.entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.evictOne();
    }
    for (const cb of this.listeners) cb(result.entry);
  }

  /** Evict a single entry to enforce MAX_ENTRIES, protecting task rows.
   *
   *  Task rows only leave under their own cap (MAX_TASK_ENTRIES), and an
   *  in-flight task's `task_start` (no matching `task_end` yet) is never
   *  evicted — otherwise a long task's start scrolls away mid-task and the
   *  pair splits. Everything else FIFOs as before. */
  private evictOne(): void {
    const taskRowCount = this.entries.reduce((n, e) => n + (isTaskRow(e) ? 1 : 0), 0);
    if (taskRowCount > MAX_TASK_ENTRIES) {
      const closed = new Set<string>();
      for (const e of this.entries) {
        if (e.type === 'task_end' && e.taskId) closed.add(e.taskId);
      }
      const idx = this.entries.findIndex(
        (e) => isTaskRow(e) && !(e.type === 'task_start' && e.taskId && !closed.has(e.taskId)),
      );
      if (idx >= 0) {
        this.entries.splice(idx, 1);
        return;
      }
    }
    // Shed the oldest `tool_exec` before any chat/turn row. Observed codex/
    // opencode command rows carry real sessionIds + command detail, so they
    // pass the anonymous-noise storage filter and accumulate — a live daemon
    // snapshot ran 87% tool_exec (87/100). Undifferentiated FIFO would then
    // evict a turn's `chat_start` (always the oldest ts in its turn) before its
    // own tool_exec rows, leaving an orphaned chat_response/chat_end in the
    // `timeline_history` replay a reconnecting client receives — the Node-side
    // face of the "answer with no prompt" symptom. tool_exec is standalone
    // (unlike the tool_request/tool_resolved approval pair, which must not be
    // split), so shedding it first is safe and preserves the turn skeleton.
    const toolIdx = this.entries.findIndex((e) => e.type === 'tool_exec');
    if (toolIdx >= 0) {
      this.entries.splice(toolIdx, 1);
      return;
    }
    const idx = this.entries.findIndex((e) => !isTaskRow(e));
    if (idx >= 0) {
      this.entries.splice(idx, 1);
      return;
    }
    // Pathological: buffer is 100% task rows — fall back to plain FIFO so the
    // buffer stays bounded.
    this.entries.shift();
  }

  getHistory(since?: number): TimelineEntry[] {
    const entries = since
      ? this.entries.filter((e) => e.ts > since)
      : this.entries;
    return [...entries].sort((a, b) => a.ts - b.ts);
  }

  /** Load persisted timeline rows into the bounded replay buffer without
   *  broadcasting them as live events. The Node daemon normally keeps the
   *  device timeline in memory, but macOS/previous daemon runs may leave a
   *  timeline.json behind. Rehydrating it lets reconnecting Android/tablet
   *  clients receive a non-empty initial `timeline_history`.
   */
  loadPersistedFile(path: string): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return 0;
    }
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    const before = this.entries.length;
    this.loadPersistedEntries(rows);
    return Math.max(0, this.entries.length - before);
  }

  loadPersistedEntries(rows: unknown[]): void {
    const normalized: TimelineEntry[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const entry = row as Partial<TimelineEntry>;
      if (typeof entry.ts !== 'number' || typeof entry.type !== 'string' || typeof entry.raw !== 'string') continue;
      const clean = normalizeTimelineEntryForStorage(entry as TimelineEntry);
      if (clean) normalized.push(clean);
    }
    if (normalized.length === 0) return;
    const byKey = new Map<string, TimelineEntry>();
    for (const entry of [...this.entries, ...normalized].sort((a, b) => a.ts - b.ts)) {
      byKey.set(`${entry.ts}:${entry.type}:${entry.raw}`, entry);
    }
    const merged = Array.from(byKey.values()).sort((a, b) => a.ts - b.ts);
    // Trim with the same task-row protection as live eviction: task rows keep
    // their own (deeper) retention so start/end pairs survive a reload even
    // when chat/tool rows overflowed the generic cap.
    const taskRows = merged.filter(isTaskRow).slice(-MAX_TASK_ENTRIES);
    const rest = merged.filter((e) => !isTaskRow(e)).slice(-(MAX_ENTRIES - taskRows.length));
    this.entries = [...taskRows, ...rest].sort((a, b) => a.ts - b.ts);
  }

  /** Node mirror of the Swift daemon's orphan reaper
   *  (DaemonServer.computeOrphanTaskEnds): synthesize a `task_end` for every
   *  `task_start` whose pair was never written. The producer only guarantees
   *  the pair within a single daemon lifetime (ApmeCollector.closeTask is
   *  in-memory), so a daemon killed mid-task leaves task_start rows that
   *  clients render as in-flight — spinning the task marker forever. Called
   *  once after `loadPersistedFile` at daemon startup. Idempotent: a real
   *  task_end arriving later merges over the synthetic via
   *  `tryMergeTaskEndByTaskId`. Returns the number of synthesized rows. */
  reapOrphanTaskStarts(): number {
    const closed = new Set<string>();
    for (const e of this.entries) {
      if (e.type === 'task_end' && e.taskId) closed.add(e.taskId);
    }
    let count = 0;
    for (const start of [...this.entries]) {
      if (start.type !== 'task_start' || !start.taskId || closed.has(start.taskId)) continue;
      const startedAtMs = start.startedAt ?? start.ts;
      // ts nudged 1ms past the task_start so the synthetic end sorts right
      // after the orphaned start. endedAt stays unset — the duration is
      // genuinely unknown, and clients render "Interrupted · –" for that.
      this.addEntry({
        ts: startedAtMs + 1,
        type: 'task_end',
        raw: 'Interrupted · –',
        ...(start.agentType ? { agentType: start.agentType } : {}),
        ...(start.projectName ? { projectName: start.projectName } : {}),
        ...(start.sessionId ? { sessionId: start.sessionId } : {}),
        ...(start.runId ? { runId: start.runId } : {}),
        startedAt: startedAtMs,
        taskId: start.taskId,
        boundarySignal: 'interrupted',
      }, { bypassSuppression: true });
      closed.add(start.taskId);
      count++;
    }
    return count;
  }

  /** Recent entries attributed to one session, for the `query_session_timeline`
   *  poll — lets a device that connects mid-session fill its Detail view. */
  getHistoryForSession(sessionId: string, since?: number, limit = 16): TimelineEntry[] {
    // sessions_list ids for passively-observed sessions are prefixed
    // ("observed:claude:<uuid>") while timeline entries are keyed by the raw uuid,
    // so accept either form.
    const raw = sessionId.replace(/^observed:(?:claude|codex|opencode|antigravity):/, '');
    const matched = this.entries.filter(
      (e) => (e.sessionId === sessionId || e.sessionId === raw) && (since == null || e.ts > since),
    );
    matched.sort((a, b) => a.ts - b.ts);
    // `limit` applies to the chat/tool stream; task hierarchy rows ride along
    // in full so a long task's start/end pair never splits at the per-session
    // window (a task_start older than the last `limit` rows used to vanish,
    // leaving the Detail view an unpaired task_end).
    const taskRows = matched.filter(isTaskRow);
    const rest = matched.filter((e) => !isTaskRow(e)).slice(-limit);
    return [...taskRows, ...rest].sort((a, b) => a.ts - b.ts);
  }

  updateEntryStatus(approvalId: string, status: 'approved' | 'denied'): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].approvalId === approvalId) {
        this.entries[i] = { ...this.entries[i], status };
        return;
      }
    }
  }

  /** Update existing entry with same ts+type (1s tolerance), or add new.
   *
   *  Update path: the existing entry's session/task/run/project attribution
   *  was set at *its* creation time and is authoritative. We do NOT re-run
   *  the attributor on update — by the time a late upsert lands (e.g. async
   *  LLM summary on a chat_end), the active task may have rotated, and
   *  re-attributing would silently move the entry to the wrong task. The
   *  raw caller `entry` only overrides existing fields when the caller
   *  explicitly set them.
   *
   *  Insert path (no match): falls through to `addEntry`, which runs the
   *  attributor as usual to capture creation-time attribution. */
  upsertEntry(entry: TimelineEntry, opts?: { bypassSuppression?: boolean }): void {
    // An upsert that finds no match falls through to addEntry; honor the same
    // suppression bypass on that insert path (relayed task_end upserts, etc.).
    const normalized = normalizeTimelineEntryForStorage(entry);
    if (!normalized) return;

    if (this.tryMergeTaskEndByTaskId(normalized)) {
      return;
    }

    const tolerance = 1000;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.type === normalized.type && Math.abs(e.ts - normalized.ts) < tolerance) {
        this.entries[i] = {
          ...e,
          raw: normalized.raw,
          ...(normalized.detail ? { detail: normalized.detail } : {}),
          ...(normalized.agentType ? { agentType: normalized.agentType } : {}),
          ...(normalized.projectName ? { projectName: normalized.projectName } : {}),
          ...(normalized.sessionId ? { sessionId: normalized.sessionId } : {}),
          ...(normalized.runId ? { runId: normalized.runId } : {}),
          ...(normalized.taskId ? { taskId: normalized.taskId } : {}),
          ...(normalized.boundarySignal ? { boundarySignal: normalized.boundarySignal } : {}),
          ...(normalized.startedAt != null ? { startedAt: normalized.startedAt } : {}),
          ...(normalized.endedAt != null ? { endedAt: normalized.endedAt } : {}),
          ...(normalized.automated ? { automated: normalized.automated } : {}),
          // summaryKind progresses heuristic/none → llm when the async LLM
          // summary lands. Without this propagation, the dashboard never
          // sees the kind upgrade and (for `summaryKind: 'none'` rows) the
          // detail pane stays suppressed even after the LLM rescues it.
          ...(normalized.summaryKind ? { summaryKind: normalized.summaryKind } : {}),
          ...(normalized.taskScore != null ? { taskScore: normalized.taskScore } : {}),
          ...(normalized.taskOutcome ? { taskOutcome: normalized.taskOutcome } : {}),
          ...(normalized.taskCategory ? { taskCategory: normalized.taskCategory } : {}),
          ...(normalized.taskSummary ? { taskSummary: normalized.taskSummary } : {}),
        };
        for (const cb of this.listeners) cb(this.entries[i], true);
        return;
      }
    }
    this.addEntry(normalized, opts);
  }

  /** Get the most recent entry of a given type */
  getLastEntry(type: string): TimelineEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].type === type) return this.entries[i];
    }
    return null;
  }

  onEntry(cb: EntryListener): void {
    this.listeners.push(cb);
  }

  removeListener(cb: EntryListener): void {
    const idx = this.listeners.indexOf(cb);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  private tryMergeTaskEndByTaskId(entry: TimelineEntry): boolean {
    if (entry.type !== 'task_end' || !entry.taskId) return false;
    let idx = -1;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.type === 'task_end' && e.taskId === entry.taskId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;

    const existing = this.entries[idx];
    this.entries[idx] = {
      ...existing,
      raw: entry.raw,
      ...(entry.detail ? { detail: entry.detail } : {}),
      ...(entry.agentType ? { agentType: entry.agentType } : {}),
      ...(entry.projectName ? { projectName: entry.projectName } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      ...(entry.runId ? { runId: entry.runId } : {}),
      ...(entry.startedAt != null ? { startedAt: entry.startedAt } : {}),
      ...(entry.endedAt != null ? { endedAt: entry.endedAt } : {}),
      ...(entry.boundarySignal ? { boundarySignal: entry.boundarySignal } : {}),
      ...(entry.summaryKind ? { summaryKind: entry.summaryKind } : {}),
      ...(entry.taskScore != null ? { taskScore: entry.taskScore } : {}),
      ...(entry.taskOutcome ? { taskOutcome: entry.taskOutcome } : {}),
      ...(entry.taskCategory ? { taskCategory: entry.taskCategory } : {}),
      ...(entry.taskSummary ? { taskSummary: entry.taskSummary } : {}),
    };
    for (const cb of this.listeners) cb(this.entries[idx], true);
    return true;
  }
}
