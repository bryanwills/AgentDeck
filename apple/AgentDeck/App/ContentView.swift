// ContentView.swift — Single-screen layout: terrarium + HUD + gear icon

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        MonitorScreen()
            .onAppear {
                #if os(iOS)
                stateHolder.startConnectionWaterfall()
                #endif
            }
            .onChange(of: scenePhase) { _, newPhase in
                switch newPhase {
                case .active:
                    stateHolder.handleForegroundReturn()
                case .background:
                    stateHolder.handleBackgroundEntry()
                default:
                    break
                }
            }
    }
}
