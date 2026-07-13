// TimelineStore.swift — Event buffer with grouping
// Ported from plugin/src/timeline-store.ts + android TimelineStore.kt

import Foundation
import Combine

final class TimelineStore: ObservableObject, @unchecked Sendable {
    @Published private(set) var entries: [TimelineEntry] = []
    // NOTE: no stored `grouped` here. The store used to keep a @Published
    // grouped array recomputed via groupConsecutive() on every addEntry, but
    // no view ever read it — TimelineStripView runs its own
    // groupConsecutive(filteredEntries) per render (it must, because the
    // session filter changes the grouping input). The stored copy was pure
    // duplicate work plus an extra objectWillChange fire per event.

    // Parity with Android `TimelineStore.MAX_ENTRIES` (500). The old 200-cap
    // aged real turn/task rows out faster than Android on the same stream — and
    // when macOS attaches to an external Node daemon whose store isn't OTel-
    // filtered, tool_exec noise ate the buffer even quicker (timeline data
    // audit 2026-07-13).
    private let maxEntries = 500

    /// Whether we're receiving timeline from bridge (suppress local generation)
    @Published var receivingBridgeTimeline = false

    // MARK: - Add Entry

    func addEntry(_ rawEntry: TimelineEntry, upsert: Bool = false) {
        // Storage-layer OTel/tool-placeholder filter — mirrors Android
        // `TimelineStore.addEntry`/`upsertEntry` so noise never occupies a
        // buffer slot (and so `entries` readers that bypass display grouping
        // don't see it), even on the upsert enrichment path.
        guard let entry = normalizeTimelineEntryForStorage(rawEntry) else { return }
        if upsert {
            // Task-judge follow-up emits land 5–30 s after the initial
            // boundary, so matching on (ts, type) misses them. For task_end
            // rows, fall back to matching by (type, taskId) — that pair is
            // stable across both emits and lets the score-bearing update
            // merge in place. Mirrors `DaemonTimelineStore::upsert`.
            if entry.type == .taskEnd, let taskId = entry.taskId,
               let idx = entries.lastIndex(where: { $0.type == .taskEnd && $0.taskId == taskId }) {
                entries[idx] = entry
                return
            }
            // Update existing entry with same ts + type
            if let idx = entries.firstIndex(where: { $0.ts == entry.ts && $0.type == entry.type }) {
                entries[idx] = entry
                return
            }
        }

        // Sorted insert: live events normally arrive ascending (append
        // fast-path), but the daemon's deferred `task_start` is backdated to
        // the task's original startedAt — a plain append renders the TASK
        // header below the turns it groups until the next history re-sort.
        if let last = entries.last, entry.ts < last.ts {
            let idx = entries.lastIndex(where: { $0.ts <= entry.ts }).map { $0 + 1 } ?? 0
            entries.insert(entry, at: idx)
        } else {
            entries.append(entry)
        }

        // Trim oldest if over limit
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
    }

    // MARK: - Replace Snapshot (authoritative history load)

    /// Replace the entire buffer with a daemon `timeline_history` snapshot.
    ///
    /// The daemon's `timeline_history` to a WS client is the FULL authoritative
    /// store snapshot sent in the initial state on a fresh socket. The old
    /// `mergeHistory` (ts-only dedup + append, never clearing) let re-stamped
    /// rows stack across reconnects: the daemon re-stamps `ts` on log-tail
    /// replay, so a ts-only key shifts and the "same" OpenClaw row survives —
    /// the ghost-row accumulation that bit the Android tablet before it moved
    /// to replace-on-connect. Since the snapshot is authoritative and TCP
    /// preserves the `connection` → `timeline_history` → live-event order, no
    /// live row is lost by replacing. Dedup by (ts, type, raw) mirrors Android
    /// `replaceSnapshot`'s `ts-type-summary` key; the storage filter runs here
    /// too so a snapshot can't reintroduce noise. Mirrors android
    /// `TimelineStore.kt::replaceSnapshot`.
    func replaceSnapshot(_ snapshot: [TimelineEntry]) {
        var seen = Set<String>()
        var deduped: [TimelineEntry] = []
        for entry in snapshot.compactMap({ normalizeTimelineEntryForStorage($0) }) {
            let key = "\(entry.ts)-\(entry.type.rawValue)-\(entry.raw)"
            if seen.insert(key).inserted { deduped.append(entry) }
        }
        deduped.sort { $0.ts < $1.ts }
        if deduped.count > maxEntries {
            deduped.removeFirst(deduped.count - maxEntries)
        }
        entries = deduped
    }

    // MARK: - Clear

    func clear() {
        entries.removeAll()
    }
}
