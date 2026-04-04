// AgentStatusIcon.swift — Dynamic menu bar icon based on aggregate session state
// MenuBarExtra label MUST be a simple Image or Label — complex ZStack/overlay causes rendering bugs.

#if os(macOS)
import SwiftUI

struct AgentStatusIcon: View {
    let sessions: [SessionInfo]
    let bridgeConnected: Bool

    @State private var animationPhase = false
    @State private var pulseTimer: Timer?

    var body: some View {
        // MenuBarExtra label only supports simple Image reliably — no ZStack, no overlay
        Image(systemName: currentSymbol)
            .onAppear { startPulseIfNeeded() }
            .onChange(of: highestPriority) { _, _ in startPulseIfNeeded() }
    }

    // MARK: - State Priority

    private enum PriorityState: Equatable {
        case disconnected
        case noSessions
        case allIdle
        case processing
        case attention
    }

    private var highestPriority: PriorityState {
        guard bridgeConnected else { return .disconnected }
        let alive = sessions.filter(\.alive)
        guard !alive.isEmpty else { return .noSessions }

        let hasAwaiting = alive.contains { s in
            let state = AgentConnectionState(rawValue: s.state ?? "idle") ?? .idle
            return state.isAwaiting
        }
        if hasAwaiting { return .attention }

        let hasProcessing = alive.contains { s in
            let state = AgentConnectionState(rawValue: s.state ?? "idle") ?? .idle
            return state == .processing
        }
        if hasProcessing { return .processing }

        return .allIdle
    }

    private var currentSymbol: String {
        switch highestPriority {
        case .disconnected:
            return "xmark.circle"
        case .noSessions:
            return "circle.dotted"
        case .allIdle:
            return "checkmark.circle"
        case .processing:
            return animationPhase ? "gearshape.fill" : "gearshape"
        case .attention:
            return animationPhase ? "exclamationmark.circle.fill" : "exclamationmark.circle"
        }
    }

    private func startPulseIfNeeded() {
        let needsPulse = highestPriority == .processing || highestPriority == .attention
        if needsPulse && pulseTimer == nil {
            pulseTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
                DispatchQueue.main.async { animationPhase.toggle() }
            }
        } else if !needsPulse {
            pulseTimer?.invalidate()
            pulseTimer = nil
            animationPhase = false
        }
    }
}
#endif
