// SessionGrouping.swift — Project-prefix session grouping.
//
// Swift mirror of `shared/src/session-utils.ts` (`normalizeProjectForGrouping`
// / `projectGroupKey` / `groupSessionsByProject`), itself a port of the IPS10
// terrarium huddle builder (esp32/src/ui/terrarium/office.cpp `normProject` /
// `sameProjectGroup`). Kotlin mirror: android `dev.agentdeck.util.SessionGrouping`.
// Keep all three in lockstep.
//
// Sessions whose project names share a long delimiter-aligned prefix
// (worktree/task folders like `xteink-x3-x4-japanese-broken-claude-glm` /
// `…-broken-codex`) cluster into one work group; short siblings like
// `agentdeck-ios` / `agentdeck-android` stay separate.

import Foundation

enum SessionGrouping {
    private static func isDelim(_ c: Character) -> Bool {
        c == "-" || c == "_" || c == " " || c == "."
    }

    private static func trimTail(_ s: String) -> String {
        let chars = Array(s)
        var n = chars.count
        while n > 0 && (isDelim(chars[n - 1]) || chars[n - 1] == "#") { n -= 1 }
        return String(chars[0..<n])
    }

    private static func delimCount(_ s: [Character], upTo len: Int) -> Int {
        var count = 0
        for i in 0..<min(len, s.count) where isDelim(s[i]) { count += 1 }
        return count
    }

    /// Basename + strip trailing " #N" duplicate suffix.
    static func normalizeProject(_ project: String?) -> String {
        let raw = (project ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let base = raw.split(separator: "/").last.map(String.init) ?? raw
        if let range = base.range(of: #"\s*#\d+$"#, options: .regularExpression) {
            return trimTail(String(base[..<range.lowerBound]))
        }
        return trimTail(base)
    }

    /// Shared group key (common stem) when `a` and `b` belong to the same work
    /// group, else nil. Conservative: stem >= 14 chars with >= 2 delimiters on
    /// both sides, or an exact case-insensitive match.
    static func groupKey(_ a: String, _ b: String) -> String? {
        let ca = Array(a), cb = Array(b)
        var i = 0
        var lastDelim = -1
        let n = min(ca.count, cb.count)
        while i < n, String(ca[i]).lowercased() == String(cb[i]).lowercased() {
            if isDelim(ca[i]) { lastDelim = i }
            i += 1
        }
        if i == ca.count && i == cb.count { return a }

        var stemLen = -1
        if i == ca.count && i < cb.count && isDelim(cb[i]) { stemLen = i }
        else if i == cb.count && i < ca.count && isDelim(ca[i]) { stemLen = i }
        else if lastDelim > 0 { stemLen = lastDelim }

        if stemLen < 14 || delimCount(ca, upTo: stemLen) < 2 || delimCount(cb, upTo: stemLen) < 2 {
            return nil
        }
        let key = trimTail(String(ca[0..<stemLen]))
        return key.isEmpty ? nil : key
    }

    struct Group<T> {
        /// Group label — shared stem, or the normalized project name for singletons.
        let key: String
        /// True when >= 2 members fused (render a group header); singletons render flat.
        let grouped: Bool
        let members: [T]
    }

    /// Cluster an ordered list into project groups, preserving input order.
    static func group<T>(_ items: [T], projectOf: (T) -> String?) -> [Group<T>] {
        var groups: [Group<T>] = []
        var done = [Bool](repeating: false, count: items.count)
        for a in items.indices where !done[a] {
            let na = normalizeProject(projectOf(items[a]))
            var key = na
            var members = [items[a]]
            done[a] = true
            for b in (a + 1)..<items.count where !done[b] {
                let nb = normalizeProject(projectOf(items[b]))
                if let nextKey = groupKey(key, nb) ?? groupKey(na, nb) {
                    key = nextKey
                    members.append(items[b])
                    done[b] = true
                }
            }
            groups.append(Group(key: key, grouped: members.count > 1, members: members))
        }
        return groups
    }
}
