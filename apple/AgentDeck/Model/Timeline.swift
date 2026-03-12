// Timeline.swift — Event timeline types
// Ported from shared/src/timeline.ts

import Foundation

// MARK: - Timeline Entry Type

enum TimelineEntryType: String, Codable, Sendable {
    case toolRequest = "tool_request"
    case toolResolved = "tool_resolved"
    case chatStart = "chat_start"
    case chatEnd = "chat_end"
    case chatResponse = "chat_response"
    case error
    case scheduled
    case userAction = "user_action"
    case modelCall = "model_call"
    case modelResponse = "model_response"
    case memoryRecall = "memory_recall"
    case toolExec = "tool_exec"
}

// MARK: - Timeline Entry

struct TimelineEntry: Codable, Sendable, Identifiable {
    let ts: Double  // milliseconds
    let type: TimelineEntryType
    let raw: String
    var detail: String?
    var approvalId: String?
    var status: String?  // pending | approved | denied
    var agentType: String?

    var id: Double { ts }

    var date: Date {
        Date(timeIntervalSince1970: ts / 1000)
    }
}

// MARK: - Grouped Entry (for UI display)

struct GroupedEntry: Identifiable, Sendable {
    let entry: TimelineEntry
    var count: Int = 1
    var id: Double { entry.ts }
}

// MARK: - Timeline Grouping

func groupConsecutive(_ entries: [TimelineEntry], windowSeconds: Double = 60) -> [GroupedEntry] {
    guard !entries.isEmpty else { return [] }

    var result: [GroupedEntry] = []
    var current = GroupedEntry(entry: entries[0])

    for i in 1..<entries.count {
        let entry = entries[i]
        let timeDiff = abs(entry.ts - current.entry.ts)

        if entry.type == current.entry.type &&
           entry.raw == current.entry.raw &&
           timeDiff <= windowSeconds * 1000 {
            current.count += 1
        } else {
            result.append(current)
            current = GroupedEntry(entry: entry)
        }
    }
    result.append(current)
    return result
}

// MARK: - Type Display

func typeIcon(for type: TimelineEntryType) -> String {
    switch type {
    case .chatStart: "▶"
    case .chatEnd: "■"
    case .chatResponse: "◆"
    case .toolRequest: "⚡"
    case .toolResolved: "✓"
    case .toolExec: "⚡"
    case .error: "✗"
    case .scheduled: "◇"
    case .userAction: "►"
    case .modelCall: "▶"
    case .modelResponse: "◆"
    case .memoryRecall: "◇"
    }
}
