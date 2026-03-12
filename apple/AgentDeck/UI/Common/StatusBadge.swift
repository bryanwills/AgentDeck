// StatusBadge.swift — State indicator badge

import SwiftUI

struct StatusBadge: View {
    let state: AgentConnectionState

    private var color: Color {
        switch state {
        case .disconnected: .gray
        case .idle: .green
        case .processing: .cyan
        case .awaitingPermission: .orange
        case .awaitingOption: .yellow
        case .awaitingDiff: .purple
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(state.displayLabel)
                .font(.caption.bold())
                .foregroundStyle(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.15), in: Capsule())
    }
}
