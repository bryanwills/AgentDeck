// AgentDeckLogo.swift — Brand mark for AgentDeck
// Metaphor: a stacked deck of cards — "deck of agents" — with a single pip on
// the top card. Implemented with `RoundedRectangle` + `Circle` views rather
// than `Canvas` because Canvas-backed views do NOT render inside
// `MenuBarExtra` labels (they measure as zero-size, which is how the
// menubar icon went invisible). Stacked Shape views survive the same
// context, and render identically at 14pt and 32pt.
//
// Available on both iOS and macOS so the dashboard HUD (shared between
// the two platforms) can use the same mark.

import SwiftUI

struct AgentDeckLogo: View {
    var size: CGFloat = 16
    var color: Color = .primary

    var body: some View {
        // Unit-space layout (0…24) so every piece scales from a single
        // `size` input — matches `explore/logos.jsx::LogoDeck` geometry.
        let s = size / 24.0
        ZStack(alignment: .topLeading) {
            Color.clear
            deckCard(x: 4 * s, y: 8 * s, s: s, opacity: 0.35)
            deckCard(x: 6 * s, y: 5 * s, s: s, opacity: 0.60)
            deckCard(x: 8 * s, y: 2 * s, s: s, opacity: 1.00)
            Circle()
                .fill(color)
                .frame(width: 3.2 * s, height: 3.2 * s)
                .position(x: 14 * s, y: 9 * s)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("AgentDeck")
    }

    private func deckCard(x: CGFloat, y: CGFloat, s: CGFloat, opacity: Double) -> some View {
        RoundedRectangle(cornerRadius: 1.5 * s)
            .stroke(color.opacity(opacity), lineWidth: max(1.0, 1.6 * s))
            .frame(width: 12 * s, height: 14 * s)
            .offset(x: x, y: y)
    }
}

#Preview {
    VStack(spacing: 16) {
        AgentDeckLogo(size: 16, color: .primary)
        AgentDeckLogo(size: 28, color: .cyan)
        AgentDeckLogo(size: 48, color: .orange)
    }
    .padding()
}
