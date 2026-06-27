#if os(macOS)
// TrmnlSettings.swift — TRMNL BYOS config + shared value types for the Swift daemon.
//
// Mirrors bridge/src/trmnl/trmnl-settings.ts. The App Store daemon reads the
// `trmnl` block from settings.json for the enable gate / cadence / auto-register
// policy and enrolled devices. Telemetry is runtime-only; device enrollment is
// persisted so the App Store app can be a complete standalone BYOS hub.

import Foundation

/// Static config read from settings.json `trmnl` block.
struct TrmnlConfig: Sendable {
    var enabled: Bool = false
    /// Idle/working cadence (seconds) — slow + battery-friendly.
    var refreshRate: Int = 180
    /// Cadence (seconds) while a session is AWAITING the user.
    var refreshActive: Int = 60
    /// Image-download timeout (seconds) handed to the firmware as image_url_timeout.
    /// Generous default: most "not responding" cycles are a lossy image GET timing
    /// out, not a server error. Mirrors TRMNL_DEFAULT_IMAGE_TIMEOUT.
    var imageUrlTimeout: Int = 50
    var autoRegister: Bool = true
    var devices: [TrmnlDeviceConfig] = []

    /// Too-frequent polls drain the panel battery + full-flash the e-ink.
    static let minRefresh = 30
    /// Hard cap the firmware honors for image_url_timeout (~65s internally).
    static let maxImageTimeout = 65
    /// RSSI (dBm) at/below which the WiFi link is treated as weak/lossy — the
    /// dominant cause of "not responding" (WIFI_FAILED). Sent per poll by firmware.
    static let weakRssiDbm = -78.0
    /// Image-download window served on a weak link — near the firmware cap.
    static let weakLinkImageTimeout = 60

    /// Cadence for a poll: only AWAITING speeds it up (a deep-sleep e-ink panel
    /// can't be pushed and each wake flashes the screen). Mirrors trmnl-settings.ts.
    func effectiveRefresh(awaiting: Int, working: Int) -> Int {
        max(TrmnlConfig.minRefresh, awaiting > 0 ? refreshActive : refreshRate)
    }

    /// Image-download timeout (seconds) for a poll. Widens toward the firmware cap
    /// when the panel reports a weak WiFi signal so a lossy image GET still finishes
    /// before "not responding" (WIFI_FAILED); a strong link keeps the lower default
    /// so a dead link doesn't hold the radio on (battery). Mirrors trmnl-settings.ts.
    func effectiveImageTimeout(rssi: Double?) -> Int {
        var t = imageUrlTimeout
        if let r = rssi, r.isFinite, r <= TrmnlConfig.weakRssiDbm {
            t = max(t, TrmnlConfig.weakLinkImageTimeout)
        }
        return min(TrmnlConfig.maxImageTimeout, max(5, t))
    }
}

struct TrmnlDeviceConfig: Sendable, Equatable {
    var mac: String
    var apiKey: String
    var friendlyId: String
    var name: String?
}

/// One live session row, parsed from a `sessions_list` broadcast.
struct TrmnlSession: Sendable {
    let agentType: String
    let projectName: String
    let modelName: String
    let state: String
    /// "What is it doing" inputs for the description line.
    var currentTool: String = ""
    var currentTask: String = ""
    /// Daemon-synthesized activity one-liner (shared with the XTeink X3). Preferred
    /// over the locally-derived currentTool/goal when present.
    var activity: String = ""
    /// One-line gist of the session's purpose (first user prompt).
    var goal: String = ""
    var elapsedSec: Int = 0
}

/// One subscription/plan with optional expiry (Claude / ChatGPT).
struct TrmnlSubscription: Sendable {
    let name: String
    let until: String?
}

/// The renderable dashboard state (mirrors the fields trmnl-layout.ts consumes).
struct TrmnlDashState: Sendable {
    var sessions: [TrmnlSession] = []
    var fiveHourPercent: Double = 0
    var sevenDayPercent: Double = 0
    var totalTokens: Int = 0
    var totalCost: Double = 0
    /// True only when subscription quota is actually known, so the renderer shows
    /// "—" instead of a confident 0% when the hub is OAuth-blind / has no relay.
    var usageKnown: Bool = false
    /// ISO timestamps when each quota window resets (for a countdown). nil ⇒ hidden.
    var fiveHourResetsAt: String?
    var sevenDayResetsAt: String?
    /// Active subscriptions (Claude / ChatGPT plan) with optional expiry.
    var subscriptions: [TrmnlSubscription] = []
    /// "HH:MM" stamp baked at render time (the device pulls; this is render-time).
    var nowText: String = ""
}

