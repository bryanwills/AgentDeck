package dev.agentdeck.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

@Serializable
data class TimelineEntry(
    val timestamp: Long,
    val type: String,
    val summary: String,
    val detail: String? = null,
    val agentType: String? = null,
    val projectName: String? = null,
    val sessionId: String? = null,
    val runId: String? = null,
    val startedAt: Long? = null,
    val endedAt: Long? = null,
    val status: String? = null,
    val automated: Boolean? = null,
    /** APME task id. Set on task_start/task_end and on every turn entry inside the task scope. */
    val taskId: String? = null,
    /** Only on task_end. todo_complete | clear | session_end | manual | idle_gap. */
    val boundarySignal: String? = null,
    /** "llm" | "heuristic" | "none". Lets clients suppress the detail pane
     *  when the heuristic gave up and the body is just the raw response. */
    val summaryKind: String? = null,
    /**
     * Task-judge rollup, attached on the SECOND `task_end` emit the runner
     * fires once the LLM judge resolves (5–30 s after the boundary). Stores
     * upsert by (type, taskId) — see `upsertEntry`. Nil on the initial emit
     * and for non-task entries / pre-existing on-disk rows. Mirrors the four
     * task* fields on shared/src/timeline.ts::TimelineEntry.
     *   - `taskScore`    : 0..1 composite
     *   - `taskOutcome`  : "success" | "partial" | "fail" | "pending"
     *   - `taskCategory` : task_rollup category
     *   - `taskSummary`  : one-line judge summary
     */
    val taskScore: Double? = null,
    val taskOutcome: String? = null,
    val taskCategory: String? = null,
    val taskSummary: String? = null,
)

data class GroupedEntry(
    val entry: TimelineEntry,
    val count: Int = 1,
    val lastTs: Long = entry.timestamp,
    /** Assistant response body (chat_response) merged into this turn group.
     *  The daemon emits chat_start / chat_response / chat_end as three separate
     *  rows; the UI presents them as one turn row so users see a single
     *  evaluable unit instead of three near-duplicate lines. Mirrors
     *  `apple/AgentDeck/Model/Timeline.swift` GroupedEntry.mergedResponse. */
    val mergedResponse: TimelineEntry? = null,
    /** Terminator metadata (chat_end) merged into this turn group — carries the
     *  "Completed · Ns · topic" suffix. Mirrors Apple mergedCompletion. */
    val mergedCompletion: TimelineEntry? = null,
) {
    /** True when the assistant delivered something for this turn (response body
     *  or completion metadata). UIs use it to stop the chat_start spinner and
     *  swap its icon to the completed glyph — otherwise a merged, completed
     *  turn would spin forever because `chat_start` always maps to the Running
     *  icon. Mirrors Apple GroupedEntry.hasResponse. */
    val hasResponse: Boolean get() = mergedResponse != null || mergedCompletion != null
}

/**
 * Collapse the raw timeline into display groups.
 *
 * Two distinct collapses happen here (mirrors
 * `apple/AgentDeck/Model/Timeline.swift::groupConsecutive`):
 *  1. **Turn merge** — an in-flight `chat_start` absorbs the `chat_response`
 *     and `chat_end` the daemon emits for the same turn, so one user prompt
 *     renders as ONE row instead of three. This is what keeps OpenClaw cron
 *     turns (chat_start + chat_response, each with different text) from
 *     rendering as two rows the way Android used to. A standalone
 *     `chat_response` likewise absorbs a trailing `chat_end`.
 *  2. **Same-type run collapse** — consecutive same-type(+summary) rows fold
 *     into one `×count` group (`canGroup`): tool_request 10s, chat_end/default
 *     60s.
 */
