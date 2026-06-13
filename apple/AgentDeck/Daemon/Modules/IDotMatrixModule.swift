#if os(macOS)
// IDotMatrixModule.swift — iDotMatrix 32×32 BLE LED display support.
//
// Native CoreBluetooth replacement for the Node CLI's Python `idotmatrix/sync.py`,
// so the App Store macOS build can drive an iDotMatrix with no subprocess. Mirrors
// PixooModule's lifecycle/Shadow/circuit-breaker/offline-frame patterns; the transport
// is IDotMatrixBLE (GATT) instead of HTTP. Frames come from the same in-process
// PixooRenderer (64×64 RGB), box-downscaled to 32×32 and PNG-encoded for the device.
//
// Coexistence: the in-process Swift daemon only runs when no external CLI daemon owns
// port 9120 (see DaemonServer header) — so the Node *daemon* and this module are never
// both live. The remaining overlap is a standalone `agentdeck idotmatrix sync` running
// alongside the Swift daemon: BLE allows a single central connection, so whichever
// process holds it drives the display and the other's connect simply fails. The circuit
// breaker below backs off on that failure instead of thrashing.
//
// Only the first configured device is driven (matching the Node sync client, which uses
// devices[0]); additional entries are persisted but logged as not-yet-driven.

import Foundation
import AppKit
@preconcurrency import CoreBluetooth

struct IDotMatrixDevice: Codable, Equatable {
    let address: String   // CBPeripheral.identifier UUID string (macOS-stable)
    var name: String?
    var brightness: Int?
}

private final class IDMSettingsDataBox: @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    func set(_ d: Data?) { lock.lock(); data = d; lock.unlock() }
    func get() -> Data? { lock.lock(); defer { lock.unlock() }; return data }
}

