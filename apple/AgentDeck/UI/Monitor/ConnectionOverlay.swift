// ConnectionOverlay.swift — Discovery + manual connect UI

import SwiftUI

/// Connection-state lexicon — Swift mirror of shared/src/connection-status.ts.
/// Self-connecting clients (this app, Android, ESP32) surface the phase they
/// are actually in; update the TS SSOT and all mirrors together when copy changes.
enum ConnectionLexicon {
    static let searching = "Searching for AgentDeck..."
    static let connecting = "Connecting..."
    static let reconnecting = "Reconnecting..."
    static let searchAgain = "Search Again"
    static let nothingDiscovered = "No AgentDeck found on this network"
}

struct ConnectionOverlay: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @State private var manualUrl = ""
    @State private var showManualEntry = false
    @State private var searchingElapsed: TimeInterval = 0
    @State private var elapsedTimer: Timer?

    // Explicit slate color matching Android SlateText #94A3B8
    // (.secondary is too dim on dark card backgrounds, especially iPad)
    private let slateText = Color(red: 0.58, green: 0.64, blue: 0.72)

    private var isReconnecting: Bool { stateHolder.connection.isReconnecting }

    var body: some View {
        // Scrim + centered card
        ZStack {
            Color(red: 0.059, green: 0.086, blue: 0.157)
                .opacity(0.8)
                .ignoresSafeArea()

            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        VStack(spacing: 16) {
                    // Brand icon + title
                    AgentDeckLogo(size: 80, color: TerrariumHUD.tetraNeon)

                    Text("AgentDeck")
                        .font(.title.bold())
                        .foregroundStyle(.white)

                    // Status subtitle — matches Android logic
                    Text(statusText)
                        .font(.subheadline)
                        .foregroundStyle(slateText)

                    // Local Network permission denied — the browser can never find the
                    // daemon until the user enables it, so guide them there directly
                    // instead of spinning on "Searching…" forever.
                    if stateHolder.discovery.localNetworkDenied {
                        localNetworkDeniedCard
                    }

                    // Reconnecting details (stop button only)
                    if isReconnecting {
                        Button {
                            stateHolder.connection.disconnect()
                        } label: {
                            Text("Stop Reconnecting")
                                .font(.subheadline)
                                .foregroundStyle(slateText)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(slateText.opacity(0.4), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }

                    // Error message + recovery guidance
                    if let error = stateHolder.connection.lastError,
                       stateHolder.connection.status == .disconnected {
                        Text(error)
                            .font(.caption)
                            .monospaced()
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)

                        // Recovery guidance after reconnect failure
                        if !isReconnecting {
                            VStack(spacing: 8) {
                                Text("Check that AgentDeck daemon is running")
                                    .font(.caption)
                                    .foregroundStyle(slateText.opacity(0.7))

                                Button {
                                    stateHolder.startConnectionWaterfall()
                                } label: {
                                    Text(ConnectionLexicon.searchAgain)
                                        .font(.subheadline.bold())
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(.cyan.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 8)
                                                .stroke(.cyan.opacity(0.5), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Connection options (disconnected or reconnecting with WiFi alternatives)
                    if stateHolder.connection.status == .disconnected || isReconnecting {

                        // mDNS discovered bridges — show daemon only
                        // (session bridges don't serve external clients)
                        let daemonBridges = stateHolder.discovery.bridges.filter { $0.agentType == "daemon" }
                        if !daemonBridges.isEmpty {
                            VStack(spacing: 8) {
                                Text(isReconnecting ? "Or connect via WiFi:" : "Discovered")
                                    .font(.caption.bold())
                                    .foregroundStyle(slateText)
                                ForEach(daemonBridges) { bridge in
                                    bridgeRow(bridge, isLocal: false)
                                }
                            }
                        } else if !isReconnecting {
                            // Spinner while searching (not during reconnect)
                            if stateHolder.discovery.isSearching {
                                ProgressView()
                                    .tint(.cyan)
                            }

                            // Hint after 10 seconds of no results
                            if searchingElapsed >= 10 {
                                VStack(spacing: 4) {
                                    Text(ConnectionLexicon.nothingDiscovered)
                                        .font(.caption)
                                        .foregroundStyle(slateText)
                                    Text("Enter URL manually or check local network permission.")
                                        .font(.caption)
                                        .foregroundStyle(slateText.opacity(0.7))
                                        .multilineTextAlignment(.center)
                                }
                            }
                        }
                    }

                    // Manual entry — toggle to expand inline TextField
                    if showManualEntry {
                        HStack {
                            TextField("ws://192.168.1.x:9120", text: $manualUrl)
                                .textFieldStyle(.roundedBorder)
                                #if os(iOS)
                                .autocapitalization(.none)
                                .keyboardType(.URL)
                                #endif

                            Button("Connect") {
                                guard !manualUrl.isEmpty else { return }
                                stateHolder.connectTo(url: manualUrl)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.cyan)
                        }
                    }

                    Button(showManualEntry ? "Hide" : "Enter URL Manually") {
                        showManualEntry.toggle()
                    }
                    .font(.caption)
                    .foregroundStyle(slateText.opacity(0.7))
                }
                .padding(24)
                .frame(maxWidth: 360)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(red: 0.118, green: 0.161, blue: 0.231).opacity(0.9))
                )
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity, minHeight: geo.size.height)
                }
                .scrollIndicators(.hidden)
            }
        }
        .onAppear {
            searchingElapsed = 0
            elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                Task { @MainActor in
                    searchingElapsed += 1
                }
            }
        }
        .onDisappear {
            elapsedTimer?.invalidate()
            elapsedTimer = nil
        }
    }

    // MARK: - Helpers

    /// Shown when iOS Local Network permission is denied — the #1 reason a fresh
    /// install "won't connect." Points the user straight at the toggle.
    private var localNetworkDeniedCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .font(.title2)
                .foregroundStyle(.yellow)
            Text("Local Network access is off")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
            Text("AgentDeck needs Local Network permission to find the daemon on your Wi-Fi. Turn it on, then come back here.")
                .font(.caption)
                .foregroundStyle(slateText)
                .multilineTextAlignment(.center)
            #if os(iOS)
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            } label: {
                Text("Open Settings")
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(.yellow.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.yellow.opacity(0.6), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            #else
            Text("Enable it in System Settings → Privacy & Security → Local Network → AgentDeck.")
                .font(.caption2)
                .foregroundStyle(slateText.opacity(0.7))
                .multilineTextAlignment(.center)
            #endif
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 12).fill(.yellow.opacity(0.08)))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.yellow.opacity(0.3), lineWidth: 1)
        )
    }

    private var statusText: String {
        if isReconnecting {
            return ConnectionLexicon.reconnecting
        } else if stateHolder.isAutoConnecting || stateHolder.connection.status == .connecting {
            return ConnectionLexicon.connecting
        } else {
            return ConnectionLexicon.searching
        }
    }

    private func bridgeRow(_ bridge: DiscoveredBridge, isLocal: Bool) -> some View {
        Button {
            stateHolder.connectTo(bridge)
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(bridge.project ?? bridge.name)
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text(verbatim: "\(bridge.host):\(bridge.port)")
                        .font(.caption)
                        .monospaced()
                        .foregroundStyle(slateText)
                }
                Spacer()
                if isLocal {
                    Text("local")
                        .font(.caption2)
                        .foregroundStyle(.green)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.green.opacity(0.2), in: Capsule())
                }
                if let agent = bridge.agentType {
                    Text(agent)
                        .font(.caption2)
                        .foregroundStyle(.cyan)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.blue.opacity(0.2), in: Capsule())
                }
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundStyle(.cyan)
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(slateText.opacity(0.3), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}
