// ToastOverlay.swift — Brief notification overlay for state transitions

import SwiftUI

struct ToastOverlay: View {
    let message: String
    let icon: String  // SF Symbol name

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(message)
                .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Manages toast display state with auto-dismiss behavior.
@MainActor
final class ToastManager: ObservableObject {
    @Published private(set) var currentToast: (message: String, icon: String)?
    private var dismissTask: Task<Void, Never>?

    func show(message: String, icon: String, duration: TimeInterval = 3.0) {
        dismissTask?.cancel()
        currentToast = (message, icon)
        dismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.3)) {
                currentToast = nil
            }
        }
    }
}
