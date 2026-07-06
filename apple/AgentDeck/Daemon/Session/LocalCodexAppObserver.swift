#if os(macOS)
// LocalCodexAppObserver.swift — passive Codex Desktop detection.
//
// Codex Desktop does not always emit lifecycle hooks before the first turn.
// Treat only kernel processes with durable session metadata as observed
// sessions; the top-level Codex.app process alone is integration presence,
// not an agent session.

import Foundation

enum LocalCodexAppObserver {
    private static let fallbackProjectName = "Codex App"

    static func collect() -> [DaemonSessionEntry] {
        ProcessEnumerator.processSnapshots().compactMap(observedKernelSession)
    }

    private static func observedKernelSession(_ snapshot: ProcessEnumerator.ProcessSnapshot) -> DaemonSessionEntry? {
        let args = snapshot.arguments
        guard args.contains(where: { $0.hasSuffix("/kernel.js") || $0 == "kernel.js" }) else { return nil }
        guard args.contains(where: { $0.contains("Codex.app/Contents/Resources") }) else { return nil }

        let sessionId = ProcessEnumerator.value(after: "--session-id", in: args) ?? String(snapshot.pid)
        let cwd = ProcessEnumerator.value(after: "--working-dir", in: args)
        let projectName = cwd
            .flatMap { ProjectNameResolver.resolve(cwd: $0).nilIfBlank }
            ?? fallbackProjectName

        var entry = DaemonSessionEntry(
            id: "observed:codex-app:\(sessionId)",
            port: 0,
            pid: Int(snapshot.pid),
            projectName: projectName,
            agentType: "codex-app",
            tmuxSession: nil,
            tty: nil,
            parentTty: nil,
            startedAt: ISO8601DateFormatter().string(from: snapshot.startedAt)
        )
        entry.state = "idle"
        return entry
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
#endif
