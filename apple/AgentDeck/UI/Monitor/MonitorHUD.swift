// MonitorHUD.swift — Semi-transparent HUD overlay (matches Android MonitorHUD)

import SwiftUI

/// Shared landscape bounds for HUD cards. The water region ends where the
/// Timeline begins, so both side rails must consume the same finite budget.
/// Width grows modestly on larger dashboards to reduce wrapped session names,
/// then caps so the terrarium remains the visual center.
enum DashboardHUDLayout {
    static let edgePadding: CGFloat = 12
    static let timelineClearance: CGFloat = 12
    static let minimumPanelHeight: CGFloat = 80
    static let compactSwitcherHeight: CGFloat = 30
    static let compactSwitcherGap: CGFloat = 6

    static func landscapePanelMaxHeight(
        availableHeight: CGFloat,
        showsTimeline: Bool
    ) -> CGFloat {
        let visibleRegion = showsTimeline
            ? availableHeight * (1 - MonitorLayout.sandFraction)
            : availableHeight
        return max(0, visibleRegion - edgePadding - timelineClearance)
    }

    static func sessionPanelWidth(availableWidth: CGFloat) -> CGFloat {
        min(max(220, availableWidth * 0.25), 280)
    }

    /// A phone in portrait cannot support two readable HUD rails side by
    /// side. iPad portrait stays in the dual-rail composition.
    static func usesSingleReadableRail(
        availableWidth: CGFloat,
        availableHeight: CGFloat
    ) -> Bool {
        availableHeight > availableWidth && availableWidth < 600
    }

    static func compactPanelWidth(availableWidth: CGFloat) -> CGFloat {
        min(max(0, availableWidth - 16), 420)
    }

    static func compactPanelMaxHeight(
        availableHeight: CGFloat,
        showsTimeline: Bool
    ) -> CGFloat {
        max(
            0,
            landscapePanelMaxHeight(
                availableHeight: availableHeight,
                showsTimeline: showsTimeline
            ) - compactSwitcherHeight - compactSwitcherGap
        )
    }

    static func setupCardLeadingInset(
        availableWidth: CGFloat,
        isLandscape: Bool,
        showsSessionList: Bool
    ) -> CGFloat {
        guard isLandscape, showsSessionList else { return 14 }
        return edgePadding + sessionPanelWidth(availableWidth: availableWidth) + timelineClearance
    }

    static func usesCompactSessionRows(sessionCount: Int) -> Bool {
        sessionCount > 6
    }
}

private enum CompactDashboardHUDPage: String, CaseIterable, Identifiable {
    case sessions = "Sessions"
    case system = "System"

    var id: String { rawValue }
}

struct MonitorHUD: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences
    @State private var compactPage: CompactDashboardHUDPage = .sessions

    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height
            let panelMaxHeight = DashboardHUDLayout.landscapePanelMaxHeight(
                availableHeight: geo.size.height,
                showsTimeline: preferences.showTimeline
            )
            let usesSingleRail = DashboardHUDLayout.usesSingleReadableRail(
                availableWidth: geo.size.width,
                availableHeight: geo.size.height
            )

            if usesSingleRail {
                compactPhoneHUD(geo: geo)
            } else if isLandscape {
                // iPad landscape: matches Android Box layout
                ZStack(alignment: .topLeading) {
                    // Top-left: bounded session roster. Unlike the previous
                    // natural-height card, this can never paint into Timeline.
                    if preferences.showSessionList {
                        if panelMaxHeight >= DashboardHUDLayout.minimumPanelHeight {
                            SessionListPanel(maxHeight: panelMaxHeight)
                                .frame(width: DashboardHUDLayout.sessionPanelWidth(
                                    availableWidth: geo.size.width
                                ))
                                .padding(.leading, DashboardHUDLayout.edgePadding)
                                .padding(.top, DashboardHUDLayout.edgePadding)
                        }
                    }

                    // Top-right: relationship-centric topology rail
                    // (replaces old TankStatus + DeviceDiagnostic boxes).
                    // Visible if either of the legacy preferences is on; the
                    // rail is a single unified view so we don't try to hide
                    // upstream or downstream independently anymore.
                    if preferences.showTankStatus || preferences.showDeviceDiagnostic {
                        if panelMaxHeight >= DashboardHUDLayout.minimumPanelHeight {
                            HStack {
                                Spacer()
                                TopologyRail(maxHeight: panelMaxHeight)
                                    .frame(maxWidth: min(geo.size.width * 0.32, 300))
                                    .padding(.trailing, DashboardHUDLayout.edgePadding)
                                    .padding(.top, DashboardHUDLayout.edgePadding)
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
                            SessionListPanel(maxHeight: panelMaxHeight)
                                .frame(maxWidth: .infinity)
                        }
                        if preferences.showTankStatus || preferences.showDeviceDiagnostic {
                            TopologyRail(maxHeight: panelMaxHeight)
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

    /// Compact portrait keeps the full information set but avoids squeezing
    /// Sessions and System into two ~half-width columns. The explicit switch
    /// makes the alternate rail discoverable while each page keeps readable
    /// line lengths and its own bounded scroll position.
    @ViewBuilder
    private func compactPhoneHUD(geo: GeometryProxy) -> some View {
        let showsSessions = preferences.showSessionList
        let showsSystem = preferences.showTankStatus || preferences.showDeviceDiagnostic
        let pages: [CompactDashboardHUDPage] = [
            showsSessions ? .sessions : nil,
            showsSystem ? .system : nil,
        ].compactMap { $0 }
        let resolvedPage: CompactDashboardHUDPage? = pages.contains(compactPage)
            ? compactPage
            : pages.first
        let contentMaxHeight = DashboardHUDLayout.compactPanelMaxHeight(
            availableHeight: geo.size.height,
            showsTimeline: preferences.showTimeline
        )

        VStack(spacing: DashboardHUDLayout.compactSwitcherGap) {
            if pages.count > 1 {
                CompactDashboardHUDSwitcher(
                    pages: pages,
                    selection: compactPage,
                    onSelect: { compactPage = $0 }
                )
                .frame(height: DashboardHUDLayout.compactSwitcherHeight)
            }

            if contentMaxHeight >= DashboardHUDLayout.minimumPanelHeight {
                switch resolvedPage {
                case .sessions:
                    SessionListPanel(maxHeight: contentMaxHeight)
                case .system:
                    TopologyRail(maxHeight: contentMaxHeight)
                case nil:
                    EmptyView()
                }
            }
        }
        .frame(width: DashboardHUDLayout.compactPanelWidth(availableWidth: geo.size.width))
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

private struct CompactDashboardHUDSwitcher: View {
    let pages: [CompactDashboardHUDPage]
    let selection: CompactDashboardHUDPage
    let onSelect: (CompactDashboardHUDPage) -> Void

    var body: some View {
        HStack(spacing: 3) {
            ForEach(pages) { page in
                Button {
                    onSelect(page)
                } label: {
                    Text(page.rawValue)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(
                            selection == page ? TerrariumHUD.text : TerrariumHUD.subtext
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(
                            selection == page
                                ? TerrariumHUD.tetraNeon.opacity(0.18)
                                : Color.clear,
                            in: RoundedRectangle(cornerRadius: 6)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show \(page.rawValue.lowercased())")
            }
        }
        .padding(3)
        .background(TerrariumHUD.bg, in: RoundedRectangle(cornerRadius: 8))
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
