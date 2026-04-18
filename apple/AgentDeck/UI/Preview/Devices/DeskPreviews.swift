// DeskPreviews.swift — Stream Deck+ session button and Ulanzi D200H mockups.
//
// The Stream Deck+ preview reuses the production SessionSlotRenderer so this
// is the highest-fidelity mockup in the catalog. The D200H previews are
// pragmatic mockups — the real firmware renders via HID frames and does not
// have a Swift-side view-layer port. We frame the key with a chunky bezel and
// show the creature + state HUD.

import SwiftUI

// MARK: - Stream Deck Key

/// Single 72×72 Stream Deck key.
struct StreamDeckKeyPreview: View {
    let selection: DevicePreviewSelection

    private var session: SessionInfo {
        SessionInfo(
            id: "preview-sd-key",
            port: 9120,
            projectName: selection.agent.displayName,
            agentType: selection.agent.rawValue,
            alive: true,
            state: selection.state.sessionStateStringForUI,
            modelName: modelName,
            startedAt: nil
        )
    }

    private var modelName: String {
        switch selection.agent {
        case .claudeCode: return "opus-4-7"
        case .codex:      return "gpt-5"
        case .opencode:   return "router"
        case .openclaw:   return "router"
        }
    }

    var body: some View {
        VStack(spacing: 14) {
            SessionSlotView(session: session, animFrame: selection.animationFrame)
                .scaleEffect(0.5)
                .frame(width: 72, height: 72)
                .shadow(color: .black.opacity(0.4), radius: 6, y: 3)
            Text("Stream Deck • 72×72")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Stream Deck+

/// Single 144×144 Stream Deck+ key driven by the real SessionSlotView.
struct StreamDeckPlusPreview: View {
    let selection: DevicePreviewSelection

    private var session: SessionInfo {
        SessionInfo(
            id: "preview-sd",
            port: 9120,
            projectName: selection.agent.displayName,
            agentType: selection.agent.rawValue,
            alive: true,
            state: selection.state.sessionStateStringForUI,
            modelName: modelName,
            startedAt: nil
        )
    }

    private var modelName: String {
        switch selection.agent {
        case .claudeCode: return "opus-4-7"
        case .codex:      return "gpt-5"
        case .opencode:   return "router"
        case .openclaw:   return "router"
        }
    }

    var body: some View {
        VStack(spacing: 14) {
            SessionSlotView(session: session, animFrame: selection.animationFrame)
                .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
            Text("Stream Deck+ • 144×144")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - D200H Key

/// One of the 14 D200H HID keys, 120×120 logical. Compact HUD + creature.
struct D200HKeyPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 12, bezelWidth: 6) {
                VStack(spacing: 4) {
                    PreviewHUD(
                        agent: selection.agent,
                        state: selection.state,
                        sessionCount: selection.sessionCount,
                        compact: true
                    )
                    PreviewCreature(agent: selection.agent, state: selection.state, size: 58)
                    Text(projectLabel)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                }
            }
            .frame(width: 140, height: 140)
            Text("D200H key • 120×120")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private var projectLabel: String {
        selection.agent.displayName.prefix(10).uppercased()
    }
}

// MARK: - D200H Full Deck

/// Schematic of the full 14-key D200H deck: a top strip (4 keys + encoders)
/// plus a 3×4 grid below. Selected agent sits in the focus slot; remaining
/// slots show the other agents faded.
struct D200HDeckPreview: View {
    let selection: DevicePreviewSelection

    private let fillerAgents: [PixooPreviewAgent] = [.claudeCode, .codex, .opencode, .openclaw]

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 22, bezelWidth: 16) {
                VStack(spacing: 6) {
                    // Top strip — 4 keys + 2 encoders
                    HStack(spacing: 6) {
                        ForEach(0..<4, id: \.self) { i in
                            PreviewSessionTile(
                                agent: fillerAgents[i],
                                state: i == 0 ? selection.state : .idle,
                                size: 44
                            )
                            .opacity(i == 0 ? 1 : 0.5)
                        }
                        Spacer()
                        Circle().fill(Color(white: 0.18)).frame(width: 34, height: 34)
                        Circle().fill(Color(white: 0.18)).frame(width: 34, height: 34)
                    }
                    // 3×4 grid (simplified to 3×3 plus one highlight)
                    VStack(spacing: 6) {
                        ForEach(0..<3, id: \.self) { row in
                            HStack(spacing: 6) {
                                ForEach(0..<4, id: \.self) { col in
                                    let idx = row * 4 + col
                                    let isFocus = (row == 0 && col == 0)
                                    PreviewSessionTile(
                                        agent: isFocus ? selection.agent : fillerAgents[idx % fillerAgents.count],
                                        state: isFocus ? selection.state : .idle,
                                        size: 44
                                    )
                                    .opacity(isFocus ? 1 : 0.35)
                                }
                            }
                        }
                    }
                }
            }
            .frame(width: 340, height: 260)
            Text("Ulanzi D200H • 14 keys + 2 encoders")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
