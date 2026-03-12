// EncoderStrip.swift — 4-panel encoder LCD strip

import SwiftUI

struct EncoderStrip: View {
    @Environment(AgentStateHolder.self) private var stateHolder

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<4, id: \.self) { slot in
                if let encoder = stateHolder.state.encoderStates.first(where: { $0.slot == slot }) {
                    EncoderPanel(state: encoder)
                } else {
                    EncoderPanel.placeholder
                }
            }
        }
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}
