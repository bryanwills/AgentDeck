// TimelineStore.swift — Event buffer with grouping
// Ported from plugin/src/timeline-store.ts + android TimelineStore.kt

import Foundation

@Observable
final class TimelineStore: @unchecked Sendable {
    private(set) var entries: [TimelineEntry] = []
    private(set) var grouped: [GroupedEntry] = []

    private let maxEntries = 200

    /// Whether we're receiving timeline from bridge (suppress local generation)
    var receivingBridgeTimeline = false

    // MARK: - Add Entry

    func addEntry(_ entry: TimelineEntry, upsert: Bool = false) {
        if upsert {
            // Update existing entry with same ts + type
            if let idx = entries.firstIndex(where: { $0.ts == entry.ts && $0.type == entry.type }) {
                entries[idx] = entry
                regroup()
                return
            }
        }

        entries.append(entry)

        // Trim oldest if over limit
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }

        regroup()
    }

    // MARK: - Merge History (bulk load, dedup)

    func mergeHistory(_ newEntries: [TimelineEntry]) {
        let existingTimestamps = Set(entries.map { $0.ts })
        let unique = newEntries.filter { !existingTimestamps.contains($0.ts) }

        entries.append(contentsOf: unique)
        entries.sort { $0.ts < $1.ts }

        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }

        regroup()
    }

    // MARK: - Clear

    func clear() {
        entries.removeAll()
        grouped.removeAll()
    }

    // MARK: - Regroup

    private func regroup() {
        grouped = groupConsecutive(entries)
    }
}
