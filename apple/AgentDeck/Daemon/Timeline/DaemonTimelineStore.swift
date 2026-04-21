#if os(macOS)
// TimelineStore.swift — In-memory timeline event storage with disk persistence
// Ported from bridge/src/timeline-store.ts

import Foundation

struct DaemonTimelineEntry: Codable, Sendable {
    let ts: Double  // milliseconds
    let type: String
    let raw: String
    var detail: String?
    var approvalId: String?
    var status: String?
    var agentType: String?
    var repeatCount: Int?
    var automated: Bool?
    /// Project name + session id of the originating session. Mirrors the
    /// equivalent fields on `TimelineEntry` (UI-facing copy) so entries
    /// round-tripped through the on-disk timeline keep per-session
    /// attribution. Existing persisted entries without these keys decode
    /// to nil via Codable's default optional-missing-key behaviour.
    var projectName: String?
    var sessionId: String?
    /// OpenClaw Gateway runId — groups entries belonging to the same
    /// generation cycle so clients can cluster them into a single turn row.
    var runId: String?
}

actor DaemonTimelineStore {
    private var entries: [DaemonTimelineEntry] = []
    private let maxEntries = 200
    private let persistFile = AuthManager.agentDeckDir.appendingPathComponent("timeline.json")
    private var dirty = false

    init() {
        // loadFromDisk is called after actor init via start()
    }

    func start() {
        loadFromDisk()
    }

    func add(_ entry: DaemonTimelineEntry) {
        // Exact dedup: same ts + type + raw within 5s
        let recentWindow = entry.ts - 5000
        if entries.last(where: { $0.ts > recentWindow && $0.type == entry.type && $0.raw == entry.raw }) != nil {
            return
        }

        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
        dirty = true
    }

    func upsert(_ entry: DaemonTimelineEntry) {
        if let idx = entries.lastIndex(where: { $0.ts == entry.ts && $0.type == entry.type }) {
            entries[idx] = entry
        } else {
            add(entry)
        }
        dirty = true
    }

    func getAll() -> [DaemonTimelineEntry] { entries }

    func getRecent(_ count: Int = 50) -> [DaemonTimelineEntry] {
        Array(entries.suffix(count))
    }

    /// Returns the last timeline entry matching the given type, or nil if none found.
    func getLastEntry(type: String) -> DaemonTimelineEntry? {
        entries.last(where: { $0.type == type })
    }

    func flush() {
        guard dirty else { return }
        if let data = try? JSONEncoder().encode(entries) {
            try? data.write(to: persistFile)
        }
        dirty = false
    }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: persistFile),
              let loaded = try? JSONDecoder().decode([DaemonTimelineEntry].self, from: data) else { return }
        entries = Array(loaded.suffix(maxEntries))
    }
}
#endif
