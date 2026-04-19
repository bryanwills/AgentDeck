#if os(macOS)
// SessionLauncher.swift — Inform users how to start agent sessions.
//
// The App Store build never creates shell scripts, never opens Terminal, and
// never spawns a CLI binary. Live Claude Code sessions appear automatically
// once hooks are enabled in Settings; Codex / OpenCode are CLI-only and out
// of scope for this app. This file is an NSAlert facade only.

import Foundation
import AppKit

// MARK: - Agent Type

enum LaunchAgentType: String, CaseIterable {
    case claudeCode = "claude-code"
    case codex
    case opencode
    case claudePlain = "claude"

    var displayName: String {
        switch self {
        case .claudeCode: return "Claude"
        case .codex: return "Codex"
        case .opencode: return "OpenCode"
        case .claudePlain: return "Plain"
        }
    }
}

enum SessionLauncher {
    @MainActor
    static func launchSession(project: String? = nil) {
        launchSession(project: project, agent: .claudeCode)
    }

    @MainActor
    static func launchSession(project: String?, agent: LaunchAgentType) {
        _ = project
        showAppStoreLaunchInfo(agent: agent)
    }

    @MainActor
    private static func showAppStoreLaunchInfo(agent: LaunchAgentType) {
        let alert = NSAlert()
        switch agent {
        case .claudeCode, .claudePlain:
            alert.messageText = "Start Claude Code in Your Own Workspace"
            alert.informativeText = """
            AgentDeck does not create shell scripts or launch command-line tools.

            After hooks are enabled in AgentDeck Settings, live Claude Code sessions appear here automatically.
            """
        case .codex, .opencode:
            alert.messageText = "\(agent.displayName) launch is unavailable"
            alert.informativeText = """
            AgentDeck does not launch PTY-backed command-line sessions.

            Claude Code monitoring still works through the approved hook pipeline.
            """
        }
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
#endif
