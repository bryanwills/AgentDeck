// DeckButton.swift — Single deck button with press animation

import SwiftUI

struct DeckButton: View {
    let state: ButtonSlotState
    let action: () -> Void

    @State private var isPressed = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                if let icon = state.icon {
                    Text(icon)
                        .font(.title2)
                }
                Text(state.title)
                    .font(.caption.bold())
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                if let subtitle = state.subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let badge = state.badge {
                    Text(badge)
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .background(.white.opacity(0.2), in: Capsule())
                }
            }
            .foregroundStyle(Color(hex: state.textColor) ?? .white)
            .frame(maxWidth: .infinity)
            .frame(height: 80)
            .background(
                (Color(hex: state.bgColor) ?? .gray.opacity(0.3))
                    .opacity(state.dim == true ? 0.3 : 1),
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .disabled(!state.enabled)
        .opacity(state.enabled ? 1 : 0.4)
        .scaleEffect(isPressed ? 0.95 : 1)
        .animation(.easeInOut(duration: 0.1), value: isPressed)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
    }

    static func placeholder(slot: Int) -> some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.white.opacity(0.05))
            .frame(height: 80)
            .overlay(
                Text("—")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            )
    }
}

// MARK: - Color hex init

extension Color {
    init?(hex: String) {
        var str = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if str.hasPrefix("#") { str.removeFirst() }
        guard str.count == 6,
              let rgb = UInt64(str, radix: 16) else { return nil }
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
