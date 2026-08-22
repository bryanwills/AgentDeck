#if os(macOS)
// ApmeActivityHistory.swift — rebuildable Swift/CLI activity projection.
//
// Source APME databases stay private to their daemon tier. This file exchanges
// only the small dashboard projection over authenticated loopback HTTP and
// persists it as a disposable cache in the owning tier's data directory.

import CryptoKit
import Foundation

enum ApmeActivityHistory {
    static let schema = "agentdeck-activity/v1"
    private static let maxRows = 500
    private static let handoverGapMs = 5 * 60 * 1000
    private static let cacheLock = NSLock()

    struct Row: Codable, Equatable, Sendable {
        var originKey: String
        var agentType: String
        var sessionId: String
        var taskIndex: Int
        var projectName: String?
        var modelId: String?
        var task: String
        var startedAt: Int
        var endedAt: Int?
        var durationMs: Int
        var turnCount: Int
        var inputTokens: Int?
        var outputTokens: Int?
        var costUsd: Double?
        var overallScore: Double?
        var provenance: [String]
    }

    struct AgentSummary: Codable, Equatable, Sendable {
        var agentType: String
        var taskCount: Int
        var durationMs: Int
        var firstAt: Int
        var lastAt: Int
    }

    struct Snapshot: Codable, Equatable, Sendable {
        var schema: String
        var capturedAt: Int
        var rows: [Row]
        var agents: [AgentSummary]

