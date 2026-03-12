// ContentView.swift — Tab navigation: Dashboard / Deck / Settings

import SwiftUI

struct ContentView: View {
    @Environment(AgentStateHolder.self) private var stateHolder

    var body: some View {
        TabView {
            MonitorScreen()
                .tabItem {
                    Label("Dashboard", systemImage: "gauge.with.dots.needle.33percent")
                }

            DeckScreen()
                .tabItem {
                    Label("Deck", systemImage: "square.grid.2x2")
                }

            SettingsScreen()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
        .onAppear {
            stateHolder.discovery.startSearching()
        }
    }
}
