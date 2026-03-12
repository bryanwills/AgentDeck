// DeckScreen.swift — SD+ mirroring: encoder strip + 2×4 button grid
// Phase 4 full implementation, Phase 1 placeholder

import SwiftUI

struct DeckScreen: View {
    @Environment(AgentStateHolder.self) private var stateHolder

    var body: some View {
        VStack(spacing: 0) {
            // Encoder strip
            EncoderStrip()
                .frame(height: 80)

            // 2×4 Button grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(0..<8, id: \.self) { slot in
                    if let button = stateHolder.state.buttonStates.first(where: { $0.slot == slot }) {
                        DeckButton(state: button) {
                            handleButtonAction(button.action)
                        }
                    } else {
                        DeckButton.placeholder(slot: slot)
                    }
                }
            }
            .padding()

            // Context area
            if stateHolder.state.state.isAwaiting,
               let question = stateHolder.state.question {
                Text(question)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .padding(.horizontal)
            }

            Spacer()
        }
        .background(Color(red: 0.06, green: 0.09, blue: 0.16).ignoresSafeArea())
    }

    private func handleButtonAction(_ action: String?) {
        guard let action else { return }

        if action.hasPrefix("respond:") {
            let value = String(action.dropFirst("respond:".count))
            stateHolder.sendCommand(.respond(value: value))
        } else if action.hasPrefix("select_option:") {
            if let idx = Int(action.dropFirst("select_option:".count)) {
                stateHolder.sendCommand(.selectOption(index: idx))
            }
        } else if action.hasPrefix("command:") {
            let text = String(action.dropFirst("command:".count))
            stateHolder.sendCommand(.sendPrompt(text: text))
        } else {
            switch action {
            case "switch_mode": stateHolder.sendCommand(.switchMode(mode: nil))
            case "interrupt": stateHolder.sendCommand(.interrupt)
            case "escape": stateHolder.sendCommand(.escape)
            default: break
            }
        }
    }
}
