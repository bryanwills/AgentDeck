#if os(macOS)
// MiniToml.swift — minimal lossless TOML editor for ~/.codex/config.toml.
//
// We deliberately do NOT parse TOML semantically. Codex configs contain
// user-authored keys, comments, profile tables, and MCP server tables that
// we have no business round-tripping through Foundation's JSON-style
// serializer. Instead, AgentDeck-managed entries live inside a fenced
// block bounded by sentinel comments:
//
//     # >>> AgentDeck managed (do not edit) <<<
//     <our keys>
//     # <<< AgentDeck managed (do not edit) >>>
//
// applyManagedBlock replaces (or appends) the fence; removeManagedBlock
// strips it. Everything outside the fence is preserved byte-for-byte.
// hasTopLevel{Key,Table}OutsideFence detects user-authored conflicts so
// CodexConfigInstaller can abort cleanly instead of producing a TOML
// duplicate-key error.

import Foundation

enum MiniToml {
    static let openFence = "# >>> AgentDeck managed (do not edit) <<<"
    static let closeFence = "# <<< AgentDeck managed (do not edit) >>>"

    /// Replace the AgentDeck-managed fenced block (or append one when none
    /// exists). The body is wrapped between `openFence` / `closeFence` so
    /// `removeManagedBlock` can strip it cleanly later. Returns the full
    /// updated TOML text.
    static func applyManagedBlock(in text: String, body: String) -> String {
        var lines = splitLines(text)
        let fenceRange = locateFence(in: lines)

        let bodyLines = body.isEmpty ? [] : splitLines(body)
        let replacement = [openFence] + bodyLines + [closeFence]

        if let range = fenceRange {
            lines.replaceSubrange(range, with: replacement)
        } else {
            // Pad with a blank line for readability when appending to a
            // non-empty file. Avoids glueing our fence onto the user's
            // last key.
            if !lines.isEmpty, !(lines.last?.isEmpty ?? true) {
                lines.append("")
            }
            lines.append(contentsOf: replacement)
        }
        return lines.joined(separator: "\n")
    }

    /// Strip the AgentDeck-managed block entirely. Idempotent — no-op when
    /// the fence is absent.
    static func removeManagedBlock(in text: String) -> String {
        var lines = splitLines(text)
        guard let range = locateFence(in: lines) else { return text }
        lines.removeSubrange(range)
        // Collapse a trailing blank line that we may have inserted in
        // applyManagedBlock so removeManagedBlock truly returns the file
        // to its pre-apply shape.
        while let last = lines.last, last.isEmpty {
            lines.removeLast()
        }
        // Restore a single trailing newline if the original ended with one.
        if text.hasSuffix("\n") { lines.append("") }
        return lines.joined(separator: "\n")
    }

    /// Detect a top-level `<key> = ...` definition outside the fence.
    /// Codex `notify` is a top-level key; if the user already wrote one
    /// our fenced `notify` would be a duplicate-key TOML error.
    static func hasTopLevelKeyOutsideFence(in text: String, key: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: key)
        guard let regex = try? NSRegularExpression(pattern: "^\\s*\(escaped)\\s*=") else {
            return false
        }
        var insideFence = false
        var insideTable = false
        for line in splitLines(text) {
            if line == openFence { insideFence = true; continue }
            if line == closeFence { insideFence = false; continue }
            if insideFence { continue }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") && trimmed.hasSuffix("]") {
                insideTable = true
                continue
            }
            if insideTable { continue }
            let ns = line as NSString
            if regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) != nil {
                return true
            }
        }
        return false
    }

    /// Detect a `[<table>]`, `[<table>.subkey]`, or matching array-of-table
    /// header outside the fence. Codex `[otel]` / `[features]` / `[hooks]`
    /// tables collide with the fence we'd write.
    static func hasTableOutsideFence(in text: String, table: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: table)
        // Match exactly `[otel]`, `[otel.something]`, `[[otel.something]]`,
        // but not `[otelfoo]`. Whitespace inside brackets is permissive.
        let pattern = "^\\s*\\[\\[?\\s*\(escaped)(\\.[A-Za-z0-9_\\-]+)*\\s*\\]\\]?\\s*$"
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return false
        }
        var insideFence = false
        for line in splitLines(text) {
            if line == openFence { insideFence = true; continue }
            if line == closeFence { insideFence = false; continue }
            if insideFence { continue }
            let ns = line as NSString
            if regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) != nil {
                return true
            }
        }
        return false
    }

    /// Quote a string as a TOML basic string. We escape backslash, double
    /// quote, and control characters so the output is always single-line
    /// safe. Multi-line bodies should be assembled as raw lines and embed
    /// individual quoted strings via this helper.
    static func quoted(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 {
                    out += String(format: "\\u%04x", ch.value)
                } else {
                    out.unicodeScalars.append(ch)
                }
            }
        }
        out += "\""
        return out
    }

    // MARK: - Internals

    private static func splitLines(_ text: String) -> [String] {
        // `String.components(separatedBy: "\n")` keeps trailing-empty so an
        // input ending in "\n" round-trips cleanly when we re-join with "\n".
        return text.components(separatedBy: "\n")
    }

    private static func locateFence(in lines: [String]) -> Range<Int>? {
        guard let start = lines.firstIndex(of: openFence) else { return nil }
        // Find first close fence at-or-after start. Defensive against
        // truncated files: if no close fence is found, treat everything
        // from the open fence to the end as managed.
        let end = lines[start...].firstIndex(of: closeFence) ?? (lines.count - 1)
        return start..<(end + 1)
    }
}
#endif
