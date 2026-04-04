// ActivityPanel.swift — Current activity panel (matches Android ActivityPanel.kt)

import SwiftUI

struct ActivityPanel: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Header (matches Android "ACTIVITY" 10sp bold mono)
            Text("ACTIVITY")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext)

            switch stateHolder.state.state {
            case .processing:
                if let tool = stateHolder.state.currentTool {
                    Text("> \(tool)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.tetraNeon)
                        .lineLimit(1)
                }
                if let input = stateHolder.state.toolInput {
                    Text("  \"\(input)\"")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                        .lineLimit(2)
                }
                if let progress = stateHolder.state.toolProgress {
                    Text("  (\(progress))")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext.opacity(0.7))
                        .lineLimit(2)
                        .truncationMode(.tail)
                }

            case .idle:
                if let prompt = stateHolder.state.suggestedPrompt {
                    Text("Suggested:")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                    Text(prompt)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.text)
                        .lineLimit(2)
                } else {
                    Text("Waiting for prompt...")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                }

            case .awaitingPermission, .awaitingOption, .awaitingDiff:
                if let question = stateHolder.state.question {
                    Text(question)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.text)
                        .lineLimit(3)
                } else {
                    Text("Awaiting input...")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                }

            case .disconnected:
                Text("No connection")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext)
            }
        }
        .padding(8)
        .background(TerrariumHUD.bg, in: RoundedRectangle(cornerRadius: 8))
    }
}
