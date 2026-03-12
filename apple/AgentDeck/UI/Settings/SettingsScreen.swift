// SettingsScreen.swift — Connection settings + app info

import SwiftUI

struct SettingsScreen: View {
    @Environment(AgentStateHolder.self) private var stateHolder
    @State private var manualUrl = ""

    var body: some View {
        #if os(macOS)
        settingsContent
            .frame(width: 400, height: 300)
        #else
        NavigationStack {
            settingsContent
                .navigationTitle("Settings")
        }
        #endif
    }

    private var settingsContent: some View {
        Form {
            Section("Connection") {
                if stateHolder.connection.status == .connected {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Connected")
                        Spacer()
                        if let url = stateHolder.connection.url {
                            Text(url)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("Disconnect", role: .destructive) {
                        stateHolder.disconnectBridge()
                    }
                } else {
                    HStack {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.red)
                        Text("Disconnected")
                    }

                    if stateHolder.connection.isReconnecting {
                        HStack {
                            ProgressView()
                                .controlSize(.small)
                            Text("Reconnecting (attempt \(stateHolder.connection.reconnectAttempt))...")
                                .font(.caption)
                        }
                    }
                }
            }

            Section("Manual Connection") {
                TextField("ws://192.168.1.x:9120", text: $manualUrl)
                    #if os(iOS)
                    .autocapitalization(.none)
                    .keyboardType(.URL)
                    #endif

                Button("Connect") {
                    guard !manualUrl.isEmpty else { return }
                    stateHolder.connectTo(url: manualUrl)
                }
                .disabled(manualUrl.isEmpty)
            }

            Section("Discovery") {
                Toggle("mDNS Auto-Discovery", isOn: .constant(true))
                    .disabled(true)

                if stateHolder.discovery.isSearching {
                    HStack {
                        ProgressView()
                            .controlSize(.small)
                        Text("Searching...")
                    }
                }

                ForEach(stateHolder.discovery.bridges) { bridge in
                    Button {
                        stateHolder.connectTo(bridge)
                    } label: {
                        HStack {
                            Text(bridge.project ?? bridge.name)
                            Spacer()
                            Text("\(bridge.host):\(bridge.port)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section("About") {
                LabeledContent("App", value: "AgentDeck")
                LabeledContent("Version", value: "1.0.0")
                LabeledContent("Bundle ID", value: "dev.agentdeck.dashboard")
            }
        }
    }
}
