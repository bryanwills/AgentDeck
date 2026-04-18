// ControlTowerPanel.swift — Rich MenuBarExtra panel for macOS
// Replaces the simple .menu style with a window-style control tower

#if os(macOS)
import SwiftUI
import IOKit
import IOKit.hid
import AppKit

struct ControlTowerPanel: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var daemonService: DaemonService
    @EnvironmentObject private var preferences: AppPreferences
    @Environment(\.openWindow) private var openWindow

    /// Cached Stream Deck detection result. Refreshed on view appear and via
    /// a lightweight 5s timer while the panel is visible. We never want to
    /// run IOHIDManager enumeration inside a SwiftUI view body (it is not
    /// cheap enough to do on every state tick), so a cached @State holds
    /// the previous verdict until the timer fires.
    @State private var streamDeckDetection: StreamDeckDetection = StreamDeckDetection(
        elgatoAppInstalled: false,
        streamDeckPlusConnected: false
    )
    @State private var streamDeckDetectionLastRun: Date? = nil

    /// Session whose "Jump to…" grid is currently expanded. nil means every
    /// row is collapsed. Reset when the underlying session list shape
    /// changes so a stale id can't keep a row permanently-open.
    @State private var expandedSessionId: String? = nil

    var body: some View {
        VStack(spacing: 0) {
            // Header: Attention Theater when any session awaits input,
            // otherwise a quiet "all calm" strip with the AgentDeck mark.
            if let awaiting = featuredAwaitingSession {
                AttentionTheaterView(
                    session: awaiting,
                    question: questionFor(awaiting),
                    respond: { index in respondToAwaiting(index, session: awaiting) }
                )
            } else {
                CalmHeaderView(
                    sessionCount: sortedSessions.count,
                    processingCount: activeSessions.count,
                    daemonPort: daemonService.port,
                    bridgeConnected: daemonService.isRunning || daemonService.isUsingExternalDaemon
                )
            }

            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 14) {
                    sessionsListSection
                    topologySection
                    utilityLinksRow
                    rateLimitsSection
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }

            VStack(spacing: 0) {
                if showDaemonOfflineBanner {
                    daemonOfflineBanner
                }
                pillActionsBar
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.7))
            .overlay(
                Rectangle()
                    .fill(Color.black.opacity(0.08))
                    .frame(height: 0.5),
                alignment: .top
            )

            footerSection
        }
        .frame(width: 380, height: 620)
        // Cream panel background matches the Option D prototype. Not a
        // system palette color — the design intent is a warm off-white
        // that contrasts with the typical macOS menubar popover chrome.
        .background(Color(red: 0.965, green: 0.953, blue: 0.933))
        .foregroundColor(Color(red: 0.102, green: 0.102, blue: 0.122))
        .onAppear { refreshStreamDeckDetectionIfStale() }
        .onReceive(
            Timer.publish(every: 5, on: .main, in: .common).autoconnect()
        ) { _ in refreshStreamDeckDetectionIfStale() }
        .onChange(of: sortedSessions.map(\.id)) { _, _ in
            // Collapse any stale jump-panel when the session list changes.
            if let open = expandedSessionId,
               !sortedSessions.contains(where: { $0.id == open }) {
                expandedSessionId = nil
            }
        }
    }

    /// The session the attention theater should feature. Prefers the
    /// currently-focused session if it's awaiting; otherwise picks the
    /// first awaiting session in sort order.
    private var featuredAwaitingSession: SessionInfo? {
        if let focusedId = stateHolder.state.sessionId,
           let focused = sortedSessions.first(where: { $0.id == focusedId }),
           sessionState(focused).isAwaiting {
            return focused
        }
        return attentionSessions.first
    }

    /// Prompt question text tied to a session. We only have the live
    /// prompt for the focused session (the bridge only streams one at a
    /// time), so non-focused sessions show a generic "needs input" tag.
    private func questionFor(_ session: SessionInfo) -> String? {
        if session.id == stateHolder.state.sessionId {
            return stateHolder.state.question
        }
        return nil
    }

    private func respondToAwaiting(_ optionIndex: Int, session: SessionInfo) {
        // Route via the daemon focus relay first, then send the option
        // selection. `selectOption` is the canonical command path — same
        // one used by D200H buttons and Cmd+Y/N/A keyboard shortcuts.
        stateHolder.sendCommand(.focusSession(sessionId: session.id))
        stateHolder.sendCommand(.selectOption(index: optionIndex))
    }

    /// Recompute Stream Deck app/hardware detection if the cached verdict is
    /// older than 5 seconds (or we've never run it). IOHIDManager enumeration
    /// is cheap but non-free — don't spin it every SwiftUI tick.
    private func refreshStreamDeckDetectionIfStale() {
        if let last = streamDeckDetectionLastRun,
           Date().timeIntervalSince(last) < 5.0 {
            return
        }
        streamDeckDetection = StreamDeckDetection.detect()
        streamDeckDetectionLastRun = Date()
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

    // MARK: - Sessions list

    /// Sessions displayed in the main list. When the attention theater is
    /// showing a featured session at the top, we exclude it here so it
    /// isn't duplicated — matches `option-d.jsx`'s `remaining` filter.
    private var remainingSessions: [SessionInfo] {
        guard let featured = featuredAwaitingSession else { return sortedSessions }
        return sortedSessions.filter { $0.id != featured.id }
    }

    private var sessionsListSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SESSIONS")
                .font(.system(size: 10, weight: .bold))
                .kerning(0.5)
                .foregroundStyle(.secondary)

            if sortedSessions.isEmpty {
                VStack(spacing: 6) {
                    Text("No sessions running")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Button {
                        openLaunchSession()
                    } label: {
                        Label("Launch session", systemImage: "play.fill")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                VStack(spacing: 4) {
                    ForEach(remainingSessions) { session in
                        SessionJumpRow(
                            session: session,
                            tool: currentToolFor(session),
                            expanded: expandedSessionId == session.id,
                            onToggle: {
                                expandedSessionId = (expandedSessionId == session.id) ? nil : session.id
                            },
                            onJumpDashboard: {
                                stateHolder.sendCommand(.focusSession(sessionId: session.id))
                                openDashboard()
                            },
                            onJumpExternal: { target in
                                // TODO(projectPath): daemon payload needs a
                                // `projectPath` / `cwd` field on SessionInfo.
                                // Until `shared/src/protocol.ts` + bridge
                                // expose it, we fall back to launching the
                                // target app bare instead of opening the
                                // project directory.
                                SessionJumpLauncher.launch(target, projectPath: nil)
                            }
                        )
                    }
                }
            }
        }
    }

    /// Secondary text-link row below the topology. Preserves access to
    /// device preview + iPad pairing now that we removed the full devices
    /// section (the unified graph shows the ring; these actions needed a
    /// new home).
    private var utilityLinksRow: some View {
        HStack(spacing: 12) {
            Button { openDevicePreview() } label: {
                Label("Preview devices", systemImage: "rectangle.on.rectangle")
                    .font(.system(size: 10.5, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)

            Button { openWindow(id: "pairing-qr") } label: {
                Label("Pair iPad", systemImage: "qrcode")
                    .font(.system(size: 10.5, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .disabled(daemonService.port == 0)
            .daemonOfflineAffordance(isOffline: daemonService.port == 0)

            Spacer()
            streamDeckPromptCompact
        }
    }

    /// Inline Stream Deck nudge — only renders when hardware is detected.
    /// Replaces the full device-section prompt that used to live here.
    @ViewBuilder
    private var streamDeckPromptCompact: some View {
        if streamDeckDetection.streamDeckPlusConnected {
            Button {
                if streamDeckDetection.elgatoAppInstalled {
                    openStreamDeckPluginInstaller()
                } else {
                    openStreamDeckDownloadPage()
                }
            } label: {
                HStack(spacing: 4) {
                    Circle().fill(Color.orange).frame(width: 5, height: 5)
                    Text(streamDeckDetection.elgatoAppInstalled ? "Install SD plugin" : "Stream Deck+ setup")
                        .font(.system(size: 10, weight: .medium))
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.orange)
        }
    }

    // MARK: - Topology (Unified Graph)

    private var topologySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("TOPOLOGY")
                .font(.system(size: 10, weight: .bold))
                .kerning(0.5)
                .foregroundStyle(.secondary)

            MenuBarTopologyList()
        }
    }

    // MARK: - Compact rate limits

    private var rateLimitsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("RATE LIMITS")
                    .font(.system(size: 10, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(.secondary)
                if stateHolder.state.usageStale == true {
                    Text("stale")
                        .font(.system(size: 9))
                        .foregroundStyle(.orange)
                }
                Spacer()
            }
            if let pct5h = stateHolder.state.fiveHourPercent {
                compactGauge(
                    label: "5h",
                    percent: pct5h,
                    resetTime: stateHolder.state.fiveHourResetsAt
                )
            }
            if let pct7d = stateHolder.state.sevenDayPercent {
                compactGauge(
                    label: "7d",
                    percent: pct7d,
                    resetTime: stateHolder.state.sevenDayResetsAt
                )
            }
            if stateHolder.state.fiveHourPercent == nil && stateHolder.state.sevenDayPercent == nil {
                rateLimitsEmptyState
            }
            if preferences.hooksInstalled == false {
                hookConsentHint
            }
        }
    }

    /// Replacement for the old silent "No data" string. App Store sandbox
    /// can't read `~/.claude/.credentials.json` or the Claude keychain
    /// entry (Apple 2.5.2 blocks `security` subprocess + Anthropic doesn't
    /// publish a shared Keychain Access Group), so quota polling is
    /// structurally impossible in that build. Users need to know that —
    /// and to know the alternative — rather than staring at "No data".
    @ViewBuilder
    private var rateLimitsEmptyState: some View {
        let connected = stateHolder.state.oauthConnected ?? false
        VStack(alignment: .leading, spacing: 4) {
            Text(rateLimitsEmptyMessage)
                .font(.system(size: 10))
                .foregroundColor(connected ? .secondary : .orange)
                .fixedSize(horizontal: false, vertical: true)
            if !connected {
                if #available(macOS 14.0, *) {
                    SettingsLink {
                        Text("Open Settings →")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(red: 0.30, green: 0.43, blue: 0.72))
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(TapGesture().onEnded {
                        NSApp.activate(ignoringOtherApps: true)
                    })
                } else {
                    Button {
                        NSApp.activate(ignoringOtherApps: true)
                        NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
                    } label: {
                        Text("Open Settings →")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(red: 0.30, green: 0.43, blue: 0.72))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Status-aware sentence that replaces "No data". Keeps it to one
    /// line so the menubar popover doesn't grow.
    private var rateLimitsEmptyMessage: String {
        if AgentDeckRuntime.isSandboxed && (stateHolder.state.oauthConnected ?? false) == false {
            return "Claude quota unavailable — App Store sandbox can't read Claude's OAuth token. Install the AgentDeck CLI (`npx @agentdeck/setup`) to track usage here."
        }
        if (stateHolder.state.oauthConnected ?? false) == false {
            return "Claude Code isn't signed in. Run `claude` once in Terminal, then the quota gauges will populate here."
        }
        // OAuth present but no data yet — just fetching, or Anthropic API quiet.
        return "Waiting for Anthropic to return your quota…"
    }

    /// Secondary hint row. Hooks are opt-in (Apple 2.5.2 forbids silent
    /// writes to `~/.claude/settings.local.json`) and without them the
    /// live per-turn token/input/output counters stay zero — which reads
    /// as broken to users who don't know the hook consent gate exists.
    @ViewBuilder
    private var hookConsentHint: some View {
        HStack(spacing: 4) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text("Live session tokens need hook consent — enable in Settings.")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 2)
    }

    private func compactGauge(label: String, percent: Double, resetTime: String?) -> some View {
        let color = gaugeColor(percent)
        return HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 22, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.black.opacity(0.08))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(color)
                        .frame(width: max(0, min(1, percent / 100.0)) * geo.size.width)
                }
            }
            .frame(height: 6)
            Text("\(Int(percent))%")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(color)
                .frame(width: 36, alignment: .trailing)
            if let reset = resetTime, let formatted = formatResetTime(reset) {
                Text(formatted)
                    .font(.system(size: 10, weight: percent >= 70 ? .semibold : .regular))
                    .foregroundStyle(percent >= 70 ? .orange : .secondary)
                    .frame(width: 48, alignment: .trailing)
            }
        }
    }

    // MARK: - Compact services

    // MARK: - Pill-style action bar (from Option D design)

    private var pillActionsBar: some View {
        HStack(spacing: 6) {
            pillButton(label: "Launch", primary: true) { openLaunchSession() }
            pillButton(label: "Dashboard") { openDashboard() }
            pillButton(label: "Evaluation") { openApmeDashboard() }
                .disabled(daemonService.port == 0)
                .daemonOfflineAffordance(isOffline: daemonService.port == 0)
            Spacer()
            settingsPillButton
        }
    }

    // MARK: - Daemon offline banner

    /// True when the daemon has no bound port AND we aren't in a transient
    /// "starting up" window. We only surface the banner when the user's
    /// actions are actually blocked, not during the ~1s window between
    /// app launch and the in-process daemon completing its bind.
    private var showDaemonOfflineBanner: Bool {
        daemonService.port == 0
            && !daemonService.isRunning
            && !daemonService.isUsingExternalDaemon
    }

    private var daemonOfflineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "bolt.slash.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("Daemon offline")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color(red: 0.102, green: 0.102, blue: 0.122))
                Text("Evaluation · Pair iPad · Preview require the daemon to be running.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Button {
                Task { await daemonService.restart() }
            } label: {
                Text("Restart")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(Color.orange)
                    )
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Color.orange.opacity(0.10))
        .overlay(
            Rectangle()
                .fill(Color.orange.opacity(0.35))
                .frame(height: 0.5),
            alignment: .bottom
        )
    }

    private func pillButton(
        label: String,
        primary: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(primary ? .white : Color(red: 0.102, green: 0.102, blue: 0.122))
                .padding(.horizontal, 11)
                .padding(.vertical, 5)
                .background(
                    Capsule()
                        .fill(primary ? Color(red: 0.102, green: 0.102, blue: 0.122) : Color.black.opacity(0.06))
                )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var settingsPillButton: some View {
        if #available(macOS 14.0, *) {
            SettingsLink {
                Image(systemName: "gearshape")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(Color(red: 0.102, green: 0.102, blue: 0.122))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.black.opacity(0.06)))
            }
            .buttonStyle(.plain)
            .help("Open Settings")
            .simultaneousGesture(TapGesture().onEnded {
                NSApp.activate(ignoringOtherApps: true)
            })
        } else {
            Button {
                NSApp.activate(ignoringOtherApps: true)
                NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(Color(red: 0.102, green: 0.102, blue: 0.122))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.black.opacity(0.06)))
            }
            .buttonStyle(.plain)
        }
    }

    private func stateColor(_ state: AgentConnectionState) -> Color {
        switch state {
        case .processing: .cyan
        case .awaitingPermission, .awaitingOption, .awaitingDiff: .orange
        case .idle: .green
        case .disconnected: .gray
        }
    }

    private func rateLimitGauge(label: String, percent: Double, previousPercent: Double?, resetTime: String?) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 20, alignment: .trailing)
            Text(gaugeString(percent))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(gaugeColor(percent))
            // Trend arrow
            let arrow = trendArrow(percent, previousPercent)
            if !arrow.isEmpty {
                Text(arrow)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(arrow == "↑" ? .red : .green)
            }
            if let reset = resetTime, let formatted = formatResetTime(reset) {
                Text(formatted)
                    .font(.system(size: 10, weight: percent >= 70 ? .semibold : .regular))
                    .foregroundStyle(percent >= 70 ? .orange : .secondary)
            }
        }
    }


    /// Send the user to Elgato's downloads landing page. We intentionally pick
    /// the top-level /downloads URL instead of a versioned .dmg link so the
    /// page keeps working when Elgato ships new versions.
    private func openStreamDeckDownloadPage() {
        if let url = URL(string: "https://www.elgato.com/downloads") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Prefer a bundled `.streamDeckPlugin` bundle (when we start shipping it
    /// inside AgentDeck.app/Contents/Resources/plugin). Fall back to the
    /// GitHub releases landing page so the button is never a dead end on
    /// builds that don't bundle the plugin yet.
    private func openStreamDeckPluginInstaller() {
        if let bundled = Bundle.main.url(
            forResource: "bound.serendipity.agentdeck",
            withExtension: "streamDeckPlugin",
            subdirectory: "plugin"
        ) {
            NSWorkspace.shared.open(bundled)
            return
        }
        if let url = URL(string: "https://github.com/puritysb/AgentDeck/releases/latest") {
            NSWorkspace.shared.open(url)
        }
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

    private func agentTypeLabel(_ type: String) -> String {
        displayAgentLabel(type)
    }

    private func shortModelName(_ name: String) -> String {
        displayShortModelName(name)
    }

    /// Get current tool name for a session (only available for primary session)
    private func currentToolFor(_ session: SessionInfo) -> String? {
        if session.id == stateHolder.state.sessionId {
            return stateHolder.state.currentTool
        }
        return nil
    }

    private func relativeTimeString(from isoString: String?) -> String? {
        displayRelativeTime(isoString)
    }

    private func openDashboard() {
        // SwiftUI's openWindow brings an existing window of this scene to front
        // if one exists, otherwise creates it. Avoids fragile title string matching.
        openWindow(id: "dashboard")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func openLaunchSession() {
        openWindow(id: "launch-session")
        // Activate app so window gets focus (menu bar apps default to .accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    /// Open the in-app APME dashboard window (WKWebView pointing at the
    /// rich SPA served by the local daemon at /apme). One click → full
    /// APME UI with run history, category scorecard, timeline, and eval
    /// axes breakdown — no more digging through sqlite, no browser
    /// roundtrip, no token in address bar history.
    private func openApmeDashboard() {
        guard daemonService.port > 0 else { return }
        openWindow(id: "apme-dashboard")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    /// Open the Device Preview window. Safe to call whether or not any
    /// hardware is connected — this is the whole point of the window.
    private func openDevicePreview() {
        openWindow(id: "device-preview")
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

    /// Returns "↑" if usage increased, "↓" if decreased, "" if no significant change
    private func trendArrow(_ current: Double?, _ previous: Double?) -> String {
        guard let current, let previous else { return "" }
        let diff = current - previous
        if diff > 1 { return "↑" }
        if diff < -1 { return "↓" }
        return ""
    }

    /// Format subscription renewal date — accepts ISO 8601 or passthrough.
    /// Produces compact "Apr 19" style output; falls back to input when
    /// parsing fails (some backends return short-form strings already).
    private func formatSubscriptionDate(_ input: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = iso.date(from: input) ?? ISO8601DateFormatter().date(from: input)
        guard let date = parsed else { return input }
        let fmt = DateFormatter()
        fmt.dateFormat = "MMM d"
        return fmt.string(from: date)
    }

}

// `SessionBrand` and `SessionCreatureIcon` live in `UI/Common/SessionBrand.swift`
// so the cross-platform dashboard HUD can reuse them.

/// Lightweight detection struct for Stream Deck companion status.
///
/// `elgatoAppInstalled` — the Stream Deck desktop app (bundle id
/// `com.elgato.StreamDeck`) is present in /Applications or ~/Applications.
/// `streamDeckPlusConnected` — any Elgato HID device (VID `0x0FD9`) is
/// currently attached. We don't care which model since the companion prompt
/// is identical regardless.
///
/// Neither probe opens the HID device (no `IOHIDManagerOpen`), so USB
/// entitlement state doesn't affect detection. Returns `false` on any
/// failure — the Control Tower treats this as a hint, never a hard gate.
struct StreamDeckDetection {
    let elgatoAppInstalled: Bool
    let streamDeckPlusConnected: Bool

    static func detect() -> StreamDeckDetection {
        let appInstalled = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: "com.elgato.StreamDeck"
        ) != nil
        return StreamDeckDetection(
            elgatoAppInstalled: appInstalled,
            streamDeckPlusConnected: detectElgatoHardware()
        )
    }

    /// Enumerate HID devices matching Elgato VID without opening the manager.
    /// `IOHIDManagerCopyDevices` fills a set even under App Sandbox when the
    /// manager isn't opened — matching dictionaries are probed by the kernel,
    /// not the app.
    private static func detectElgatoHardware() -> Bool {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        let matching: [String: Any] = [kIOHIDVendorIDKey: 0x0FD9]
        IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)
        guard let set = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> else {
            return false
        }
        return !set.isEmpty
    }
}
#endif
