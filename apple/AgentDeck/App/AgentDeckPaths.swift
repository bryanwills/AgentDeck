// AgentDeckPaths.swift — Central source of truth for AgentDeck data paths.
//
// App Store blocker #7: The `~/.agentdeck/` directory lived behind the
// `com.apple.security.temporary-exception.files.home-relative-path.read-write`
// entitlement, which App Review rejects. App Sandbox requires data to live
// inside the app's own container or a declared Group Container. We use a
// Group Container so the macOS Dashboard app and any future App Store-friendly
// helper can share a single store, and so data survives app reinstalls.
//
// Runtime behavior:
//   - When the app is signed with the `com.apple.security.application-groups`
//     entitlement listing `appGroupID`, `containerURL(forSecurityApplicationGroupIdentifier:)`
//     returns `~/Library/Group Containers/<team>.<group>/`.
//   - When running without that entitlement (unsigned dev builds, `xcodebuild`
//     smoke tests, xctest), `containerURL` returns nil. We fall back to the
//     legacy `~/.agentdeck/` path so nothing breaks during local development.
//   - The fallback uses `NSHomeDirectory()` (inside sandbox it's the container
//     home; outside sandbox it's the real home) — both work for unsigned runs.
//
// Migration: Users who were on a pre-Group-Container build have data in
// `~/.agentdeck/`. On first launch after upgrading, `migrateLegacyDataIfNeeded()`
// copies those files into the Group Container *while the legacy entitlement
// exception is still present*. A future App Store release removes that
// exception entirely and the migration stops finding the source directory —
// by then the copy is already done.

import Foundation

enum AgentDeckPaths {
    /// App Group identifier. Must match the value in
    /// `apple/AgentDeck/Resources/AgentDeck.entitlements` →
    /// `com.apple.security.application-groups`. Mac App Store signing injects
    /// the team prefix at archive time, so we reference the suffix here and
    /// the runtime API resolves the full path.
    static let appGroupID = "group.bound.serendipity.agentdeck.dashboard"

    /// Root directory for all AgentDeck persistent state. Prefers the App
    /// Group container when the entitlement is active; falls back to the
    /// legacy `~/.agentdeck/` layout when it isn't (unsigned dev builds /
    /// xctest / command-line `xcodebuild`).
    static let baseDirectory: URL = {
        let fm = FileManager.default
        if let container = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) {
            try? fm.createDirectory(at: container, withIntermediateDirectories: true)
            return container
        }
        // Fallback: NSHomeDirectory() is the container root inside the sandbox
        // and the real home otherwise — both are writable paths where the
        // app can put state.
        let fallback = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".agentdeck", isDirectory: true)
        try? fm.createDirectory(at: fallback, withIntermediateDirectories: true)
        return fallback
    }()

    /// Legacy location (`~/.agentdeck/` in the user's REAL home, reached via
    /// `getpwuid` to bypass the sandbox container redirect). Used only by
    /// `migrateLegacyDataIfNeeded()`; all normal reads/writes go through
    /// `baseDirectory`.
    static let legacyRealHomeDirectory: URL? = {
        guard let pw = getpwuid(getuid()), let ptr = pw.pointee.pw_dir else { return nil }
        let home = String(cString: ptr)
        return URL(fileURLWithPath: home).appendingPathComponent(".agentdeck", isDirectory: true)
    }()

    // MARK: - Convenience file URLs

    static var daemonJson: URL { baseDirectory.appendingPathComponent("daemon.json") }
    static var daemonCrashLog: URL { baseDirectory.appendingPathComponent("daemon-crash.log") }
    static var authToken: URL { baseDirectory.appendingPathComponent("auth-token") }
    static var sessionsJson: URL { baseDirectory.appendingPathComponent("sessions.json") }
    static var settingsJson: URL { baseDirectory.appendingPathComponent("settings.json") }
    static var timelineJson: URL { baseDirectory.appendingPathComponent("timeline.json") }
    static var apmeSqlite: URL { baseDirectory.appendingPathComponent("apme.sqlite") }
    static var compatibilityJson: URL { baseDirectory.appendingPathComponent("compatibility.json") }
    static var swiftDaemonLog: URL { baseDirectory.appendingPathComponent("swift-daemon.log") }

    /// Path suitable for building shell commands that run OUTSIDE the app
    /// process (hook installer commands the CLI writes into Claude Code's
    /// settings). Returns a POSIX path string.
    static var daemonJsonShellPath: String { daemonJson.path }

    // MARK: - Migration

    /// Copy any files present in `~/.agentdeck/` (real-home) into the App
    /// Group container. Skips files that already exist in the destination so
    /// we never overwrite newer data. Silent by design — per-file errors are
    /// logged via NSLog but never thrown; migration is best-effort.
    ///
    /// Idempotent: if the destination already has `daemon.json` and the source
    /// has nothing newer, this is a no-op. If the legacy directory is absent
    /// (fresh install, or a later build that dropped the home-relative-path
    /// entitlement so the source is unreadable), returns immediately.
    @discardableResult
    static func migrateLegacyDataIfNeeded() -> Int {
        guard let legacy = legacyRealHomeDirectory else { return 0 }
        let fm = FileManager.default
        guard fm.fileExists(atPath: legacy.path) else { return 0 }

        // If source == destination (fallback mode before Group Container is
        // active), nothing to do. We canonicalize by resolving symlinks and
        // comparing standardized paths.
        let legacyStd = legacy.standardizedFileURL.resolvingSymlinksInPath().path
        let baseStd = baseDirectory.standardizedFileURL.resolvingSymlinksInPath().path
        if legacyStd == baseStd { return 0 }

        var copied = 0
        do {
            let items = try fm.contentsOfDirectory(at: legacy, includingPropertiesForKeys: nil)
            for src in items {
                let dst = baseDirectory.appendingPathComponent(src.lastPathComponent)
                if fm.fileExists(atPath: dst.path) { continue }
                do {
                    try fm.copyItem(at: src, to: dst)
                    copied += 1
                } catch {
                    NSLog("[AgentDeckPaths] Migration copy failed for \(src.lastPathComponent): \(error.localizedDescription)")
                }
            }
        } catch {
            NSLog("[AgentDeckPaths] Migration listing failed: \(error.localizedDescription)")
        }
        if copied > 0 {
            NSLog("[AgentDeckPaths] Migrated \(copied) file(s) from \(legacy.path) → \(baseDirectory.path)")
        }
        return copied
    }
}

/// Runtime feature gates that depend on the process's execution environment.
///
/// Single source of truth for "am I running inside App Sandbox?" so
/// sandbox-gated features (subprocess spawn, arbitrary file I/O outside the
/// container, etc.) all agree. macOS sets `APP_SANDBOX_CONTAINER_ID` in the
/// environment of any sandboxed process — this is the standard detection
/// mechanism.
///
/// Fallback: on non-macOS platforms we always return `false`. On macOS unit
/// tests the variable is unset (xctest runs outside the sandbox even for
/// sandboxed targets), which matches the behavior we want — tests can
/// exercise the deterministic path without a special override.
enum AgentDeckRuntime {
    /// True when the current process is running inside macOS App Sandbox.
    /// Phase 0 (App Store MVP) uses this to graceful-disable APME Layer 1
    /// deterministic checks, which need subprocess spawn (git/pnpm/xcodebuild)
    /// that the sandbox denies.
    static var isSandboxed: Bool {
        #if os(macOS)
        return ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
        #else
        return false
        #endif
    }
}
