#if os(macOS)
// BridgeLogStream.swift — OpenClaw log line parser.
//
// The original CLI build spawned `openclaw logs --follow --json` to tail
// timeline events. The App Store build sources the same events through
// OpenClawAdapter's Gateway RPC subscription, so this file only retains the
// pure parsing helper used by that path. The actor lifecycle methods are
// kept as no-ops so DaemonServer's existing wiring stays intact.

import Foundation

actor BridgeLogStream {
    var onEntry: ((DaemonTimelineEntry) -> Void)?

    var isRunning: Bool { false }

    func start() {}
    func stop() {}
    func trackToolRequest(_ raw: String) { _ = raw }

    static func parseLogLine(_ json: Any) -> DaemonTimelineEntry? {
        guard let obj = json as? [String: Any] else { return nil }

        let type = obj["type"] as? String
        let message = obj["message"] as? String ?? obj["raw"] as? String ?? ""
        let level = obj["level"] as? String

        guard !message.isEmpty, message.count >= 5 else { return nil }

        let subsystem = obj["subsystem"] as? String ?? ""
        let module = obj["module"] as? String ?? ""
        if ["gateway", "websocket", "connection", "heartbeat"].contains(where: { subsystem.localizedCaseInsensitiveContains($0) || module.localizedCaseInsensitiveContains($0) }) {
            return nil
        }

        let entryType: String
        if let type, (type == "model_call" || type == "model_response") { entryType = type }
        else if type == "tool_exec" { entryType = "tool_exec" }
        else if type == "memory_recall" { entryType = "memory_recall" }
        else if level == "error" { entryType = "error" }
        else { return nil }

        return DaemonTimelineEntry(
            ts: Date().timeIntervalSince1970 * 1000,
            type: entryType,
            raw: String(message.prefix(200))
        )
    }
}
#endif