        var dictionary: [String: Any] {
            guard let data = try? JSONEncoder().encode(self),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return ["schema": schema, "capturedAt": capturedAt, "rows": [], "agents": []] }
            return value
        }
    }

    static func snapshot(store: ApmeStore) -> Snapshot {
        makeSnapshot(rows: localRows(store: store) + loadPeerRows())
    }

    static func makeSnapshot(rows: [Row]) -> Snapshot {
        let merged = merge(rows: rows)
        return Snapshot(
            schema: schema,
            capturedAt: nowMs(),
            rows: merged,
            agents: summarize(rows: merged)
        )
    }

    static func localRows(store: ApmeStore) -> [Row] {
        let now = nowMs()
        var rows: [Row] = []
        for run in store.listRuns(limit: maxRows) {
            for task in store.listTasksForRun(run.id) {
                let turns = store.listTurnsForTask(task.id)
                // Count only agent-working intervals. Task wall time includes
                // the user's reading/typing gaps and can span overnight; only
                // a currently-open turn accrues to `now`.
                let activeDurationMs = turns.reduce(0) { total, turn in
                    guard let started = turn["started_at"] as? Int else { return total }
                    let ended = turn["ended_at"] as? Int ?? now
                    return total + max(0, ended - started)
                }
                let firstPrompt = normalizeTask(turns.first?["prompt"] as? String ?? run.taskPrompt ?? "")
                let label = normalizeTask(task.summary ?? firstPrompt)
                let endedAt = task.endedAt
                let agent = canonicalAgent(run.agentType)
                let session = canonicalSession(agentType: agent, value: run.sessionId)
                rows.append(Row(
                    originKey: originKey(
                        agentType: agent,
                        sessionId: session,
                        taskIndex: task.taskIndex,
                        firstPrompt: firstPrompt
                    ),
                    agentType: agent,
                    sessionId: session,
                    taskIndex: task.taskIndex,
                    projectName: run.projectName,
                    modelId: task.modelId ?? run.modelId,
                    task: String((label.isEmpty ? "(task details unavailable)" : label).prefix(500)),
                    startedAt: task.startedAt,
                    endedAt: endedAt,
                    durationMs: activeDurationMs,
                    turnCount: turns.count,
                    inputTokens: task.inputTokens,
                    outputTokens: task.outputTokens,
                    costUsd: task.costUsd,
                    overallScore: task.compositeScore,
                    provenance: ["swift"]
                ))
                if rows.count >= maxRows { break }
            }
            if rows.count >= maxRows { break }
        }
        return rows
    }

    static func merge(rows: [Row], limit: Int = maxRows) -> [Row] {
        var merged: [Row] = []
        for row in rows.sorted(by: {
            $0.startedAt == $1.startedAt ? $0.originKey < $1.originKey : $0.startedAt < $1.startedAt
        }) {
            if let index = merged.firstIndex(where: { sameActivity($0, row) }) {
                merged[index] = mergePair(merged[index], row)
            } else {
                merged.append(row)
            }
        }
        return Array(merged.sorted {
            $0.startedAt == $1.startedAt ? $0.originKey < $1.originKey : $0.startedAt > $1.startedAt
        }.prefix(limit))
    }

    static func originKey(agentType: String, sessionId: String, taskIndex: Int, firstPrompt: String) -> String {
        let agent = canonicalAgent(agentType)
        let session = canonicalSession(agentType: agent, value: sessionId)
        let input = "\(agent)\0\(session)\0\(taskIndex)\0\(normalizeTask(firstPrompt))"
        let digest = SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
        return "activity:v1:\(digest.prefix(24))"
    }

    static func syncFromPeer(port: Int, token: String) async -> Bool {
        guard let snapshot = await fetchSnapshot(port: port, token: token) else { return false }
        savePeerRows(snapshot.rows)
        return true
    }

    /// Read the owner daemon's already-merged projection. Both the menu-bar
    /// summary and peer handover use this one bounded loopback request so they
    /// cannot drift on auth, schema validation, timeouts, or payload limits.
    static func fetchSnapshot(port: Int, token: String) async -> Snapshot? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = port
        components.path = "/apme/activity"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else { return nil }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2.5
        config.timeoutIntervalForResource = 2.5
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 5 * 1024 * 1024,
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              snapshot.schema == schema
        else { return nil }

        return snapshot
    }

    private static func summarize(rows: [Row]) -> [AgentSummary] {
        var groups: [String: AgentSummary] = [:]
        for row in rows {
            let lastAt = row.endedAt ?? row.startedAt
            if var value = groups[row.agentType] {
                value.taskCount += 1
                value.durationMs += row.durationMs
                value.firstAt = min(value.firstAt, row.startedAt)
                value.lastAt = max(value.lastAt, lastAt)
                groups[row.agentType] = value
            } else {
                groups[row.agentType] = AgentSummary(
                    agentType: row.agentType,
                    taskCount: 1,
                    durationMs: row.durationMs,
                    firstAt: row.startedAt,
                    lastAt: lastAt
                )
            }
        }
        return groups.values.sorted {
            $0.durationMs == $1.durationMs ? $0.agentType < $1.agentType : $0.durationMs > $1.durationMs
        }
    }

    private static func sameActivity(_ a: Row, _ b: Row) -> Bool {
        if a.originKey == b.originKey {
            let aEnd = a.endedAt ?? a.startedAt
            let bEnd = b.endedAt ?? b.startedAt
            return a.startedAt <= bEnd + handoverGapMs && b.startedAt <= aEnd + handoverGapMs
        }
        guard a.agentType == b.agentType,
              a.sessionId == b.sessionId,
              a.taskIndex == b.taskIndex
        else { return false }
        let aEnd = a.endedAt ?? a.startedAt
        let bEnd = b.endedAt ?? b.startedAt
        return a.startedAt <= bEnd + handoverGapMs && b.startedAt <= aEnd + handoverGapMs
    }

    private static func mergePair(_ a: Row, _ b: Row) -> Row {
        let rich = quality(b) > quality(a) ? b : a
        let other = rich == a ? b : a
        let endedAt = [a.endedAt, b.endedAt].compactMap { $0 }.max()
        let startedAt = min(a.startedAt, b.startedAt)
        var out = rich
        out.originKey = min(a.originKey, b.originKey)
        out.projectName = rich.projectName ?? other.projectName
        out.modelId = rich.modelId ?? other.modelId
        if out.task.isEmpty { out.task = other.task }
        out.startedAt = startedAt
        out.endedAt = endedAt
        // These are summed turn-working intervals; never reconstruct duration
        // from merged wall-clock bounds (which include user think time).
        out.durationMs = max(a.durationMs, b.durationMs)
        out.turnCount = max(a.turnCount, b.turnCount)
        out.inputTokens = maxOptional(a.inputTokens, b.inputTokens)
        out.outputTokens = maxOptional(a.outputTokens, b.outputTokens)
        out.costUsd = maxOptional(a.costUsd, b.costUsd)
        out.overallScore = maxOptional(a.overallScore, b.overallScore)
        out.provenance = Array(Set(a.provenance + b.provenance)).sorted()
        return out
    }

    private static func quality(_ row: Row) -> Int {
        (row.task.isEmpty || row.task == "(task details unavailable)" ? 0 : 4)
            + (row.endedAt == nil ? 0 : 2)
            + (row.modelId == nil ? 0 : 1)
            + (row.overallScore == nil ? 0 : 1)
            + (row.inputTokens == nil && row.outputTokens == nil && row.costUsd == nil ? 0 : 1)
    }

    private static func maxOptional<T: Comparable>(_ a: T?, _ b: T?) -> T? {
        switch (a, b) {
        case let (a?, b?): return max(a, b)
        case let (a?, nil): return a
        case let (nil, b?): return b
        case (nil, nil): return nil
        }
    }

    private static func canonicalAgent(_ value: String) -> String {
        let v = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if v == "codex" || v == "codex-app" { return "codex-cli" }
        if v == "open-code" { return "opencode" }
        return v.isEmpty ? "unknown" : v
    }

    private static func canonicalSession(agentType: String, value: String) -> String {
        var result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixes = agentType == "codex-cli" ? ["codex:"]
            : agentType == "opencode" ? ["opencode:"] : []
        for prefix in prefixes where result.lowercased().hasPrefix(prefix) {
            result = String(result.dropFirst(prefix.count))
        }
        return result.isEmpty ? "unknown" : result
    }

    private static func normalizeTask(_ value: String) -> String {
        String(value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(2_000))
    }

    private static func cacheURL() -> URL {
        AuthManager.agentDeckDir.appendingPathComponent("apme-peer-activity.json")
    }

    private static func loadPeerRows() -> [Row] {
        cacheLock.withLock {
            guard let data = try? Data(contentsOf: cacheURL()),
                  let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
                  snapshot.schema == schema
            else { return [] }
            return Array(snapshot.rows.prefix(maxRows))
        }
    }

    private static func savePeerRows(_ rows: [Row]) {
        cacheLock.withLock {
            let merged = merge(rows: loadPeerRowsUnlocked() + rows)
            let snapshot = Snapshot(schema: schema, capturedAt: nowMs(), rows: merged, agents: summarize(rows: merged))
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            let directory = AuthManager.agentDeckDir
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let target = cacheURL()
            let temp = directory.appendingPathComponent("apme-peer-activity.\(UUID().uuidString).tmp")
            do {
                try data.write(to: temp, options: .atomic)
                _ = try FileManager.default.replaceItemAt(target, withItemAt: temp)
            } catch {
                // replaceItemAt requires an existing destination. First sync
                // takes the simple atomic-write path; a failed temp is removed.
                try? data.write(to: target, options: .atomic)
                try? FileManager.default.removeItem(at: temp)
            }
        }
    }

    private static func loadPeerRowsUnlocked() -> [Row] {
        guard let data = try? Data(contentsOf: cacheURL()),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              snapshot.schema == schema else { return [] }
        return Array(snapshot.rows.prefix(maxRows))
    }

    private static func nowMs() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }
}
#endif
