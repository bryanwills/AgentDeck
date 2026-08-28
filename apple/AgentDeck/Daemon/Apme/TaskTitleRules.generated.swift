// GENERATED FILE — DO NOT EDIT.
// Source of truth: shared/src/task-title.ts
// Regenerate: pnpm generate-apme-display-rules (drift gated by shared/src/__tests__/apme-display-rules-sync.test.ts)

import Foundation

/// Derive a task's display title from its first user prompt — the Swift half
/// of the task-naming SSOT. See shared/src/task-title.ts for the full rule
/// rationale (intent title fills the one-line slot until the judge summary
/// exists; the `Task N` fallback stays the display SSOT's "meaningless"
/// shape, so callers keep it on nil and must NOT pass nil through as "").
///
/// Parity is pinned by shared/task-title-vectors.json, replayed by BOTH
/// suites (vitest task-title.test.ts / ApmeTaskBoundaryTests) — a rule change
/// that edits only one implementation goes red on the other. All index math
/// is in CODE POINTS (unicode scalars), never UTF-16 units or grapheme
/// clusters, matching the TS side's `Array.from(line)`.
enum TaskTitleRules {

    /// Max title length in code points — one Work-board row beside its chips.
    static let maxChars = 72

    /// Minimum meaningful length in code points — anything shorter ("ok",
    /// "ㅇㅇ") names nothing, so callers keep the `Task N` fallback.
    static let minChars = 4

    static func deriveTaskTitle(_ firstPrompt: String?) -> String? {
        guard let prompt = firstPrompt?.trimmingCharacters(in: .whitespacesAndNewlines),
              !prompt.isEmpty else { return nil }

        // JS `trim()`/`\s` also strip U+FEFF and \v; CharacterSet's
        // whitespace classes do not, so widen to match — a BOM-prefixed
        // prompt must derive the same title on both daemons.
        let jsWhitespace = CharacterSet.whitespacesAndNewlines
            .union(CharacterSet(charactersIn: "\u{FEFF}\u{000B}\u{000C}"))
        var line = ""
        var sawAnyLine = false
        var inFence = false
        for rawLine in prompt.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }) {
            let candidate = rawLine.trimmingCharacters(in: jsWhitespace)
            if candidate.isEmpty { continue }
            // A fence swallows its whole BODY, not just the marker lines — a
            // paste-code-then-ask prompt must be titled by the ask, never by
            // the first line of the pasted code.
            if candidate.hasPrefix("```") { inFence.toggle(); sawAnyLine = true; continue }
            if inFence { sawAnyLine = true; continue }
            // A prompt STARTING with markup (<task-notification>, a pasted
            // reminder) is machine plumbing — never promote its inner body.
            if !sawAnyLine, candidate.hasPrefix("<") { return nil }
            sawAnyLine = true
            // A slash COMMAND, not a slash PATH: one ASCII-word token after
            // the slash, then whitespace or end-of-line ('/task close', not
            // '/Users/x/cli.ts crashes'). ASCII on purpose — slash commands
            // are ASCII by construction, so '/작업 정리해줘' stays a title.
            if candidate.range(of: "^/[a-zA-Z][a-zA-Z0-9_-]*(\\s|$)", options: .regularExpression) != nil { continue }
            // Markup after a real first line is skipped.
            if candidate.hasPrefix("<") { continue }
            line = candidate
            break
        }
        if line.isEmpty { return nil }

        // Markdown furniture: heading #, list -/*, quote >.
        if let range = line.range(of: "^#{1,6}\\s+", options: .regularExpression) { line.removeSubrange(range) }
        if let range = line.range(of: "^[-*]\\s+", options: .regularExpression) { line.removeSubrange(range) }
        if let range = line.range(of: "^>\\s+", options: .regularExpression) { line.removeSubrange(range) }
        line = line.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)

        let points = Array(line.unicodeScalars)
        if points.count < minChars { return nil }
        if points.count <= maxChars { return line }

        // All index math is in CODE POINTS (unicode scalars) — never
        // Character distance, which counts grapheme clusters and would put
        // the word-boundary threshold in a different place than the TS side.
        let window = Array(points.prefix(maxChars))
        let lastSpace = window.lastIndex(of: " " as Unicode.Scalar)
        let cutLen = (lastSpace != nil && lastSpace! >= maxChars / 2) ? lastSpace! : maxChars
        var cut = String(String.UnicodeScalarView(window.prefix(cutLen)))
        while cut.hasSuffix(" ") { cut.removeLast() }
        return cut + "…"
    }
}