fun groupConsecutive(entries: List<TimelineEntry>): List<GroupedEntry> {
    if (entries.isEmpty()) return emptyList()
    val result = mutableListOf<GroupedEntry>()
    var current = GroupedEntry(entry = entries[0], lastTs = entries[0].timestamp)
    for (i in 1 until entries.size) {
        val entry = entries[i]

        // Task hierarchy markers never group — each is a unique unit of work.
        if (entry.type == "task_start" || entry.type == "task_end" ||
            current.entry.type == "task_start" || current.entry.type == "task_end"
        ) {
            result.add(current)
            current = GroupedEntry(entry = entry, lastTs = entry.timestamp)
            continue
        }

        // Turn merge: chat_start absorbs its chat_response + chat_end. The turn
        // context (`sameTimelineContext` — taskId/runId/sessionId aware, so two
        // turns in one session with distinct runIds never fold together) plus
        // the chat_start anchor (child.startedAt == chat_start.ts) gate the
        // merge — wall-clock does not, because long responses push chat_end far
        // past any window. Synthetic starters ("Prompt sent" / "Connected") are
        // excluded so the trailing completion stays the visible row.
        if (current.entry.type == "chat_start" &&
            current.mergedCompletion == null &&
            isMeaningfulChatStart(current.entry) &&
            sameTimelineContext(current.entry, entry) &&
            sameTurnAnchor(current.entry, entry)
        ) {
            if (entry.type == "chat_response" && current.mergedResponse == null) {
                current = current.copy(mergedResponse = entry)
                continue
            }
            if (entry.type == "chat_end") {
                current = current.copy(mergedCompletion = entry)
                continue
            }
        }

        // A visible chat_response absorbs its trailing chat_end so "Completed ·
        // …" metadata doesn't spawn its own row.
        if (current.entry.type == "chat_response" &&
            current.mergedCompletion == null &&
            entry.type == "chat_end" &&
            sameTimelineContext(current.entry, entry) &&
            sameResponseCompletionAnchor(current.entry, entry)
        ) {
            current = current.copy(mergedCompletion = entry)
            continue
        }

        // Same-type consecutive run collapse (×count) — keep latest entry.
        if (canGroup(current, entry)) {
            current = current.copy(
                entry = entry,
                count = current.count + 1,
                lastTs = entry.timestamp,
            )
        } else {
            result.add(current)
            current = GroupedEntry(entry = entry, lastTs = entry.timestamp)
        }
    }
    result.add(current)
    return result
}

/** True when `child` (chat_response/chat_end) belongs to `start`: the daemon
 *  stamps each child's `startedAt` with the originating chat_start's ts.
 *  Legacy emitters without `startedAt` permit the merge (bounded by iteration
 *  order). Mirrors Apple `sameTurnAnchor`. */
private fun sameTurnAnchor(start: TimelineEntry, child: TimelineEntry): Boolean {
    val anchor = child.startedAt ?: return true
    return anchor == start.timestamp
}

/** Anchor test for chat_response → chat_end absorption. Permits the merge when
 *  either side lacks `startedAt`. Mirrors Apple `sameResponseCompletionAnchor`. */
private fun sameResponseCompletionAnchor(response: TimelineEntry, completion: TimelineEntry): Boolean {
    val r = response.startedAt
    val c = completion.startedAt
    return if (r != null && c != null) r == c else true
}

private fun canGroup(group: GroupedEntry, entry: TimelineEntry): Boolean {
    val prev = group.entry
    if (prev.type != entry.type) return false
    // Task hierarchy markers never group — each task is a unique unit of work.
    if (entry.type == "task_start" || entry.type == "task_end") return false
    val window = when (entry.type) {
        "tool_request" -> 10_000L
        "chat_end" -> 60_000L
        else -> 60_000L
    }
    if (entry.timestamp - group.lastTs > window) return false
    if (!sameTimelineContext(prev, entry)) return false
    // chat_end: group by type only (keep latest summary)
    if (entry.type == "chat_end") return true
    // tool_request: group by type only
    if (entry.type == "tool_request") return true
    // others: same summary
    return prev.summary == entry.summary
}

class TimelineStore private constructor() {

    companion object {
        val instance: TimelineStore by lazy { TimelineStore() }
        private const val MAX_ENTRIES = 500
    }

    private val _entries = MutableStateFlow<List<TimelineEntry>>(emptyList())
    val entries: StateFlow<List<TimelineEntry>> = _entries.asStateFlow()

    fun addEntry(entry: TimelineEntry) {
        val normalized = normalizeTimelineEntryForStorage(entry) ?: return
        // Drop codex:otel-active noise at the **storage** layer so it never
        // reaches consumers that bypass `timelineDisplayGroups` (raw
        // `entries` flow readers, persistence in future, etc.) and so the
        // MAX_ENTRIES buffer doesn't age out useful rows behind it.
        // Mirrors Apple `DaemonTimelineStore` add-path filter.
        val list = _entries.value
        // 5s dedup — skip if same type+summary within window
        for (i in list.indices.reversed()) {
            val e = list[i]
            if (normalized.timestamp - e.timestamp > 5000) break
            if (e.type == normalized.type && e.summary == normalized.summary) return
        }
        _entries.value = (list + normalized).takeLast(MAX_ENTRIES)
    }

    /** Update the most recent entry matching [type] using [transform]. */
    fun updateLastOfType(type: String, transform: (TimelineEntry) -> TimelineEntry) {
        val list = _entries.value.toMutableList()
        val idx = list.indexOfLast { it.type == type }
        if (idx >= 0) {
            list[idx] = transform(list[idx])
            _entries.value = list
        }
    }

