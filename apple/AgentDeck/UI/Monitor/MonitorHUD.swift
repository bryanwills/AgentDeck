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

                    // Top-right: relationship-centric topology rail
                    // (replaces old TankStatus + DeviceDiagnostic boxes).
                    // Visible if either of the legacy preferences is on; the
                    // rail is a single unified view so we don't try to hide
                    // upstream or downstream independently anymore.
                    if preferences.showTankStatus || preferences.showDeviceDiagnostic {
                        // The rail must never grow behind the timeline strip
                        // (bottom sandFraction of the window). 24 = 12 top
                        // padding + 12 breathing room above the sand line.
                        let railMaxHeight = (preferences.showTimeline
                            ? geo.size.height * (1 - MonitorLayout.sandFraction)
                            : geo.size.height) - 24
                        if railMaxHeight >= 80 {
                            HStack {
                                Spacer()
                                TopologyRail(maxHeight: railMaxHeight)
                                    .frame(maxWidth: min(geo.size.width * 0.32, 300))
                                    .padding(.trailing, 12)
                                    .padding(.top, 12)
                            }
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
                        if preferences.showTankStatus || preferences.showDeviceDiagnostic {
                            TopologyRail()
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
