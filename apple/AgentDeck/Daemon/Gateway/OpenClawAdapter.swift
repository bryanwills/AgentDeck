#if os(macOS)
// OpenClawAdapter.swift — OpenClaw Gateway WebSocket client
// Ported from bridge/src/adapters/openclaw.ts

import Foundation
import CryptoKit

/// Connects to OpenClaw Gateway via WebSocket, handles Ed25519 auth handshake,
/// and relays events to the daemon.
actor OpenClawAdapter {
    private struct OpenClawModel: Decodable {
        let key: String
        let name: String
        let available: Bool?
        let tags: [String]?
    }

    private struct ModelListResult: Decodable {
        let models: [OpenClawModel]
    }

    private struct DeviceIdentity {
        let deviceId: String
        let publicKeyPem: String
        let privateKey: Curve25519.Signing.PrivateKey
    }

    private struct DeviceAuthToken {
        let token: String
        let role: String
        let scopes: [String]
    }

    private var wsTask: URLSessionWebSocketTask?
    private var reconnectTask: Task<Void, Never>?
    private let gatewayUrl: String
    private var isConnected = false
    private var isStopping = false
    private var pairingRequired = false
    private var reconnectDelay: TimeInterval = 1
    private let maxReconnectDelay: TimeInterval = 30
    private let protocolVersion = 3

    private var currentSessionKey: String?
    private var currentRunId: String?
    private var pendingApprovalId: String?
    private var pendingMethods: [String: String] = [:]
    private var deviceIdentity: DeviceIdentity?
    private var deviceAuthToken: DeviceAuthToken?

    private var _onEvent: (@Sendable ([String: Any]) -> Void)?
    private var _onConnectionChanged: (@Sendable (Bool) -> Void)?

    func setOnEvent(_ handler: @escaping @Sendable ([String: Any]) -> Void) { _onEvent = handler }
    func setOnConnectionChanged(_ handler: @escaping @Sendable (Bool) -> Void) { _onConnectionChanged = handler }

    var isConnectedSnapshot: Bool { isConnected }

    init(gatewayUrl: String = "ws://127.0.0.1:18789") {
        self.gatewayUrl = gatewayUrl
    }

    func start() {
        isStopping = false
        pairingRequired = false
        loadDeviceIdentity()
        Task { await emitModelCatalog() }
        connect()
    }

    func stop() {
        isStopping = true
        reconnectTask?.cancel()
        reconnectTask = nil
        wsTask?.cancel(with: .goingAway, reason: nil)
        wsTask = nil
        let wasConnected = isConnected
        isConnected = false
        if wasConnected {
            self._onConnectionChanged?(false)
        }
    }

    // MARK: - Connection

    private func connect() {
        guard let url = URL(string: gatewayUrl) else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        let task = URLSession.shared.webSocketTask(with: url)
        self.wsTask = task
        task.resume()

        receiveLoop(task)

        // Wait a moment then attempt handshake
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            performHandshake()
        }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task {
                guard let self else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        await self.handleMessage(text)
                    default:
                        break
                    }
                    await self.receiveLoop(task)
                case .failure:
                    await self.handleDisconnect()
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let frameType = json["type"] as? String

        switch frameType {
        case "event":
            if let eventName = json["event"] as? String {
                handleGatewayEvent(eventName, payload: json["payload"] as? [String: Any] ?? [:])
            }
        case "res":
            handleResponse(json)
        default:
            break
        }
    }

    private func handleGatewayEvent(_ event: String, payload: [String: Any]) {
        switch event {
        case "connect.challenge":
            guard let nonce = payload["nonce"] as? String, !nonce.isEmpty else {
                DaemonLogger.shared.debug("OpenClaw", "connect.challenge missing nonce")
                return
            }
            DaemonLogger.shared.debug("OpenClaw", "Challenge nonce: \(String(nonce.prefix(8)))...")
            sendConnectRequest(nonce: nonce)
        case "chat":
            if let runId = payload["runId"] as? String, !runId.isEmpty {
                currentRunId = runId
            }
            if let sessionKey = payload["sessionKey"] as? String, !sessionKey.isEmpty {
                currentSessionKey = sessionKey
            }
            // Chat events (delta, final, aborted, error)
            self._onEvent?(["type": "gateway_chat", "event": event, "payload": payload])
        case "exec.approval.requested":
            pendingApprovalId = payload["id"] as? String
            self._onEvent?(["type": "gateway_approval", "payload": payload])
        case "exec.approval.resolved":
            pendingApprovalId = nil
            self._onEvent?(["type": "gateway_approval_resolved", "payload": payload])
        case "presence":
            self._onEvent?(["type": "gateway_presence", "payload": payload])
        case "health":
            self._onEvent?(["type": "gateway_health", "payload": payload])
        case "tick":
            break // Heartbeat, ignore
        case "shutdown":
            handleDisconnect()
        default:
            self._onEvent?(["type": "gateway_event", "event": event, "payload": payload])
        }
    }

    private func handleResponse(_ json: [String: Any]) {
        let responseId = json["id"] as? String ?? "unknown"
        let method = pendingMethods.removeValue(forKey: responseId)
        let ok = json["ok"] as? Bool ?? false

        DaemonLogger.shared.debug("OpenClaw", "Response: \(responseId) method=\(method ?? "?") ok=\(ok)")

        guard ok else {
            if method == "connect" {
                let errorInfo = json["error"] as? [String: Any]
                let errorCode = errorInfo?["code"] as? String
                    ?? (errorInfo?["details"] as? [String: Any])?["code"] as? String
                DaemonLogger.shared.error("OpenClaw handshake failed: \(json["error"] ?? "unknown" as Any)")

                if errorCode == "NOT_PAIRED" || errorCode == "DEVICE_IDENTITY_REQUIRED" {
                    pairingRequired = true
                    DaemonLogger.shared.error("OpenClaw: Device not paired — stopping reconnect. Pair device then restart.")
                    wsTask?.cancel(with: .goingAway, reason: nil)
                    wsTask = nil
                }
            }
            return
        }

        switch method {
        case "connect":
            markConnectedIfNeeded()
            requestSessionsList()
            Task { await self.emitModelCatalog() }
        case "sessions.list":
            if let payload = json["payload"] as? [String: Any] {
                applySessionsPayload(payload)
            }
        default:
            break
        }
    }

    private func handleDisconnect() {
        let wasConnected = isConnected
        isConnected = false
        wsTask = nil

        if wasConnected {
            self._onConnectionChanged?(false)
        }

        guard !isStopping else { return }

        guard !pairingRequired else {
            scheduleIdentityRecheck()
            return
        }

        // Reconnect with exponential backoff
        let delay = reconnectDelay
        reconnectDelay = min(reconnectDelay * 2, maxReconnectDelay)
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.connect()
        }
    }

    private func scheduleIdentityRecheck() {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled else { return }
            await self?.recheckIdentityAndReconnect()
        }
    }

    private func recheckIdentityAndReconnect() {
        loadDeviceIdentity()
        if deviceIdentity != nil {
            pairingRequired = false
            reconnectDelay = 1
            DaemonLogger.shared.debug("OpenClaw", "Device identity found — resuming connection")
            connect()
        } else {
            DaemonLogger.shared.debug("OpenClaw", "Device still not paired — rechecking in 60s")
            scheduleIdentityRecheck()
        }
    }

    // MARK: - Ed25519 Handshake

    private func performHandshake() {
        // Handshake starts only when Gateway emits connect.challenge.
        // Keep this method to document that the connection is intentionally idle until challenged.
        DaemonLogger.shared.debug("OpenClaw", "WebSocket opened, awaiting connect.challenge")
    }

    private func markConnectedIfNeeded() {
        guard !isConnected else { return }
        isConnected = true
        reconnectDelay = 1
        self._onConnectionChanged?(true)
    }

    private func loadDeviceIdentity() {
        let realHome = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        let identityDir = URL(fileURLWithPath: realHome).appendingPathComponent(".openclaw/identity")
        let deviceFile = identityDir.appendingPathComponent("device.json")
        let authFile = identityDir.appendingPathComponent("device-auth.json")

        guard let data = try? Data(contentsOf: deviceFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let deviceId = json["deviceId"] as? String,
              let publicKeyPem = json["publicKeyPem"] as? String,
              let privateKeyPem = json["privateKeyPem"] as? String else {
            deviceIdentity = nil
            deviceAuthToken = nil
            DaemonLogger.shared.debug("OpenClaw", "Device identity not available")
            return
        }

        // Parse PEM to raw key bytes
        guard let keyData = pemToRawKey(privateKeyPem) else {
            deviceIdentity = nil
            deviceAuthToken = nil
            DaemonLogger.shared.error("OpenClaw: Failed to parse private key PEM")
            return
        }

        do {
            let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
            deviceIdentity = DeviceIdentity(
                deviceId: deviceId,
                publicKeyPem: publicKeyPem,
                privateKey: privateKey
            )
        } catch {
            deviceIdentity = nil
            deviceAuthToken = nil
            DaemonLogger.shared.error("OpenClaw: Failed to load private key: \(error)")
            return
        }

        if let authData = try? Data(contentsOf: authFile),
           let authJson = try? JSONSerialization.jsonObject(with: authData) as? [String: Any],
           let tokens = authJson["tokens"] as? [String: Any],
           let operatorToken = tokens["operator"] as? [String: Any],
           let token = operatorToken["token"] as? String,
           let role = operatorToken["role"] as? String,
           let scopes = operatorToken["scopes"] as? [String] {
            deviceAuthToken = DeviceAuthToken(token: token, role: role, scopes: scopes)
        } else {
            deviceAuthToken = nil
        }
        DaemonLogger.shared.debug("OpenClaw", "Device identity loaded: \(String(deviceId.prefix(16)))...")
    }

    private func pemToRawKey(_ pem: String) -> Data? {
        let lines = pem.components(separatedBy: "\n")
            .filter { !$0.hasPrefix("-----") && !$0.isEmpty }
        let base64 = lines.joined()
        guard let derData = Data(base64Encoded: base64) else { return nil }
        // SPKI DER has 12-byte prefix for Ed25519
        if derData.count == 44 {
            return derData.suffix(32) // Strip SPKI prefix
        }
        if derData.count == 32 {
            return derData
        }
        // PKCS8 has 16-byte prefix
        if derData.count == 48 {
            return derData.suffix(32)
        }
        return nil
    }

    // MARK: - RPC

    func sendRPC(method: String, params: [String: Any]) {
        guard let wsTask else {
            DaemonLogger.shared.debug("OpenClaw", "Skipping RPC \(method): gateway socket is not connected")
            return
        }
        var resolvedParams = params
        switch method {
        case "chat.send":
            if resolvedParams["sessionKey"] == nil, let sessionKey = currentSessionKey {
                resolvedParams["sessionKey"] = sessionKey
            }
            if resolvedParams["idempotencyKey"] == nil {
                resolvedParams["idempotencyKey"] = UUID().uuidString
            }
        case "chat.abort":
            if resolvedParams["sessionKey"] == nil, let sessionKey = currentSessionKey {
                resolvedParams["sessionKey"] = sessionKey
            }
            if resolvedParams["runId"] == nil, let runId = currentRunId {
                resolvedParams["runId"] = runId
            }
        case "exec.approval.resolve":
            if resolvedParams["id"] == nil, let pendingApprovalId {
                resolvedParams["id"] = pendingApprovalId
            }
        default:
            break
        }

        let requestId = UUID().uuidString
        let frame: [String: Any] = [
            "type": "req",
            "id": requestId,
            "method": method,
            "params": resolvedParams,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: frame),
              let text = String(data: data, encoding: .utf8) else { return }
        pendingMethods[requestId] = method
        wsTask.send(.string(text)) { error in
            if let error {
                DaemonLogger.shared.debug("OpenClaw", "RPC \(method) send failed: \(error)")
            }
        }
    }

    private func sendConnectRequest(nonce: String) {
        var scopes = deviceAuthToken?.scopes ?? ["operator.admin", "operator.approvals", "operator.read"]
        if scopes.isEmpty {
            scopes = ["operator.admin", "operator.approvals", "operator.read"]
        }

        var params: [String: Any] = [
            "minProtocol": protocolVersion,
            "maxProtocol": protocolVersion,
            "client": [
                "id": "gateway-client",
                "displayName": "AgentDeck",
                "version": "0.3.0",
                "platform": "darwin",
                "mode": "backend",
            ],
            "role": "operator",
            "scopes": scopes,
            "caps": ["tool-events"],
        ]

        if let device = buildDeviceAuth(nonce: nonce, requestScopes: scopes),
           let authToken = deviceAuthToken?.token {
            params["device"] = device
            params["auth"] = ["token": authToken]
        }

        sendRPC(method: "connect", params: params)
    }

    private func requestSessionsList() {
        sendRPC(method: "sessions.list", params: [:])
    }

    private func applySessionsPayload(_ payload: [String: Any]) {
        guard let sessions = payload["sessions"] as? [[String: Any]], !sessions.isEmpty else {
            DaemonLogger.shared.debug("OpenClaw", "No sessions available")
            return
        }

        let sorted = sessions.sorted { lhs, rhs in
            let left = (lhs["updatedAt"] as? NSNumber)?.doubleValue ?? (lhs["updatedAt"] as? Double) ?? 0
            let right = (rhs["updatedAt"] as? NSNumber)?.doubleValue ?? (rhs["updatedAt"] as? Double) ?? 0
            return left > right
        }
        currentSessionKey = sorted.first?["key"] as? String
        DaemonLogger.shared.debug("OpenClaw", "Active session: \(currentSessionKey ?? "nil")")
    }

    private func buildDeviceAuth(nonce: String, requestScopes: [String]) -> [String: Any]? {
        guard let deviceIdentity, let deviceAuthToken else { return nil }
        let signedAt = Int(Date().timeIntervalSince1970 * 1000)
        let scopes = requestScopes.joined(separator: ",")
        let payload = [
            "v2",
            deviceIdentity.deviceId,
            "gateway-client",
            "backend",
            deviceAuthToken.role,
            scopes,
            String(signedAt),
            deviceAuthToken.token,
            nonce,
        ].joined(separator: "|")

        guard let signature = try? deviceIdentity.privateKey.signature(for: Data(payload.utf8)) else {
            DaemonLogger.shared.error("OpenClaw: device auth signing failed")
            return nil
        }
        guard let publicKey = publicKeyBase64Url(from: deviceIdentity.publicKeyPem) else {
            return nil
        }

        return [
            "id": deviceIdentity.deviceId,
            "publicKey": publicKey,
            "signature": signature.base64URLEncodedString(),
            "signedAt": signedAt,
            "nonce": nonce,
        ]
    }

    private func publicKeyBase64Url(from pem: String) -> String? {
        guard let raw = pemToRawKey(pem) else { return nil }
        return raw.base64URLEncodedString()
    }

    private func emitModelCatalog() async {
        guard let (entries, defaultModel) = await fetchModelCatalog() else { return }
        _onEvent?([
            "type": "model_catalog",
            "models": entries,
            "defaultModel": defaultModel as Any,
        ])
    }

    private func fetchModelCatalog() async -> ([[String: Any]], String?)? {
        guard let binPath = Self.resolveOpenClawBin() else {
            DaemonLogger.shared.debug("OpenClaw", "Model catalog skipped: openclaw binary not found")
            return nil
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binPath)
        process.arguments = ["models", "list", "--json"]
        process.environment = Self.openClawEnvironment()

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            DaemonLogger.shared.debug("OpenClaw", "Model catalog spawn failed: \(error)")
            return nil
        }

        let output = await Task.detached(priority: .utility) {
            process.waitUntilExit()
            let out = stdout.fileHandleForReading.readDataToEndOfFile()
            let err = stderr.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus, out, err)
        }.value

        guard output.0 == 0 else {
            let err = String(data: output.2, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "unknown"
            DaemonLogger.shared.debug("OpenClaw", "Model catalog command failed: \(err)")
            return nil
        }

        do {
            let decoded = try JSONDecoder().decode(ModelListResult.self, from: output.1)
            let entries = decoded.models.map { model in
                [
                    "key": model.key,
                    "name": model.name,
                    "role": Self.parseModelRole(tags: model.tags ?? []),
                    "available": model.available ?? true,
                ] as [String: Any]
            }
            let defaultModel = entries.first(where: { ($0["role"] as? String) == "default" })?["key"] as? String
            return (entries, defaultModel)
        } catch {
            DaemonLogger.shared.debug("OpenClaw", "Model catalog parse failed: \(error)")
            return nil
        }
    }

    private static func parseModelRole(tags: [String]) -> String {
        if tags.contains("default") { return "default" }
        for tag in tags {
            if let suffix = tag.split(separator: "#").last, tag.hasPrefix("fallback#") {
                return "fallback-\(suffix)"
            }
        }
        return "configured"
    }

    private static func resolveOpenClawBin() -> String? {
        let realHome = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        let candidates = [
            "\(realHome)/Library/pnpm/openclaw",
            "\(realHome)/.local/bin/openclaw",
            "\(realHome)/bin/openclaw",
            "/opt/homebrew/bin/openclaw",
            "/usr/local/bin/openclaw",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["which", "openclaw"]
        process.environment = openClawEnvironment()
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        let result = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return result?.isEmpty == false ? result : nil
    }

    private static func openClawEnvironment() -> [String: String] {
        let realHome = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        var env = ProcessInfo.processInfo.environment
        env["HOME"] = realHome
        env["PATH"] = [
            "\(realHome)/Library/pnpm",
            "\(realHome)/.local/bin",
            "\(realHome)/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ].joined(separator: ":")
        return env
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
#endif
