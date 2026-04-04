// ControlTowerPanel.swift — Rich MenuBarExtra panel for macOS
// Replaces the simple .menu style with a window-style control tower

#if os(macOS)
import SwiftUI

struct ControlTowerPanel: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var daemonService: DaemonService
    @EnvironmentObject private var preferences: AppPreferences
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            headerSection
            Divider().overlay(Color.gray.opacity(0.3))

            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 12) {
                    if !attentionSessions.isEmpty {
                        attentionSection
                    }
                    if !activeSessions.isEmpty {
                        activeSection
                    }
                    if !idleSessions.isEmpty {
                        idleSection
                    }
                    modelsAndServicesSection
                    devicesSection
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }

            Divider().overlay(Color.gray.opacity(0.3))
            actionsBar
            Divider().overlay(Color.gray.opacity(0.3))
            footerSection
        }
        .frame(width: 340, height: 450)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Session Classification

    private var sortedSessions: [SessionInfo] {
        stateHolder.state.siblingSessions
            .filter { $0.alive }
            .sorted { lhs, rhs in
                let lr = sessionRank(lhs)
                let rr = sessionRank(rhs)
                if lr != rr { return lr < rr }
                return (lhs.projectName ?? "") < (rhs.projectName ?? "")
            }
    }

    private var attentionSessions: [SessionInfo] {
        sortedSessions.filter { sessionState($0).isAwaiting }
    }

    private var activeSessions: [SessionInfo] {
        sortedSessions.filter { sessionState($0) == .processing }
    }

    private var idleSessions: [SessionInfo] {
        sortedSessions.filter {
            let s = sessionState($0)
            return s == .idle || s == .disconnected
        }
    }

    private func sessionState(_ session: SessionInfo) -> AgentConnectionState {
        AgentConnectionState(rawValue: session.state ?? "idle") ?? .idle
    }

    private func sessionRank(_ session: SessionInfo) -> Int {
        switch sessionState(session) {
        case .processing: return 0
        case .awaitingPermission, .awaitingOption, .awaitingDiff: return 1
        case .idle: return 2
        case .disconnected: return 3
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("AgentDeck Control Tower")
                    .font(.system(size: 13, weight: .semibold))
                let sessionCount = sortedSessions.count
                let attentionCount = attentionSessions.count
                HStack(spacing: 6) {
                    Text("\(sessionCount) session\(sessionCount == 1 ? "" : "s")")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    if attentionCount > 0 {
                        Text("\(attentionCount) need attention")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.orange)
                    }
                }
            }
            Spacer()
            daemonStatusBadge
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var daemonStatusBadge: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(daemonService.isRunning || daemonService.isUsingExternalDaemon
                      ? Color.green : Color.red)
                .frame(width: 7, height: 7)
            if daemonService.isRunning {
                Text(verbatim: ":\(daemonService.port)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            } else if daemonService.isUsingExternalDaemon {
                Text(verbatim: "ext :\(daemonService.port)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Attention Section

    private var attentionSection: some View {
        SectionContainer(title: "ATTENTION", titleColor: .orange) {
            ForEach(attentionSessions) { session in
                HStack(spacing: 8) {
                    sessionDot(session)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(session.projectName ?? "Unknown")
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            Text(sessionState(session).displayLabel)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.orange)
                            if let type = session.agentType {
                                Text(agentTypeLabel(type))
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
            }
            Button {
                openDashboard()
            } label: {
                Text("Open in Dashboard")
                    .font(.system(size: 11))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    // MARK: - Active Section

    private var activeSection: some View {
        SectionContainer(title: "PROCESSING", titleColor: .cyan) {
            ForEach(activeSessions) { session in
                HStack(spacing: 8) {
                    sessionDot(session)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(session.projectName ?? "Unknown")
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            if let type = session.agentType {
                                Text(agentTypeLabel(type))
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                            // Show currentTool if this is the primary session
                            if session.id == stateHolder.state.sessionId,
                               let tool = stateHolder.state.currentTool {
                                Text(tool)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - Idle Section

    private var idleSection: some View {
        SectionContainer(title: "IDLE", titleColor: .green) {
            if idleSessions.count > 3 {
                let names = idleSessions.compactMap(\.projectName).joined(separator: ", ")
                Text(names.isEmpty ? "\(idleSessions.count) sessions" : names)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else {
                ForEach(idleSessions) { session in
                    HStack(spacing: 8) {
                        sessionDot(session)
                        Text(session.projectName ?? "Unknown")
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        if let type = session.agentType {
                            Text(agentTypeLabel(type))
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
    }

    // MARK: - Models & Services

    private var modelsAndServicesSection: some View {
        SectionContainer(title: "MODELS & SERVICES", titleColor: .secondary) {
            // Claude / OAuth
            claudeRow

            // OpenClaw / Gateway
            if stateHolder.state.gatewayAvailable || stateHolder.state.gatewayHasError {
                gatewayRow
            }

            // Ollama
            if let ollama = stateHolder.state.ollamaStatus {
                ollamaRow(ollama)
            }

            // MLX
            if !stateHolder.state.mlxModels.isEmpty {
                mlxRow
            }

            // Rate Limits
            rateLimitsRow

            // Subscriptions
            if !stateHolder.state.subscriptions.isEmpty {
                subscriptionsRow
            }
        }
    }

    private var claudeRow: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "cloud.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text("Claude")
                    .font(.system(size: 11, weight: .medium))
                Spacer()
                if stateHolder.state.oauthConnected == true {
                    Text("OAuth")
                        .font(.system(size: 10))
                        .foregroundStyle(.green)
                } else if stateHolder.state.oauthConnected == false {
                    Text("Not connected")
                        .font(.system(size: 10))
                        .foregroundStyle(.orange)
                }
            }
            let available = stateHolder.state.modelCatalog.filter(\.available)
            if !available.isEmpty {
                Text(available.map(\.name).joined(separator: ", "))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private var gatewayRow: some View {
        HStack(spacing: 4) {
            Image(systemName: "network")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text("OpenClaw")
                .font(.system(size: 11, weight: .medium))
            Spacer()
            if stateHolder.state.gatewayHasError {
                Text("Error")
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
            } else {
                Text("Connected")
                    .font(.system(size: 10))
                    .foregroundStyle(.green)
            }
        }
    }

    private func ollamaRow(_ status: OllamaStatus) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "cpu")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text("Ollama")
                    .font(.system(size: 11, weight: .medium))
                Spacer()
                Text(status.available ? "Running" : "Stopped")
                    .font(.system(size: 10))
                    .foregroundStyle(status.available ? .green : .secondary)
            }
            if !status.models.isEmpty {
                let modelDescs = status.models.map { m in
                    let sizeGB = String(format: "%.1fG", Double(m.size) / 1_073_741_824)
                    let vramGB = String(format: "%.1fG", Double(m.sizeVram) / 1_073_741_824)
                    return "\(m.name) \(sizeGB)/\(vramGB)"
                }
                Text(modelDescs.joined(separator: ", "))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private var mlxRow: some View {
        HStack(spacing: 4) {
            Image(systemName: "apple.terminal")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text("MLX")
                .font(.system(size: 11, weight: .medium))
            Spacer()
            Text(stateHolder.state.mlxModels.joined(separator: ", "))
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var rateLimitsRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: "gauge.medium")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text("Rate Limits")
                    .font(.system(size: 11, weight: .medium))
                if stateHolder.state.usageStale == true {
                    Text("stale")
                        .font(.system(size: 9))
                        .foregroundStyle(.orange)
                }
            }
            if let pct5h = stateHolder.state.fiveHourPercent {
                HStack(spacing: 6) {
                    Text("5h")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, alignment: .trailing)
                    Text(gaugeString(pct5h))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(gaugeColor(pct5h))
                    if let reset = stateHolder.state.fiveHourResetsAt {
                        Text(formatResetTime(reset))
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if let pct7d = stateHolder.state.sevenDayPercent {
                HStack(spacing: 6) {
                    Text("7d")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, alignment: .trailing)
                    Text(gaugeString(pct7d))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(gaugeColor(pct7d))
                    if let reset = stateHolder.state.sevenDayResetsAt {
                        Text(formatResetTime(reset))
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if stateHolder.state.fiveHourPercent == nil && stateHolder.state.sevenDayPercent == nil {
                Text("No data")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var subscriptionsRow: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "creditcard")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text("Subscriptions")
                    .font(.system(size: 11, weight: .medium))
            }
            ForEach(Array(stateHolder.state.subscriptions.enumerated()), id: \.offset) { _, sub in
                HStack(spacing: 4) {
                    Text(sub.name)
                        .font(.system(size: 10))
                    if let until = sub.until {
                        Spacer()
                        Text(until)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Devices

    private var devicesSection: some View {
        SectionContainer(title: "DEVICES", titleColor: .secondary) {
            HStack(spacing: 4) {
                Image(systemName: "display")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text("Coming soon")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                if daemonService.connectedClients > 0 {
                    Text("\(daemonService.connectedClients) client\(daemonService.connectedClients == 1 ? "" : "s")")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Actions Bar

    private var actionsBar: some View {
        HStack(spacing: 8) {
            Button {
                SessionLauncher.launchSession(daemonPort: daemonService.port)
            } label: {
                Label("Launch Session", systemImage: "play.fill")
                    .font(.system(size: 11))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            Button {
                openDashboard()
            } label: {
                Label("Dashboard", systemImage: "square.grid.2x2")
                    .font(.system(size: 11))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            Spacer()

            Button {
                // Activate app first so Settings window appears in front
                NSApp.activate(ignoringOtherApps: true)
                if #available(macOS 14.0, *) {
                    NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                } else {
                    NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
                }
            } label: {
                Image(systemName: "gear")
                    .font(.system(size: 11))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Footer

    private var footerSection: some View {
        HStack {
            Toggle("Start at Login", isOn: Binding(
                get: { daemonService.isLoginItemEnabled },
                set: { enabled in
                    if enabled { daemonService.registerLoginItem() }
                    else { daemonService.unregisterLoginItem() }
                }
            ))
            .toggleStyle(.checkbox)
            .font(.system(size: 11))

            Spacer()

            Button("Quit") {
                Task {
                    await daemonService.stop()
                    NSApplication.shared.terminate(nil)
                }
            }
            .font(.system(size: 11))
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Helpers

    private func sessionDot(_ session: SessionInfo) -> some View {
        let state = sessionState(session)
        let color: Color = switch state {
        case .processing: .cyan
        case .awaitingPermission, .awaitingOption, .awaitingDiff: .orange
        case .idle: .green
        case .disconnected: .gray
        }
        return Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }

    private func agentTypeLabel(_ type: String) -> String {
        switch type {
        case "claude-code": "Claude"
        case "openclaw": "OpenClaw"
        case "codex-cli": "Codex"
        case "opencode": "OpenCode"
        case "daemon": "Daemon"
        default: type
        }
    }

    private func openDashboard() {
        if let window = NSApplication.shared.windows.first(where: { $0.title.contains("AgentDeck Dashboard") }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: "dashboard")
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    // MARK: - Gauge Helpers

    private func gaugeString(_ percent: Double) -> String {
        let filled = Int((percent / 100.0) * 10)
        let clamped = max(0, min(10, filled))
        let bar = String(repeating: "\u{2588}", count: clamped)
            + String(repeating: "\u{2591}", count: 10 - clamped)
        return "\(bar) \(Int(percent))%"
    }

    private func gaugeColor(_ percent: Double) -> Color {
        if percent >= 90 { return .red }
        if percent >= 70 { return .orange }
        return .green
    }

    private func formatResetTime(_ isoString: String?) -> String {
        guard let isoString, !isoString.isEmpty else { return "" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString)
                ?? ISO8601DateFormatter().date(from: isoString) else { return isoString }
        let interval = date.timeIntervalSinceNow
        if interval <= 0 { return "now" }
        let hours = Int(interval) / 3600
        let minutes = (Int(interval) % 3600) / 60
        if hours > 0 { return "\(hours)h\(minutes)m" }
        return "\(minutes)m"
    }
}

// MARK: - Section Container

private struct SectionContainer<Content: View>: View {
    let title: String
    let titleColor: Color
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(titleColor)
            content
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
#endif
