// MonitorScreen.swift — Single screen: terrarium + HUD + timeline + settings gear

import SwiftUI

struct MonitorScreen: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif

    @State private var terrariumState = TerrariumState()
    #if os(iOS)
    @State private var showSettingsSheet = false
    #endif
    @State private var previousAgentState: AgentConnectionState = .disconnected
    @StateObject private var toastManager = ToastManager()

    private let sandFraction: CGFloat = 0.35

    /// Content-based key for sibling state changes (triggers terrarium update)
    private var siblingStatesKey: String {
        stateHolder.state.siblingSessions
            .map { "\($0.id):\($0.state ?? "")" }
            .joined(separator: ",")
    }

    var body: some View {
        mainContent
            #if os(iOS)
            .sheet(isPresented: $showSettingsSheet) {
                SettingsScreen()
                    .environmentObject(stateHolder)
                    .environmentObject(preferences)
            }
            #endif
            .onAppear {
                previousAgentState = stateHolder.state.state
                updateTerrariumState()
            }
            .modifier(StateChangeModifier(
                stateHolder: stateHolder,
                siblingStatesKey: siblingStatesKey,
                previousAgentState: $previousAgentState,
                toastManager: toastManager,
                updateTerrariumState: updateTerrariumState
            ))
            #if os(macOS)
            .modifier(KeyboardShortcutsModifier(stateHolder: stateHolder))
            #endif
    }

    // MARK: - Main Content

    private var mainContent: some View {
        GeometryReader { geo in
            ZStack {
                terrariumLayer

                if !stateHolder.state.bridgeConnected {
                    ConnectionOverlay()
                } else {
                    hudLayer(geo: geo)
                }

                settingsLayer

                toastLayer(geo: geo)

                #if os(macOS)
                if shouldShowEmptyGuide {
                    MonitorEmptyGuideOverlay(
                        onLaunchSession: { openWindow(id: "launch-session") },
                        onPreviewDevices: { openWindow(id: "device-preview") },
                        onDismiss: { preferences.hasSeenMonitorEmptyGuide = true }
                    )
                    .transition(.opacity)
                }
                #endif
            }
        }
    }

    /// Show the first-run Monitor guide only when the bridge is connected
    /// (so we don't stack on top of `ConnectionOverlay`), the user has
    /// no live sessions yet, and they haven't dismissed the card before.
    private var shouldShowEmptyGuide: Bool {
        stateHolder.state.bridgeConnected
            && stateHolder.state.siblingSessions.isEmpty
            && !preferences.hasSeenMonitorEmptyGuide
    }

    // MARK: - Sub-views

    private var terrariumLayer: some View {
        TerrariumView(
            terrariumState: terrariumState,
            onCreatureTapped: handleCreatureTap
        )
        .ignoresSafeArea()
    }

    @ViewBuilder
    private func hudLayer(geo: GeometryProxy) -> some View {
        MonitorHUD()

        if preferences.showTimeline {
            VStack {
                Spacer()
                TimelineStripView()
                    .frame(height: geo.size.height * sandFraction)
            }
        }
    }

    @ViewBuilder
    private var settingsLayer: some View {
        if preferences.showSettingsButton {
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    #if os(iOS)
                    rotationButton
                    #endif
                    Button {
                        openSettings()
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.6))
                            .padding(.vertical, 16)
                            .padding(.trailing, 24)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    #if os(iOS)
    private var rotationButton: some View {
        Button {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            let prefs: UIWindowScene.GeometryPreferences.iOS
            if scene.interfaceOrientation.isLandscape {
                prefs = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: .portrait)
            } else {
                prefs = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: .landscapeRight)
            }
            scene.requestGeometryUpdate(prefs)
        } label: {
            Image(systemName: "rectangle.portrait.rotate")
                .font(.title3)
                .foregroundStyle(.white.opacity(0.35))
                .padding(.vertical, 16)
                .padding(.trailing, 4)
        }
        .buttonStyle(.plain)
    }
    #endif

    @ViewBuilder
    private func toastLayer(geo: GeometryProxy) -> some View {
        if let toast = toastManager.currentToast {
            VStack {
                Spacer()
                ToastOverlay(message: toast.message, icon: toast.icon)
                    .padding(.bottom, geo.size.height * sandFraction + 8)
            }
            .animation(.easeInOut(duration: 0.3), value: toast.message)
        }
    }

    // MARK: - Actions

    private func openSettings() {
        #if os(macOS)
        NSApp.activate(ignoringOtherApps: true)
        if #available(macOS 14.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
        #else
        showSettingsSheet = true
        #endif
    }

    private func handleCreatureTap(_ sessionId: String) {
        guard sessionId != "crayfish" else { return }
        stateHolder.sendCommand(.focusSession(sessionId: sessionId))
    }

    private func updateTerrariumState() {
        terrariumState = stateHolder.state.toTerrariumState(previous: terrariumState)
    }
}

