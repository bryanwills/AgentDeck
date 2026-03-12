// ConnectionOverlay.swift — Discovery + manual connect UI

import SwiftUI

struct ConnectionOverlay: View {
    @Environment(AgentStateHolder.self) private var stateHolder
    @State private var manualUrl = ""
    @State private var showManualEntry = false

    var body: some View {
        VStack(spacing: 24) {
            // Logo area
            VStack(spacing: 8) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 48))
                    .foregroundStyle(.cyan)
                Text("AgentDeck")
                    .font(.title.bold())
                    .foregroundStyle(.white)
                Text("Searching for bridges...")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Discovered bridges
            if !stateHolder.discovery.bridges.isEmpty {
                VStack(spacing: 8) {
                    ForEach(stateHolder.discovery.bridges) { bridge in
                        Button {
                            stateHolder.connectTo(bridge)
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(bridge.project ?? bridge.name)
                                        .font(.headline)
                                    Text("\(bridge.host):\(bridge.port)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let agent = bridge.agentType {
                                    Text(agent)
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.blue.opacity(0.2), in: Capsule())
                                }
                                Image(systemName: "arrow.right.circle.fill")
                                    .foregroundStyle(.cyan)
                            }
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if stateHolder.discovery.isSearching {
                ProgressView()
                    .tint(.cyan)
            }

            // Manual entry
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
                .padding(.horizontal)
            }

            Button(showManualEntry ? "Hide Manual Entry" : "Enter URL Manually") {
                showManualEntry.toggle()
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            // Error message
            if let error = stateHolder.connection.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
    }
}
