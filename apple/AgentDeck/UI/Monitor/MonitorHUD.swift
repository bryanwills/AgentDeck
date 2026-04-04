// MonitorHUD.swift — Semi-transparent HUD overlay (matches Android MonitorHUD)

import SwiftUI

struct MonitorHUD: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences

    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height

            if isLandscape {
                // iPad landscape: matches Android Box layout
                ZStack(alignment: .topLeading) {
                    // Top-left: Session list (max 220dp)
                    if preferences.showSessionList {
                        SessionListPanel()
                            .frame(maxWidth: min(geo.size.width * 0.22, 220))
                            .padding(.leading, 12)
                            .padding(.top, 12)
                    }

                    // Top-right: Tank status (max 280dp)
                    if preferences.showTankStatus {
                        HStack {
                            Spacer()
                            TankStatusPanel()
                                .frame(maxWidth: min(geo.size.width * 0.32, 280))
                                .padding(.trailing, 12)
                                .padding(.top, 12)
                        }
                    }

                    // Stale data banner when disconnected
                    if !stateHolder.state.bridgeConnected, let lastReceived = stateHolder.lastDataReceivedAt {
                        VStack {
                            Spacer()
                            HStack {
                                Spacer()
                                StaleDataBanner(lastReceived: lastReceived)
                                Spacer()
                            }
                            .padding(.bottom, 12)
                        }
                    }
                }
            } else {
                // iPhone portrait: vertical stack
                VStack(spacing: 0) {
                    // Stale data banner when disconnected
                    if !stateHolder.state.bridgeConnected, let lastReceived = stateHolder.lastDataReceivedAt {
                        StaleDataBanner(lastReceived: lastReceived)
                            .padding(.top, 8)
                    }

                    HStack(alignment: .top, spacing: 8) {
                        if preferences.showSessionList {
                            SessionListPanel()
                                .frame(maxWidth: .infinity)
                        }
                        if preferences.showTankStatus {
                            TankStatusPanel()
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.top, 8)

                    Spacer()
                }
            }
        }
    }
}

// MARK: - Stale Data Banner

private struct StaleDataBanner: View {
    let lastReceived: Date
    @State private var now = Date()

    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    private var timeAgoText: String {
        let elapsed = now.timeIntervalSince(lastReceived)
        if elapsed < 60 {
            return "\(Int(elapsed))s"
        } else if elapsed < 3600 {
            return "\(Int(elapsed / 60))m"
        } else {
            return "\(Int(elapsed / 3600))h"
        }
    }

    var body: some View {
        Text("Data from \(timeAgoText) ago")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.ultraThinMaterial, in: Capsule())
            .onReceive(timer) { self.now = $0 }
    }
}
