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
    @StateObject private var daemonService: DaemonService
    @Environment(\.openWindow) private var openWindow

    init() {
        // Enforce single-instance: activate existing instance and exit if one is running.
        // Install cleanup handlers to remove daemon.json on any exit path (crash, signal).
        _ = SingletonGuard.enforce()
        SingletonGuard.installCleanupHandlers()
        // One-shot migration from legacy ~/.agentdeck/ (pre-sandbox builds) into
        // the App Group container. Best-effort; per-file errors are logged but
        // never thrown so startup never blocks on migration.
        _ = AgentDeckPaths.migrateLegacyDataIfNeeded()
        _daemonService = StateObject(wrappedValue: DaemonService())
    }
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

        Window("Launch Session", id: "launch-session") {
            LaunchSessionDialog(daemonPort: daemonService.port)
                .environmentObject(daemonService)
                .environmentObject(preferences)
        }
        .defaultPosition(.center)
        .defaultSize(width: 420, height: 340)
        .windowResizability(.contentSize)

        // APME evaluation dashboard — embedded WKWebView pointing at the
        // in-process daemon's /apme HTTP endpoint. Opens from the menu bar
        // without launching an external browser.
        Window("APME Dashboard", id: "apme-dashboard") {
            ApmeDashboardWindow()
                .environmentObject(daemonService)
        }
        .defaultPosition(.center)
        .defaultSize(width: 1100, height: 760)

        // Device Preview window — sidebar-driven gallery of every device type
        // AgentDeck can drive. Users without hardware can see what sessions
        // look like on each surface; everyone can debug rendering tweaks
        // without touching a physical device.
        Window("Device Preview", id: "device-preview") {
            DevicePreviewScreen()
                .environmentObject(preferences)
        }
        .defaultPosition(.center)
        .defaultSize(width: 1100, height: 760)
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
                .environmentObject(daemonService)
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

        // First-launch notification permission prompt. Delayed 1.5s so the
        // dashboard has drawn before our explanatory NSAlert appears —
        // otherwise the alert stacks on a black/empty window and looks
        // like a blocker. The helper is idempotent.
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            await NotificationPermission.requestIfNeeded()
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
        // Remove daemon.json FIRST — it's a fast file op and prevents stale-guard
        // deadlocks on the next app launch even if the async shutdown below hangs.
        SingletonGuard.removeDaemonInfoFile()

        let semaphore = DispatchSemaphore(value: 0)
        Task {
            await daemonService?.stop()
            semaphore.signal()
        }
        let result = semaphore.wait(timeout: .now() + 10)
        if result == .timedOut {
            NSLog("[AgentDeck] Shutdown exceeded 10s — forcing exit")
            // daemon.json already removed above; just exit
        }
    }

    /// Ensure clean exit when the last window closes if the app was launched
    /// as a regular app (not via login item). Prevents zombie processes.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // MenuBarExtra keeps the app running — this only affects cases where no
        // menu bar icon is active. Return false to keep the menu bar alive.
        return false
    }
}
#endif
