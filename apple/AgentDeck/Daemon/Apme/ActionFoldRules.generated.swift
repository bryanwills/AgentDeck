// GENERATED FILE — DO NOT EDIT.
// Source of truth: shared/src/action-fold.ts
// Regenerate: pnpm generate-apme-display-rules (drift gated by shared/src/__tests__/apme-display-rules-sync.test.ts)

import Foundation

/// Fold a task's tool activity into one summary line
/// (`Edit×9 Read×24 Bash×11 +2 · 3 files`) and count its coordination shape
/// (subagent dispatches / agent-to-agent messages). The Swift daemon's
/// GET /apme/tasks enriches Work-board rows with these, so both daemons must
/// fold identically whichever one owns port 9120.
///
/// Parity is pinned by shared/action-fold-vectors.json, replayed by BOTH
/// suites. The tie-break in the fold is a plain UTF-16 code-unit compare on
/// both sides (TS `<` on strings ≡ Swift comparing `String.utf16`
/// lexicographically) — NOT localeCompare, whose order is host-locale
/// dependent, and not Swift's default `<`, which compares canonically
/// composed characters and can disagree with TS on non-ASCII names.
enum ActionFoldRules {

    /// Named tools the fold shows before collapsing the rest to `+N`.
    static let maxTools = 4

    /// Tool names that DISPATCH another agent (fan-out). Exact raw names —
    /// matched BEFORE foldToolName, like the TS side.
    static let dispatchToolNames: Set<String> = ["Agent", "Task", "Workflow", "task"]

    /// Tool names that MESSAGE another agent (peer/teammate traffic).
    static let messagingToolNames: Set<String> = ["SendMessage"]

    /// `mcp__claude-in-chrome__navigate` → `navigate`: the server prefix is
    /// provenance, not shape. Non-MCP names pass through unchanged.
    static func foldToolName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasPrefix("mcp__") else { return trimmed }
        let segments = trimmed.components(separatedBy: "__").filter { !$0.isEmpty }
        return segments.last ?? trimmed
    }

    /// TS `a < b` compares UTF-16 code units; mirror that exactly so a tie
    /// between non-ASCII tool names folds in the same order on both daemons.
    private static func utf16LessThan(_ a: String, _ b: String) -> Bool {
        var ai = a.utf16.makeIterator(), bi = b.utf16.makeIterator()
        while true {
            switch (ai.next(), bi.next()) {
            case (nil, nil): return false
            case (nil, _): return true
            case (_, nil): return false
            case let (x?, y?):
                if x != y { return x < y }
            }
        }
    }

    /// Count the coordination shape from per-tool counts. Returns nil when the
    /// task neither dispatched nor messaged, so a plain single-agent task
    /// renders no coordination chip at all.
    static func agentCoordinationSummary(
        _ tools: [(name: String, count: Int)]
    ) -> (dispatches: Int, messages: Int)? {
        var dispatches = 0
        var messages = 0
        for t in tools {
            guard t.count > 0 else { continue }
            let trimmed = t.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if dispatchToolNames.contains(trimmed) { dispatches += t.count }
            if messagingToolNames.contains(trimmed) { messages += t.count }
        }
        if dispatches == 0 && messages == 0 { return nil }
        return (dispatches, messages)
    }

    /// Fold tool counts into the summary line. Returns nil when there is
    /// nothing to say (no tools and no files) — callers render nothing rather
    /// than an empty string, matching the retain-on-absent display rules.
    static func foldActionCounts(
        tools: [(name: String, count: Int)], filesTouched: Int?
    ) -> String? {
        var merged: [String: Int] = [:]
        for t in tools {
            let name = foldToolName(t.name)
            guard !name.isEmpty, t.count > 0 else { continue }
            merged[name, default: 0] += t.count
        }
        let sorted = merged.sorted { a, b in
            a.value != b.value ? a.value > b.value : utf16LessThan(a.key, b.key)
        }
        var parts: [String] = []
        if !sorted.isEmpty {
            let shown = sorted.prefix(maxTools)
            let rest = sorted.count - shown.count
            parts.append(shown.map { "\($0.key)×\($0.value)" }.joined(separator: " ")
                + (rest > 0 ? " +\(rest)" : ""))
        }
        let files = filesTouched ?? 0
        if files > 0 { parts.append("\(files) file\(files == 1 ? "" : "s")") }
        if parts.isEmpty { return nil }
        return parts.joined(separator: " · ")
    }
}