/// BYOS telemetry headers a panel sends on /api/setup + /api/display.
struct TrmnlHeaders: Sendable {
    let mac: String
    let accessToken: String
    let fwVersion: String
    let batteryVoltage: Double?
    let rssi: Double?
    let refreshRate: Int?
    /// Sanitized panel size (nil ⇒ caller defaults to 800×480).
    let width: Int?
    let height: Int?
    let userAgent: String
}

enum TrmnlSettings {
    static var settingsPath: String {
        if let override = ProcessInfo.processInfo.environment["AGENTDECK_DATA_DIR"] {
            return (override as NSString).appendingPathComponent("settings.json")
        }
        return AgentDeckPaths.settingsJson.path
    }

    /// Load the trmnl config with defaults. Returns defaults on any failure.
    static func load() -> TrmnlConfig {
        var cfg = TrmnlConfig()
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: settingsPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = json["trmnl"] as? [String: Any]
        else { return cfg }
        if let e = t["enabled"] as? Bool { cfg.enabled = e }
        if let r = t["refreshRate"] as? Int, r >= 5 { cfg.refreshRate = r }
        else if let r = t["refreshRate"] as? Double, r >= 5 { cfg.refreshRate = Int(r) }
        if let r = t["refreshActive"] as? Int, r >= 5 { cfg.refreshActive = r }
        else if let r = t["refreshActive"] as? Double, r >= 5 { cfg.refreshActive = Int(r) }
        if let v = t["imageUrlTimeout"] as? Int, v > 0 { cfg.imageUrlTimeout = min(TrmnlConfig.maxImageTimeout, v) }
        else if let v = t["imageUrlTimeout"] as? Double, v > 0 { cfg.imageUrlTimeout = min(TrmnlConfig.maxImageTimeout, Int(v)) }
        if let a = t["autoRegister"] as? Bool { cfg.autoRegister = a }
        if let arr = t["devices"] as? [[String: Any]] {
            cfg.devices = arr.compactMap { raw in
                guard let mac = raw["mac"] as? String, !mac.isEmpty else { return nil }
                let norm = normalizeMac(mac)
                let apiKey = (raw["apiKey"] as? String) ?? (raw["api_key"] as? String) ?? ""
                let friendlyId = (raw["friendlyId"] as? String) ?? (raw["friendly_id"] as? String) ?? ""
                guard !norm.isEmpty, !apiKey.isEmpty, !friendlyId.isEmpty else { return nil }
                return TrmnlDeviceConfig(
                    mac: norm,
                    apiKey: apiKey,
                    friendlyId: friendlyId,
                    name: raw["name"] as? String
                )
            }
        }
        return cfg
    }

    /// Persist only the enrolled device list inside `settings.json`, preserving
    /// unrelated settings and the user's TRMNL cadence flags. Telemetry is not
    /// written here; polls would otherwise churn the file every few minutes.
    static func saveDevices(_ devices: [TrmnlDeviceConfig]) {
        let url = URL(fileURLWithPath: settingsPath)
        var root: [String: Any] = [:]
        if let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = json
        }
        var trmnl = (root["trmnl"] as? [String: Any]) ?? [:]
        trmnl["devices"] = devices.map { d in
            var row: [String: Any] = [
                "mac": d.mac,
                "apiKey": d.apiKey,
                "friendlyId": d.friendlyId,
            ]
            if let name = d.name, !name.isEmpty { row["name"] = name }
            return row
        }
        root["trmnl"] = trmnl

        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
            var out = data
            out.append(0x0A)
            try out.write(to: url, options: [.atomic])
        } catch {
            DaemonLogger.shared.debug("TRMNL", "Failed to persist enrolled devices: \(error.localizedDescription)")
        }
    }

    /// Canonical MAC identity (mirrors trmnl-settings.ts normalizeMac): 12-hex →
    /// uppercase colon pairs; any other id → its bare uppercase hex digits so
    /// varied punctuation collapses to one key.
    static func normalizeMac(_ mac: String) -> String {
        let hex = String(mac.uppercased().filter { $0.isHexDigit })
        if hex.count == 12 {
            var pairs: [String] = []
            var idx = hex.startIndex
            while idx < hex.endIndex {
                let next = hex.index(idx, offsetBy: 2)
                pairs.append(String(hex[idx..<next]))
                idx = next
            }
            return pairs.joined(separator: ":")
        }
        return hex.isEmpty ? mac.trimmingCharacters(in: .whitespaces).uppercased() : hex
    }
}
#endif