// MARK: - State Change Modifier

/// Extracts onChange handlers to reduce body complexity for the Swift type-checker.
private struct StateChangeModifier: ViewModifier {
    @ObservedObject var stateHolder: AgentStateHolder
    let siblingStatesKey: String
    @Binding var previousAgentState: AgentConnectionState
    let toastManager: ToastManager
    let updateTerrariumState: () -> Void

    func body(content: Content) -> some View {
        content
            .onChange(of: stateHolder.state.state) {
                let newState = stateHolder.state.state
                handleStateTransition(from: previousAgentState, to: newState)
                previousAgentState = newState
                updateTerrariumState()
            }
            .onChange(of: stateHolder.state.siblingSessions.count) {
                updateTerrariumState()
            }
            .onChange(of: siblingStatesKey) {
                updateTerrariumState()
            }
            .onChange(of: stateHolder.state.gatewayAvailable) {
                updateTerrariumState()
            }
            .onChange(of: stateHolder.state.gatewayHasError) {
                updateTerrariumState()
            }
    }

    private func handleStateTransition(from oldState: AgentConnectionState, to newState: AgentConnectionState) {
        guard oldState != newState else { return }

        if oldState == .processing && newState.isAwaiting {
            toastManager.show(message: "Attention needed", icon: "exclamationmark.triangle")
        } else if oldState == .processing && newState == .idle {
            toastManager.show(message: "Task complete", icon: "checkmark.circle")
        } else if oldState == .idle && newState == .processing {
            toastManager.show(message: "Working...", icon: "bolt.fill")
        }
    }
}

// MARK: - Keyboard Shortcuts (macOS only)

#if os(macOS)
private struct KeyboardShortcutsModifier: ViewModifier {
    @ObservedObject var stateHolder: AgentStateHolder

    func body(content: Content) -> some View {
        content
            .focusable()
            .onKeyPress(phases: .down) { keyPress in
                guard keyPress.modifiers.contains(.command) else { return .ignored }
                return handleCommandKey(keyPress.key)
            }
    }

    private func handleCommandKey(_ key: KeyEquivalent) -> KeyPress.Result {
        switch key {
        case .return:
            // Cmd+Return: Send "go on" to focused session
            stateHolder.sendCommand(.respond(value: "go on"))
            return .handled
        case KeyEquivalent("y"):
            // Cmd+Y: Yes/approve for awaiting session
            guard stateHolder.state.state.isAwaiting else { return .ignored }
            stateHolder.sendCommand(.selectOption(index: 0))
            return .handled
        case KeyEquivalent("n"):
            // Cmd+N: No/reject
            guard stateHolder.state.state.isAwaiting else { return .ignored }
            stateHolder.sendCommand(.selectOption(index: 1))
            return .handled
        case KeyEquivalent("."):
            // Cmd+.: Interrupt/Stop
            stateHolder.sendCommand(.interrupt)
            return .handled
        default:
            return .ignored
        }
    }
}
#endif

// MARK: - Monitor Empty-State Onboarding Overlay (macOS)

#if os(macOS)
/// First-run guidance card that surfaces when the Monitor has no live
/// sessions. Routes the user into the menubar's "Launch Session" window or
/// the "Device Preview" gallery so the terrarium never reads as broken on
/// day one. Dismiss flips `AppPreferences.hasSeenMonitorEmptyGuide` so
/// returning users aren't re-nudged.
private struct MonitorEmptyGuideOverlay: View {
    let onLaunchSession: () -> Void
    let onPreviewDevices: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 8) {
                Text("Start your first session.")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(TerrariumHUD.text)
                    .multilineTextAlignment(.center)

                bodyText
                    .font(.system(size: 13))
                    .foregroundStyle(TerrariumHUD.subtext)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Button {
                    onLaunchSession()
                } label: {
                    Label("Launch Session", systemImage: "play.fill")
                        .font(.system(size: 12, weight: .medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)

                Button {
                    onPreviewDevices()
                } label: {
                    Label("Preview Devices", systemImage: "rectangle.on.rectangle")
                        .font(.system(size: 12, weight: .medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
            }

            Button {
                onDismiss()
            } label: {
                Text("Got it")
                    .font(.system(size: 12))
                    .foregroundStyle(TerrariumHUD.subtext)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .frame(maxWidth: 420)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(TerrariumHUD.bg)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(TerrariumHUD.tetraNeon.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.4), radius: 18, y: 6)
    }

    /// Built as Text concatenation so we keep the same color/size while
    /// bolding the two action names the user is meant to find in the UI.
    private var bodyText: Text {
        Text("Click ")
            + Text("Launch Session").bold()
            + Text(" in the menubar to start Claude Code here with full monitoring. Or click ")
            + Text("Preview Devices").bold()
            + Text(" to see what AgentDeck renders on hardware before you hook anything up.")
    }
}
#endif
