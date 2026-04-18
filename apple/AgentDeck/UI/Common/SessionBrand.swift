// SessionBrand.swift — Shared brand palette + creature-icon renderer
//
// Previously lived inside `ControlTowerPanel.swift` (macOS-only), which meant
// the iOS dashboard couldn't use the same visual language. Moved to a shared
// file so both the menubar popup and the cross-platform MonitorScreen HUD
// render agents with the same colors and the same creature assets.
//
// Keep the palette in sync with:
//   * `D200hHidModule.agentBrandColor`
//   * `bridge/src/modules/…` agent color maps
//   * `AgentStatusIcon`'s NSColor mirror (menubar rendering path)

import SwiftUI

/// Canonical per-agent brand colors. Creature SVG assets are authored as
/// `currentColor` silhouettes, so the tint applied here is what the user
/// actually sees.
enum SessionBrand {
    static func color(for agentType: String?) -> Color {
        switch agentType {
        case "claude-code": return Color(red: 0.753, green: 0.439, blue: 0.345) // #C07058
        case "codex-cli":   return Color(red: 0.38,  green: 0.40,  blue: 0.88)  // indigo
        case "openclaw":    return Color(red: 1.0,   green: 0.30,  blue: 0.30)  // #FF4D4D
        case "opencode":    return Color(red: 0.945, green: 0.925, blue: 0.925) // near-white
        case "daemon":      return Color(red: 0.55,  green: 0.55,  blue: 0.60)
        default:            return Color.secondary
        }
    }
}

/// Renders an agent's branded creature from the app's asset catalog in its
/// brand color. Falls back to a generic SF Symbol when the agent type is
/// unknown so the layout never collapses on new agents.
struct SessionCreatureIcon: View {
    let agentType: String?
    let tint: Color
    let size: CGFloat

    var body: some View {
        Group {
            if let asset = Self.assetName(for: agentType) {
                Image(asset)
                    .resizable()
                    .renderingMode(.template)
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
            } else {
                Image(systemName: "questionmark.circle")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(tint)
        .accessibilityLabel(Self.accessibilityLabel(for: agentType))
    }

    private static func assetName(for type: String?) -> String? {
        switch type {
        case "claude-code": return "CreatureClaudeCode"
        case "openclaw":    return "CreatureOpenClaw"
        case "codex-cli":   return "CreatureCodex"
        case "opencode":    return "CreatureOpenCode"
        default:            return nil
        }
    }

    private static func accessibilityLabel(for type: String?) -> String {
        switch type {
        case "claude-code": return "Claude Code session"
        case "openclaw":    return "OpenClaw session"
        case "codex-cli":   return "Codex session"
        case "opencode":    return "OpenCode session"
        case "daemon":      return "Daemon"
        default:            return "Unknown agent session"
        }
    }
}
