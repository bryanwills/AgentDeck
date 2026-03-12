// EncoderPanel.swift — Single encoder LCD panel with gesture support

import SwiftUI

struct EncoderPanel: View {
    let state: EncoderSlotState

    var body: some View {
        VStack(spacing: 4) {
            // Header
            Text(state.header)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(Color(red: 0.58, green: 0.64, blue: 0.72)) // #94a3b8

            // Icon + Value
            HStack(spacing: 4) {
                if let icon = state.icon {
                    Text(icon)
                        .font(.system(size: 16))
                }
                if let value = state.value {
                    Text(value)
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
            }

            // Counter
            if let counter = state.counter {
                Text(counter)
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            // Accent bar
            if let accentColor = Color(hex: state.accentColor) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(accentColor)
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16)) // #0f172a
    }

    static var placeholder: some View {
        Color(red: 0.06, green: 0.09, blue: 0.16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