    /** Update existing entry with same ts+type (1s tolerance), or add new.
     *
     *  taskId / boundarySignal / summaryKind are progressive: a heuristic
     *  chat_end can later be upserted with summaryKind='llm' + the LLM
     *  summary. Without propagating these, the dashboard keeps showing the
     *  pre-LLM kind and (for 'none' rows) the detail pane stays suppressed
     *  even after the LLM rescues it. */
    fun upsertEntry(entry: TimelineEntry) {
        val normalized = normalizeTimelineEntryForStorage(entry) ?: return
        // Storage-layer guard mirrors addEntry — never let an OTel low-
        // signal row enter, even via the upsert path used for progressive
        // summaryKind enrichment.
        val list = _entries.value.toMutableList()
        // Task-judge follow-up emits land 5–30 s after the initial boundary,
        // so the 1 s timestamp window won't match. For task_end rows, prefer
        // matching by (type, taskId) — that pair is stable across both emits
        // and lets the score-bearing update merge in place. Mirrors Apple
        // `DaemonTimelineStore::upsert`.
        val taskMatchIdx = if (normalized.type == "task_end" && !normalized.taskId.isNullOrEmpty()) {
            list.indexOfLast { it.type == "task_end" && it.taskId == normalized.taskId }
        } else -1
        val idx = if (taskMatchIdx >= 0) taskMatchIdx else {
            list.indexOfLast { it.type == normalized.type && kotlin.math.abs(it.timestamp - normalized.timestamp) < 1000L }
        }
        if (idx >= 0) {
            list[idx] = list[idx].copy(
                summary = normalized.summary,
                detail = normalized.detail ?: list[idx].detail,
                agentType = normalized.agentType ?: list[idx].agentType,
                projectName = normalized.projectName ?: list[idx].projectName,
                sessionId = normalized.sessionId ?: list[idx].sessionId,
                runId = normalized.runId ?: list[idx].runId,
                startedAt = normalized.startedAt ?: list[idx].startedAt,
                endedAt = normalized.endedAt ?: list[idx].endedAt,
                status = normalized.status ?: list[idx].status,
                automated = normalized.automated ?: list[idx].automated,
                taskId = normalized.taskId ?: list[idx].taskId,
                boundarySignal = normalized.boundarySignal ?: list[idx].boundarySignal,
                summaryKind = normalized.summaryKind ?: list[idx].summaryKind,
                taskScore = normalized.taskScore ?: list[idx].taskScore,
                taskOutcome = normalized.taskOutcome ?: list[idx].taskOutcome,
                taskCategory = normalized.taskCategory ?: list[idx].taskCategory,
                taskSummary = normalized.taskSummary ?: list[idx].taskSummary,
            )
            _entries.value = list
        } else {
            addEntry(normalized)
        }
    }

    fun addEntries(newEntries: List<TimelineEntry>) {
        // Same storage-layer guard as addEntry — bulk replay paths
        // (sessions_list snapshots, daemon resync) must not bypass the
        // OTel filter.
        val filtered = newEntries.mapNotNull { normalizeTimelineEntryForStorage(it) }
        _entries.value = (_entries.value + filtered)
            .distinctBy { "${it.timestamp}-${it.type}-${it.summary}" }
            .sortedBy { it.timestamp }
            .takeLast(MAX_ENTRIES)
    }

    /**
     * Replace the entire buffer with a daemon snapshot.
     *
     * The daemon's only `timeline_history` to a dashboard client is the FULL
     * store snapshot sent in `sendInitialState` (Android never issues a
     * session-scoped `query_session_timeline`). Merging it into the existing
     * buffer — the old behaviour — let re-emitted OpenClaw rows stack across
     * reconnects: the daemon re-stamps `ts` on log-tail replay, so the
     * `ts-type-summary` history dedup key shifts and the "same" row survives.
     * The tablet's Wi-Fi reconnect churn made this the dominant duplicate
     * source. Since the snapshot is authoritative, replace rather than merge.
     *
     * Ordering is safe: the daemon sends `connection` → `timeline_history`
     * before any live `timeline_event` on a fresh socket, and TCP preserves
     * order, so no live row is lost by replacing here.
     */
    fun replaceSnapshot(snapshot: List<TimelineEntry>) {
        val filtered = snapshot.mapNotNull { normalizeTimelineEntryForStorage(it) }
        _entries.value = filtered
            .distinctBy { "${it.timestamp}-${it.type}-${it.summary}" }
            .sortedBy { it.timestamp }
            .takeLast(MAX_ENTRIES)
    }

    fun clear() {
        _entries.value = emptyList()
    }
}
