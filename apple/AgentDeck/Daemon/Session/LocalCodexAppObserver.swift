#if os(macOS)
// LocalCodexAppObserver.swift — passive Codex Desktop detection.
//
// Codex Desktop does not always emit lifecycle hooks or OTel before the
// first turn. The App Store daemon still needs to show that a distinct
// Codex App session exists, without spawning `ps` or any helper process.
// This uses macOS process metadata directly (ProcessEnumerator's sysctl
// helpers) and only creates observed, read-only session rows.

import AppKit
import Foundation

enum LocalCodexAppObserver {
    private static let codexAppBundleIdentifier = "com.openai.codex"
    private static let fallbackProjectName = "Codex App"

    static func collect() -> [DaemonSessionEntry] {
        let kernels = ProcessEnumerator.processSnapshots().compactMap(observedKernelSession)
        if !kernels.isEmpty { return kernels }

        return NSRunningApplication
            .runningApplications(withBundleIdentifier: codexAppBundleIdentifier)
            .filter { !$0.isTerminated }
            .map { app in
                var entry = DaemonSessionEntry(
                    id: "observed:codex-app:\(app.processIdentifier)",
                    port: 0,
                    pid: Int(app.processIdentifier),
                    projectName: fallbackProjectName,
                    agentType: "codex-app",
                    tmuxSession: nil,
                    tty: nil,
                    parentTty: nil,
                    startedAt: app.launchDate.map { ISO8601DateFormatter().string(from: $0) }
                )
                entry.state = "idle"
                return entry
            }
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