actor IDotMatrixModule: DeviceModule {
    /// Lock-protected mirror for sync cross-actor status reads (DaemonServer health).
    private final class Shadow: @unchecked Sendable {
        private let lock = NSLock()
        private var snapshot: [String: Any] = [
            "configuredDeviceCount": 0,
            "connected": false,
            "deviceName": NSNull(),
            "lastError": NSNull(),
            "displayDimmed": false,
        ]
        func write(_ s: [String: Any]) { lock.lock(); snapshot = s; lock.unlock() }
        func read() -> [String: Any] { lock.lock(); defer { lock.unlock() }; return snapshot }
    }

    nonisolated let name = "idotmatrix"
    private nonisolated let shadow = Shadow()

    private var devices: [IDotMatrixDevice] = []
    private var ble: IDotMatrixBLE?
    private var connected = false
    private var lastError: String?

    // Circuit breaker (mirrors PixooModule)
    private var consecutiveFailures = 0
    private var backoffUntil: Date?
    private let backoffInitialSec: TimeInterval = 5
    private let backoffMaxSec: TimeInterval = 120

    private var renderTask: Task<Void, Never>?
    private var settingsReloadTask: Task<Void, Never>?
    private let renderIntervalSec: TimeInterval = 1.0
    private let settingsReloadIntervalSec: TimeInterval = 5
    private var isPushing = false

    private var onStateChanged: (@Sendable () -> Void)?
    private var lastBroadcastDigest: String?

    private let renderer = PixooRenderer()
    private var lastPushedRGB: [UInt8]?
    private var lastStateDigest: String?

    private var displayDimmed = false
    private var lastDimSignature = ""

    func setOnStateChanged(_ handler: @escaping @Sendable () -> Void) {
        self.onStateChanged = handler
    }

    // MARK: - Lifecycle

    func start() async {
        await reloadDevicesFromSettings(reason: "startup", force: true)
        let renderInterval = renderIntervalSec
        let settingsInterval = settingsReloadIntervalSec

        renderTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(renderInterval))
                await self?.tick()
            }
        }
        settingsReloadTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(settingsInterval))
                await self?.reloadDevicesFromSettings(reason: "settings reload")
            }
        }
        refreshShadow()
    }

    func stop() async {
        renderTask?.cancel(); await renderTask?.value; renderTask = nil
        settingsReloadTask?.cancel(); await settingsReloadTask?.value; settingsReloadTask = nil

        // Graceful teardown: paint OFFLINE then drop the BLE link.
        if connected, let ble, let png = Self.renderPNG(renderer.renderDisconnectedFrame()) {
            try? await ble.uploadImage(pngData: png)
        }
        await ble?.disconnect()
        connected = false
        refreshShadow()
    }

    func handleWake() async {
        await reloadDevicesFromSettings(reason: "wake")
        await ble?.disconnect()
        connected = false
        consecutiveFailures = 0
        backoffUntil = nil
        lastPushedRGB = nil
        lastStateDigest = nil
        refreshShadow()
    }

    nonisolated func statusSnapshot() -> [String: Any] { shadow.read() }

    // MARK: - Settings

    private static let settingsFile = AuthManager.agentDeckDir.appendingPathComponent("settings.json")
    private static let settingsReadQueue = DispatchQueue(label: "dev.agentdeck.idotmatrix.settings-read", qos: .userInteractive)
    private static let settingsReadTimeout: DispatchTimeInterval = .milliseconds(700)

    func reloadFromSettingsExternal() async {
        await reloadDevicesFromSettings(reason: "ui-trigger", force: true)
    }

    private func reloadDevicesFromSettings(reason: String, force: Bool = false) async {
        let latest = Self.loadDevices()
        guard force || latest != devices else { return }

        let previousActive = devices.first?.address
        let previousBrightness = devices.first?.brightness
        devices = latest
        let newActive = devices.first?.address

        if devices.count > 1 {
            DaemonLogger.shared.info("iDotMatrix: \(devices.count) devices configured — driving first only (\(newActive ?? "?"))")
        }

        // If the active device changed/was removed, drop the current link.
        if previousActive != newActive {
            await ble?.disconnect()
            connected = false
            consecutiveFailures = 0
            backoffUntil = nil
            lastPushedRGB = nil
            lastStateDigest = nil
            if newActive == nil {
                DaemonLogger.shared.debug("iDotMatrix", "No devices configured; watching settings.json")
            } else {
                DaemonLogger.shared.info("iDotMatrix \(reason): driving \(newActive!)")
            }
        } else if connected, let newBrightness = devices.first?.brightness, newBrightness != previousBrightness {
            // Same device, brightness changed live (slider) — apply without reconnecting.
            await setBrightness(newBrightness)
        }
        refreshShadow()
    }

    static func loadDevices() -> [IDotMatrixDevice] {
        let box = IDMSettingsDataBox()
        let semaphore = DispatchSemaphore(value: 0)
        settingsReadQueue.async {
            box.set(try? Data(contentsOf: settingsFile))
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + settingsReadTimeout) == .success else { return [] }
        guard let data = box.get(),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = json["idotmatrixDevices"] as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let raw = d["address"] as? String else { return nil }
            let addr = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !addr.isEmpty else { return nil }
            return IDotMatrixDevice(address: addr, name: d["name"] as? String, brightness: d["brightness"] as? Int)
        }
    }

    // MARK: - Render / push loop

    private func tick() async {
        guard let device = devices.first, !displayDimmed else { return }
        guard !isPushing else { return }
        isPushing = true
        defer { isPushing = false }

        // Honor circuit breaker.
        if let until = backoffUntil, Date() < until { return }

        // Ensure connected (lazy-creates the central → triggers the BT permission
        // prompt only for users who actually configured an iDotMatrix).
        if !connected {
            guard await ensureConnected(device) else { return }
        }

        let state = currentDashboardState()
        let isDisconnectedPlaceholder = state.state == .disconnected && cachedAgentType == nil && cachedSessions.isEmpty
        let digest = isDisconnectedPlaceholder ? "offline" : buildStateDigest(state: state)
        guard digest != lastStateDigest || lastPushedRGB == nil else { return }

        let rgb64 = isDisconnectedPlaceholder ? renderer.renderDisconnectedFrame() : renderer.render(dashboardState: state)
        let rgb32 = Self.downscale64to32([UInt8](rgb64))
        if rgb32 == lastPushedRGB { lastStateDigest = digest; return }
        guard let png = Self.rgb32ToPNG(rgb32) else { return }

        guard let ble else { return }
        do {
            try await ble.uploadImage(pngData: png)
            lastPushedRGB = rgb32
            lastStateDigest = digest
            recordSuccess()
        } catch {
            recordFailure("upload: \(error)")
            await dropConnection()
        }
        refreshShadow()
    }

    private func ensureConnected(_ device: IDotMatrixDevice) async -> Bool {
        if ble == nil { ble = IDotMatrixBLE() }
        guard let ble else { return false }
        do {
            try await ble.connect(uuidString: device.address)
            try await ble.setMode(1)                                  // DIY drawing mode
            try await ble.setBrightness(device.brightness ?? 100)
            connected = true
            lastError = nil
            consecutiveFailures = 0
            backoffUntil = nil
            DaemonLogger.shared.info("iDotMatrix connected: \(device.name ?? device.address)")
            refreshShadow()
            return true
        } catch {
            recordFailure("connect: \(error)")
            await dropConnection()
            return false
        }
    }

    private func dropConnection() async {
        connected = false
        lastPushedRGB = nil
        lastStateDigest = nil
        await ble?.disconnect()
        refreshShadow()
    }

    private func recordSuccess() {
        consecutiveFailures = 0
        backoffUntil = nil
        lastError = nil
    }

    private func recordFailure(_ reason: String) {
        consecutiveFailures += 1
        lastError = reason
        let delay = min(backoffInitialSec * pow(2.0, Double(consecutiveFailures - 1)), backoffMaxSec)
        backoffUntil = Date().addingTimeInterval(delay)
        if consecutiveFailures == 1 || consecutiveFailures % 5 == 0 {
            DaemonLogger.shared.error("iDotMatrix failure [\(consecutiveFailures)]: \(reason) — backing off \(Int(delay))s")
        }
    }

    // MARK: - Brightness / dim

    func setBrightness(_ level: Int) async {
        guard connected, let ble else { return }
        do { try await ble.setBrightness(level) } catch { recordFailure("brightness: \(error)"); await dropConnection() }
    }

    // MARK: - Broadcast events (cache for next render) — mirrors PixooModule

    private var cachedState = "disconnected"
    private var cachedProject: String?
    private var cachedModel: String?
    private var cachedTool: String?
    private var cachedAgentType: String?
    private var cachedSessions: [[String: Any]] = []
    private var cached5h: Double?
    private var cached7d: Double?
    private var cached5hResetsAt: String?
    private var cached7dResetsAt: String?
    private var cachedGatewayAvailable = false
    private var cachedGatewayConnected = false
    private var cachedGatewayHasError = false

    func handleEvent(_ event: [String: Any]) {
        guard let type = event["type"] as? String else { return }
        switch type {
        case "state_update":
            let eventAgentType = event["agentType"] as? String
            let creatureAgents: Set<String> = ["claude-code", "codex-cli", "codex-app", "opencode"]
            if let at = eventAgentType, creatureAgents.contains(at) {
                cachedState = event["state"] as? String ?? "disconnected"
                cachedProject = event["projectName"] as? String
                cachedModel = event["modelName"] as? String
                cachedTool = event["currentTool"] as? String
                cachedAgentType = eventAgentType
            } else if cachedAgentType == nil {
                cachedState = event["state"] as? String ?? "disconnected"
                cachedAgentType = eventAgentType
            }
            cachedGatewayAvailable = event["gatewayAvailable"] as? Bool ?? cachedGatewayAvailable
            cachedGatewayConnected = event["gatewayConnected"] as? Bool ?? cachedGatewayConnected
            cachedGatewayHasError = event["gatewayHasError"] as? Bool ?? cachedGatewayHasError
        case "usage_update":
            cached5h = event["fiveHourPercent"] as? Double
            cached7d = event["sevenDayPercent"] as? Double
            cached5hResetsAt = event["fiveHourResetsAt"] as? String
            cached7dResetsAt = event["sevenDayResetsAt"] as? String
        case "sessions_list":
            cachedSessions = event["sessions"] as? [[String: Any]] ?? []
        case "display_state":
            let displayOn = event["displayOn"] as? Bool ?? true
            let dim = event["dim"] as? [String: Any]
            let dimEnabled = dim?["enabled"] as? Bool ?? true
            let dimMode = (dim?["mode"] as? String) == "min" ? "min" : "off"
            let dimLevel = max(5, min(100, dim?["level"] as? Int ?? 10))
            let signature = "\(dimEnabled)|\(dimMode)|\(dimLevel)"
            if !displayOn {
                if !dimEnabled {
                    if displayDimmed { displayDimmed = false; Task { await restoreBrightness() } }
                } else if !displayDimmed || signature != lastDimSignature {
                    displayDimmed = true
                    // No screen-off command wired; minimum brightness is the dim floor.
                    let target = dimMode == "off" ? 5 : dimLevel
                    Task { await setBrightness(target) }
                }
            } else if displayDimmed {
                displayDimmed = false
                Task { await restoreBrightness() }
            }
            lastDimSignature = signature
            refreshShadow()
        default: break
        }
    }

    private func restoreBrightness() async {
        await setBrightness(devices.first?.brightness ?? 100)
    }

    // MARK: - DashboardState assembly (mirrors PixooModule)

    private func currentDashboardState() -> DashboardState {
        var state = DashboardState()
        state.bridgeConnected = cachedState != "disconnected"
        state.sessionId = firstAliveSession(in: cachedSessions)?["id"] as? String
        state.state = AgentConnectionState(rawValue: cachedState) ?? .idle
        state.agentType = cachedAgentType ?? firstAliveSession(in: cachedSessions)?["agentType"] as? String
        state.projectName = cachedProject ?? firstAliveSession(in: cachedSessions)?["projectName"] as? String
        state.modelName = cachedModel
        state.currentTool = cachedTool
        state.fiveHourPercent = cached5h
        state.sevenDayPercent = cached7d
        state.fiveHourResetsAt = cached5hResetsAt
        state.sevenDayResetsAt = cached7dResetsAt
        state.gatewayAvailable = cachedGatewayAvailable
        state.gatewayConnected = cachedGatewayConnected
        state.gatewayHasError = cachedGatewayHasError
        state.siblingSessions = cachedSessions.compactMap(Self.makeSessionInfo)
        return state
    }

    private func firstAliveSession(in sessions: [[String: Any]]) -> [String: Any]? {
        sessions.first { ($0["alive"] as? Bool) ?? true }
    }

    private func buildStateDigest(state: DashboardState) -> String {
        let r5 = renderer.formatResetDetailed(state.fiveHourResetsAt)
        let r7 = renderer.formatResetDetailed(state.sevenDayResetsAt)
        let u5 = state.fiveHourPercent != nil ? Int(floor(state.fiveHourPercent!)) : -1
        let u7 = state.sevenDayPercent != nil ? Int(floor(state.sevenDayPercent!)) : -1
        let sess = state.siblingSessions.map { "\($0.id):\($0.agentType ?? ""):\($0.state ?? "")" }.joined(separator: ",")
        return "\(state.state.rawValue)|\(state.gatewayConnected)|\(state.gatewayHasError)|\(r5)|\(r7)|\(u5)|\(u7)|\(sess)"
    }

    private static func makeSessionInfo(from raw: [String: Any]) -> SessionInfo? {
        guard let id = raw["id"] as? String else { return nil }
        let port: Int
        if let p = raw["port"] as? Int { port = p }
        else if let n = raw["port"] as? NSNumber { port = n.intValue }
        else { port = 0 }
        return SessionInfo(
            id: id, port: port,
            projectName: raw["projectName"] as? String,
            agentType: raw["agentType"] as? String,
            alive: (raw["alive"] as? Bool) ?? true,
            state: raw["state"] as? String
        )
    }

    // MARK: - Shadow / broadcast

    private func refreshShadow() {
        let snapshot: [String: Any] = [
            "configuredDeviceCount": devices.count,
            "connected": connected,
            "deviceName": devices.first?.name ?? devices.first?.address ?? NSNull(),
            "lastError": lastError as Any,
            "displayDimmed": displayDimmed,
        ]
        shadow.write(snapshot)
        let digest = "count=\(devices.count)|conn=\(connected)|dim=\(displayDimmed)|err=\(lastError ?? "")"
        if digest != lastBroadcastDigest {
            lastBroadcastDigest = digest
            onStateChanged?()
        }
    }

    // MARK: - Frame conversion (64×64 RGB → 32×32 PNG)

    /// 2×2 box-average downscale of a 64×64×3 RGB buffer to 32×32×3.
    static func downscale64to32(_ src: [UInt8]) -> [UInt8] {
        guard src.count >= 64 * 64 * 3 else { return [UInt8](repeating: 0, count: 32 * 32 * 3) }
        var out = [UInt8](repeating: 0, count: 32 * 32 * 3)
        for y in 0..<32 {
            for x in 0..<32 {
                for c in 0..<3 {
                    var sum = 0
                    for dy in 0..<2 {
                        for dx in 0..<2 {
                            let sx = x * 2 + dx, sy = y * 2 + dy
                            sum += Int(src[(sy * 64 + sx) * 3 + c])
                        }
                    }
                    out[(y * 32 + x) * 3 + c] = UInt8(sum / 4)
                }
            }
        }
        return out
    }

    /// Encode a 32×32×3 RGB buffer as PNG.
    static func rgb32ToPNG(_ rgb: [UInt8]) -> Data? {
        let w = 32, h = 32
        guard rgb.count == w * h * 3,
              let provider = CGDataProvider(data: Data(rgb) as CFData),
              let cg = CGImage(
                width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 24, bytesPerRow: w * 3,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return nil }
        let rep = NSBitmapImageRep(cgImage: cg)
        return rep.representation(using: .png, properties: [:])
    }

    /// Convenience: 64×64 RGB Data → 32×32 PNG.
    static func renderPNG(_ rgb64: Data) -> Data? {
        rgb32ToPNG(downscale64to32([UInt8](rgb64)))
    }
}
#endif
