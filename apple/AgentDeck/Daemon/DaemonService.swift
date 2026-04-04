#if os(macOS)
// DaemonService.swift — In-process daemon lifecycle manager
// Wraps DaemonServer for use within the macOS SwiftUI app
import Foundation
import ServiceManagement
import Combine

/// Manages the daemon lifecycle within the main app process.
/// On macOS, starts WS server, mDNS, hook server, etc. as part of the app.
@MainActor
final class DaemonService: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var isUsingExternalDaemon = false
    @Published private(set) var port: UInt16 = 0
    @Published private(set) var connectedClients = 0
    @Published private(set) var errorMessage: String?

    /// Called when daemon starts — provides ws://localhost:PORT URL for dashboard connection
    var onReady: ((String) -> Void)? {
        didSet {
            if let readyUrl, let onReady {
                onReady(readyUrl)
            }
        }
    }

    private var server: DaemonServer?
    private var isStarting = false
    private var readyUrl: String?
    private var healthMonitorTask: Task<Void, Never>?
    private var externalFailureCount = 0
    private var localFailureCount = 0
    private var signalSource: DispatchSourceSignal?

    init() {
        startHealthMonitor()
        start()
        setupSignalHandler()
    }

    /// Start daemon in-process
    func start() {
        guard !isRunning, !isUsingExternalDaemon, !isStarting else { return }
        isStarting = true
        errorMessage = nil

        Task {
            defer { self.isStarting = false }
            do {
                let daemon = try await DaemonServer(port: nil, debug: false)
                self.server = daemon
                self.port = daemon.port
                self.isRunning = true
                self.isUsingExternalDaemon = false
                self.localFailureCount = 0
                self.externalFailureCount = 0
                self.errorMessage = nil

                // Run daemon (sets up routes, handlers, polling — does NOT block)
                await daemon.startServices()

                // Notify dashboard to connect to local daemon
                let wsUrl = "ws://127.0.0.1:\(daemon.port)"
                self.readyUrl = wsUrl
                DaemonLogger.shared.info("Daemon ready — dashboard can connect to \(wsUrl)")
                self.onReady?(wsUrl)
            } catch DaemonError.alreadyRunning(let port) {
                // Another daemon (e.g. Node.js) is running — connect as client instead
                await self.connectToExternalDaemon(port: port)
            } catch {
                self.server = nil
                self.isRunning = false
                self.isUsingExternalDaemon = false
                self.port = 0
                self.readyUrl = nil
                self.errorMessage = "Daemon failed: \(error.localizedDescription)"
                DaemonLogger.shared.error(self.errorMessage!)
            }
        }
    }

    /// Stop daemon
    func stop() async {
        healthMonitorTask?.cancel()
        healthMonitorTask = nil
        await server?.shutdown()
        server = nil
        isRunning = false
        isUsingExternalDaemon = false
        port = 0
        readyUrl = nil
    }

    private func connectToExternalDaemon(port knownPort: Int? = nil) async {
        let registry = SessionRegistry.shared
        let resolvedPort = knownPort
            ?? registry.findDaemonPort()
            ?? registry.readDaemonInfo()?.port
            ?? registry.findExistingDaemon()?.port

        guard let resolvedPort else {
            self.server = nil
            self.isRunning = false
            self.isUsingExternalDaemon = false
            self.port = 0
            self.readyUrl = nil
            self.errorMessage = "External daemon detected, but port lookup failed"
            DaemonLogger.shared.error(self.errorMessage!)
            return
        }

        let maxAttempts = knownPort != nil ? 12 : 3
        var health: [String: Any]?
        for attempt in 0..<maxAttempts {
            health = await registry.probeDaemonHealth(port: resolvedPort)
            if health?["mode"] as? String == "daemon" {
                break
            }
            if attempt < maxAttempts - 1 {
                try? await Task.sleep(for: .milliseconds(knownPort != nil ? 300 : 200))
            }
        }

        guard let health, health["mode"] as? String == "daemon" else {
            self.server = nil
            self.isRunning = false
            self.isUsingExternalDaemon = false
            self.port = 0
            self.readyUrl = nil
            self.errorMessage = "Stale external daemon registry on port \(resolvedPort)"
            DaemonLogger.shared.error(self.errorMessage!)
            return
        }

        let wsUrl = "ws://127.0.0.1:\(resolvedPort)"
        self.server = nil
        self.port = UInt16(resolvedPort)
        self.isRunning = false
        self.isUsingExternalDaemon = true
        self.localFailureCount = 0
        self.externalFailureCount = 0
        self.errorMessage = nil
        self.readyUrl = wsUrl
        DaemonLogger.shared.info("External daemon detected on port \(resolvedPort) — connecting as client")
        self.onReady?(wsUrl)
    }

    private func startHealthMonitor() {
        healthMonitorTask?.cancel()
        healthMonitorTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await self.checkDaemonHealth()
            }
        }
    }

    private func checkDaemonHealth() async {
        let currentPort = Int(port)
        guard currentPort > 0 else { return }

        let registry = SessionRegistry.shared
        let health = await registry.probeDaemonHealth(port: currentPort)
        let daemonAlive = (health?["mode"] as? String) == "daemon"

        if isUsingExternalDaemon {
            if daemonAlive {
                externalFailureCount = 0
                return
            }

            externalFailureCount += 1
            guard externalFailureCount >= 2, !isStarting else { return }
            DaemonLogger.shared.error("External daemon on port \(currentPort) disappeared — promoting this app to own the daemon")
            server = nil
            isRunning = false
            isUsingExternalDaemon = false
            port = 0
            readyUrl = nil
            errorMessage = nil
            externalFailureCount = 0
            start()
            return
        }

        guard isRunning else { return }

        if daemonAlive {
            localFailureCount = 0
            return
        }

        localFailureCount += 1
        guard localFailureCount >= 2, !isStarting else { return }
        DaemonLogger.shared.error("Local daemon on port \(currentPort) is no longer healthy — restarting in-process daemon")
        localFailureCount = 0
        await server?.shutdown()
        server = nil
        isRunning = false
        isUsingExternalDaemon = false
        port = 0
        readyUrl = nil
        errorMessage = nil
        start()
    }

    // MARK: - Signal Handling

    private func setupSignalHandler() {
        // Ignore default SIGTERM behavior so DispatchSource handles it
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in
            DaemonLogger.shared.info("SIGTERM received — initiating clean shutdown")
            // Log crash info
            let home = FileManager.default.homeDirectoryForCurrentUser
            let crashLog = home.appendingPathComponent(".agentdeck/daemon-crash.log")
            let entry = "[\(ISO8601DateFormatter().string(from: Date()))] SIGTERM — clean shutdown initiated\n"
            if let data = entry.data(using: .utf8) {
                if FileManager.default.fileExists(atPath: crashLog.path) {
                    if let handle = try? FileHandle(forWritingTo: crashLog) {
                        handle.seekToEndOfFile()
                        handle.write(data)
                        handle.closeFile()
                    }
                } else {
                    try? data.write(to: crashLog)
                }
            }
            Task { @MainActor in
                await self?.stop()
                exit(0)
            }
        }
        source.resume()
        self.signalSource = source
    }

    // MARK: - Login Item (auto-start at login)

    func registerLoginItem() {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            do {
                try service.register()
                DaemonLogger.shared.info("Registered as login item")
            } catch {
                DaemonLogger.shared.error("Failed to register login item: \(error)")
            }
        }
    }

    func unregisterLoginItem() {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            do {
                try service.unregister()
            } catch {
                DaemonLogger.shared.error("Failed to unregister login item: \(error)")
            }
        }
    }

    var isLoginItemEnabled: Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }
}
#endif
