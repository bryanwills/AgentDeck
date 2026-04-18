// SessionFormatters.swift — central session text helpers
//
// Three near-identical implementations of these helpers had been copied
// into `ControlTowerPanel`, `SessionJumpRow`, and `AttentionTheaterView`.
// The bodies drifted slightly each time a new agent type was added; this
// file makes it a single source of truth.

import Foundation

/// Human-readable label for an agent type id.
///
/// Matches the branding copy used throughout the UI. Must not abbreviate
/// "OpenClaw" (see memory `brand-direction.md`).
func displayAgentLabel(_ type: String?) -> String {
    switch type {
    case "claude-code": return "Claude"
    case "openclaw":    return "OpenClaw"
    case "codex-cli":   return "Codex"
    case "opencode":    return "OpenCode"
    case "daemon":      return "Daemon"
    case .some(let t):  return t.replacingOccurrences(of: "-", with: " ").capitalized
    case nil:           return "Agent"
    }
}

/// Shorten a model id to a compact user-facing name.
/// e.g., "claude-opus-4-6-20261001" → "opus-4-6", "gpt-4.1" → "4.1".
func displayShortModelName(_ name: String) -> String {
    var s = name
    for prefix in ["claude-", "gpt-", "o1-", "o3-"] {
        if s.hasPrefix(prefix) { s = String(s.dropFirst(prefix.count)) }
    }
    if let range = s.range(of: #"-\d{8}$"#, options: .regularExpression) {
        s = String(s[s.startIndex..<range.lowerBound])
    }
    return s
}

/// Convert an ISO 8601 timestamp into a compact relative-time string
/// suitable for inline badges ("<1m", "12m", "3h", "2d").
func displayRelativeTime(_ iso: String?) -> String? {
    guard let iso, !iso.isEmpty else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = fractional.date(from: iso)
            ?? ISO8601DateFormatter().date(from: iso) else { return nil }
    let seconds = Int(Date().timeIntervalSince(date))
    if seconds < 60 { return "<1m" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    return "\(hours / 24)d"
}
