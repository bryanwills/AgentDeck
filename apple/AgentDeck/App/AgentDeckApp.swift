// AgentDeckApp.swift — Universal app entry point (iOS + macOS)

import SwiftUI
#if os(macOS)
import ServiceManagement
#endif

@main
struct AgentDeckApp: App {
    @StateObject private var stateHolder = AgentStateHolder()
    @StateObject private var preferences = AppPreferences.shared
    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var daemonService = DaemonService()
    @Environment(\.openWindow) private var openWindow
    #endif

    var body: some Scene {
        #if os(macOS)
        Window("AgentDeck Dashboard", id: "dashboard") {
            ContentView()
                .environmentObject(stateHolder)
                .environmentObject(preferences)
                .task { configureDaemonConnection() }
        }
        .defaultPosition(.center)
        .defaultSize(width: 1280, height: 840)
        #else
        WindowGroup("AgentDeck Dashboard", id: "dashboard") {
            ContentView()
                .environmentObject(stateHolder)
                .environmentObject(preferences)
        }
        #endif
        #if os(macOS)
        Settings {
            SettingsScreen()
                .environmentObject(stateHolder)
                .environmentObject(preferences)
        }
        MenuBarExtra {
            ControlTowerPanel()
                .environmentObject(stateHolder)
                .environmentObject(daemonService)
                .environmentObject(preferences)
        } label: {
            AgentStatusIcon(
                sessions: stateHolder.state.siblingSessions,
                bridgeConnected: stateHolder.state.bridgeConnected
            )
        }
        .menuBarExtraStyle(.window)
        #endif
    }

    #if os(macOS)
    private func configureDaemonConnection() {
        // Wire AppDelegate to daemon service for clean shutdown
        appDelegate.daemonService = daemonService

        daemonService.onReady = { [stateHolder] wsUrl in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                stateHolder.setPreferredLocalBridge(url: wsUrl)
            }
        }

        if preferences.openDashboardOnLaunch {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                openWindow(id: "dashboard")
            }
        }
    }

    // Dashboard visibility / toggle helpers moved to ControlTowerPanel
    #endif
}

#if os(macOS)
/// AppDelegate handles app lifecycle events that SwiftUI doesn't cover,
/// particularly applicationWillTerminate for clean daemon shutdown.
class AppDelegate: NSObject, NSApplicationDelegate {
    var daemonService: DaemonService?

    func applicationWillTerminate(_ notification: Notification) {
        let semaphore = DispatchSemaphore(value: 0)
        Task {
            await daemonService?.stop()
            semaphore.signal()
        }
        let result = semaphore.wait(timeout: .now() + 5)
        if result == .timedOut {
            // Fallback: force remove daemon.json to prevent stale guard on next launch
            SessionRegistry.shared.removeDaemonInfo()
        }
    }
}
#endif
