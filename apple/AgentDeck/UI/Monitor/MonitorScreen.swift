// MonitorScreen.swift — Dashboard: terrarium background + HUD overlay
// Phase 3 full implementation, Phase 1 placeholder

import SwiftUI

struct MonitorScreen: View {
    @Environment(AgentStateHolder.self) private var stateHolder

    var body: some View {
        ZStack {
            // Background
            Color(red: 0.06, green: 0.09, blue: 0.16) // #0f172a
                .ignoresSafeArea()

            // TODO: Phase 2 — TerrariumView here
            // TODO: Phase 3 — HUD overlay panels

            if stateHolder.connection.status == .disconnected && !stateHolder.state.bridgeConnected {
                ConnectionOverlay()
            } else {
                VStack(spacing: 16) {
                    // Status header
                    statusHeader

                    // Tool info (when processing)
                    if stateHolder.state.state == .processing,
                       let tool = stateHolder.state.currentTool {
                        toolInfo(tool)
                    }

                    // Options (when awaiting)
                    if stateHolder.state.state.isAwaiting {
                        optionsList
                    }

                    Spacer()

                    // Usage footer
                    usageFooter
                }
                .padding()
            }
        }
    }

    // MARK: - Status Header

    private var statusHeader: some View {
        VStack(spacing: 8) {
            HStack {
                Text(stateHolder.state.projectName ?? "AgentDeck")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Spacer()
                StatusBadge(state: stateHolder.state.state)
            }

            HStack {
                if let model = stateHolder.state.modelName {
                    Text(model)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let effort = stateHolder.state.effortLevel, effort != "medium" {
                    Text("(\(effort))")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Spacer()
                Text(stateHolder.state.permissionMode.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Tool Info

    private func toolInfo(_ tool: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(tool)
                .font(.headline)
                .foregroundStyle(.cyan)
            if let input = stateHolder.state.toolInput {
                Text(input)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Options List

    private var optionsList: some View {
        VStack(spacing: 8) {
            if let question = stateHolder.state.question {
                Text(question)
                    .font(.subheadline)
                    .foregroundStyle(.white)
            }

            ForEach(stateHolder.state.options) { option in
                Button {
                    stateHolder.sendCommand(.selectOption(index: option.index))
                } label: {
                    HStack {
                        Text(option.label)
                            .foregroundStyle(.white)
                        Spacer()
                        if option.recommended == true {
                            Image(systemName: "star.fill")
                                .foregroundStyle(.yellow)
                                .font(.caption)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        option.selected == true
                            ? Color.blue.opacity(0.3)
                            : Color.white.opacity(0.1),
                        in: RoundedRectangle(cornerRadius: 6)
                    )
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Usage Footer

    private var usageFooter: some View {
        HStack(spacing: 16) {
            if let pct = stateHolder.state.fiveHourPercent {
                GaugeBar(label: "5h", percent: pct)
            }
            if let pct = stateHolder.state.sevenDayPercent {
                GaugeBar(label: "7d", percent: pct)
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text("In: \(SessionMetrics.formatCount(stateHolder.state.inputTokens))")
                    .font(.caption2)
                Text("Out: \(SessionMetrics.formatCount(stateHolder.state.outputTokens))")
                    .font(.caption2)
            }
            .foregroundStyle(.secondary)
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
