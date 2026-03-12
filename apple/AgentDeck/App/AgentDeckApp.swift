// AgentDeckApp.swift — Universal app entry point (iOS + macOS)

import SwiftUI

@main
struct AgentDeckApp: App {
    @State private var stateHolder = AgentStateHolder()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(stateHolder)
        }
        #if os(macOS)
        Settings {
            SettingsScreen()
                .environment(stateHolder)
        }
        #endif
    }
}
