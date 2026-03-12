// SessionMetrics.swift — Computed display values for usage/session data

import Foundation

enum SessionMetrics {
    /// Format duration as "Xh Ym" or "Ym Zs"
    static func formatUptime(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h)h \(m)m" }
        if m > 0 { return "\(m)m \(s)s" }
        return "\(s)s"
    }

    /// Format token/cost counts
    static func formatCount(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
        return "\(n)"
    }

    /// Unicode block gauge: █░ pattern
    static func gaugeBar(percent: Double, width: Int = 10) -> String {
        let filled = Int((percent / 100.0) * Double(width))
        let empty = width - filled
        return String(repeating: "█", count: max(0, filled)) +
               String(repeating: "░", count: max(0, empty))
    }

    /// Format reset time from ISO string
    static func formatResetTime(_ isoString: String?) -> String? {
        guard let isoString else { return nil }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let date = formatter.date(from: isoString) else {
            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: isoString) else { return nil }
            return formatRelativeTime(date)
        }
        return formatRelativeTime(date)
    }

    private static func formatRelativeTime(_ date: Date) -> String {
        let diff = date.timeIntervalSinceNow
        if diff <= 0 { return "now" }

        let minutes = Int(diff / 60)
        let hours = minutes / 60
        let days = hours / 24

        if days > 0 { return "\(days)d" }
        if hours > 0 { return "\(hours)h" }
        return "\(minutes)m"
    }
}
