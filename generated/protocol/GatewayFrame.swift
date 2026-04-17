// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let aDGatewayFrame = try ADGatewayFrame(json)

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

import Foundation

/// Client → Gateway: RPC request.
///
/// Gateway → Client: RPC response (ok=true) or error (ok=false).
///
/// Gateway → Client: unsolicited event.
// MARK: - ADGatewayFrame
struct ADGatewayFrame: Codable, Equatable {
    var id: String?
    var method: ADGatewayMethodName?
    var params: ADGatewayMethodParams?
    var type: ADType
    var error: ADGatewayError?
    var ok: Bool?
    var payload: ADGateway?
    var event: ADGatewayEventName?
    /// Monotonic sequence number (optional, used for ordering on reconnect).
    var seq: String?
    /// Server-side state version for dedup on replay.
    var stateVersion: String?

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case method = "method"
        case params = "params"
        case type = "type"
        case error = "error"
        case ok = "ok"
        case payload = "payload"
        case event = "event"
        case seq = "seq"
        case stateVersion = "stateVersion"
    }
}

// MARK: ADGatewayFrame convenience initializers and mutators

extension ADGatewayFrame {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADGatewayFrame.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String?? = nil,
        method: ADGatewayMethodName?? = nil,
        params: ADGatewayMethodParams?? = nil,
        type: ADType? = nil,
        error: ADGatewayError?? = nil,
        ok: Bool?? = nil,
        payload: ADGateway?? = nil,
        event: ADGatewayEventName?? = nil,
        seq: String?? = nil,
        stateVersion: String?? = nil
    ) -> ADGatewayFrame {
        return ADGatewayFrame(
            id: id ?? self.id,
            method: method ?? self.method,
            params: params ?? self.params,
            type: type ?? self.type,
            error: error ?? self.error,
            ok: ok ?? self.ok,
            payload: payload ?? self.payload,
            event: event ?? self.event,
            seq: seq ?? self.seq,
            stateVersion: stateVersion ?? self.stateVersion
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADGatewayError
struct ADGatewayError: Codable, Equatable {
    var code: String
    var details: JSONAny?
    var message: String

    enum CodingKeys: String, CodingKey {
        case code = "code"
        case details = "details"
        case message = "message"
    }
}

// MARK: ADGatewayError convenience initializers and mutators

extension ADGatewayError {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADGatewayError.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        code: String? = nil,
        details: JSONAny?? = nil,
        message: String? = nil
    ) -> ADGatewayError {
        return ADGatewayError(
            code: code ?? self.code,
            details: details ?? self.details,
            message: message ?? self.message
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADGatewayEventName: String, Codable, Equatable {
    case chat = "chat"
    case connectChallenge = "connect.challenge"
    case execApprovalRequested = "exec.approval.requested"
    case execApprovalResolved = "exec.approval.resolved"
    case presence = "presence"
    case shutdown = "shutdown"
    case tick = "tick"
}

enum ADGatewayMethodName: String, Codable, Equatable {
    case chatAbort = "chat.abort"
    case chatSend = "chat.send"
    case connect = "connect"
    case execApprovalResolve = "exec.approval.resolve"
    case sessionsList = "sessions.list"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADGatewayMethodParams
struct ADGatewayMethodParams: Codable, Equatable {
    var auth: ADDeviceAuth?
    var clientInfo: ADClientInfo?
    var requestScopes: [String]?
    var idempotencyKey: String?
    var message: String?
    var sessionKey: String?
    var runId: String?
    var decision: ADGatewayMethodParamsDecision?
    var id: String?
    var kind: String?

    enum CodingKeys: String, CodingKey {
        case auth = "auth"
        case clientInfo = "clientInfo"
        case requestScopes = "requestScopes"
        case idempotencyKey = "idempotencyKey"
        case message = "message"
        case sessionKey = "sessionKey"
        case runId = "runId"
        case decision = "decision"
        case id = "id"
        case kind = "kind"
    }
}

// MARK: ADGatewayMethodParams convenience initializers and mutators

extension ADGatewayMethodParams {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADGatewayMethodParams.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        auth: ADDeviceAuth?? = nil,
        clientInfo: ADClientInfo?? = nil,
        requestScopes: [String]?? = nil,
        idempotencyKey: String?? = nil,
        message: String?? = nil,
        sessionKey: String?? = nil,
        runId: String?? = nil,
        decision: ADGatewayMethodParamsDecision?? = nil,
        id: String?? = nil,
        kind: String?? = nil
    ) -> ADGatewayMethodParams {
        return ADGatewayMethodParams(
            auth: auth ?? self.auth,
            clientInfo: clientInfo ?? self.clientInfo,
            requestScopes: requestScopes ?? self.requestScopes,
            idempotencyKey: idempotencyKey ?? self.idempotencyKey,
            message: message ?? self.message,
            sessionKey: sessionKey ?? self.sessionKey,
            runId: runId ?? self.runId,
            decision: decision ?? self.decision,
            id: id ?? self.id,
            kind: kind ?? self.kind
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADDeviceAuth
struct ADDeviceAuth: Codable, Equatable {
    var id: String
    var nonce: String
    var publicKey: String
    var signature: String
    var signedAt: Double

    enum CodingKeys: String, CodingKey {
        case id = "id"
        case nonce = "nonce"
        case publicKey = "publicKey"
        case signature = "signature"
        case signedAt = "signedAt"
    }
}

// MARK: ADDeviceAuth convenience initializers and mutators

extension ADDeviceAuth {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADDeviceAuth.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String? = nil,
        nonce: String? = nil,
        publicKey: String? = nil,
        signature: String? = nil,
        signedAt: Double? = nil
    ) -> ADDeviceAuth {
        return ADDeviceAuth(
            id: id ?? self.id,
            nonce: nonce ?? self.nonce,
            publicKey: publicKey ?? self.publicKey,
            signature: signature ?? self.signature,
            signedAt: signedAt ?? self.signedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADClientInfo
struct ADClientInfo: Codable, Equatable {
    var clientId: String
    var clientMode: ADClientMode
    var version: String?

    enum CodingKeys: String, CodingKey {
        case clientId = "clientId"
        case clientMode = "clientMode"
        case version = "version"
    }
}

// MARK: ADClientInfo convenience initializers and mutators

extension ADClientInfo {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADClientInfo.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        clientId: String? = nil,
        clientMode: ADClientMode? = nil,
        version: String?? = nil
    ) -> ADClientInfo {
        return ADClientInfo(
            clientId: clientId ?? self.clientId,
            clientMode: clientMode ?? self.clientMode,
            version: version ?? self.version
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADClientMode: String, Codable, Equatable {
    case backend = "backend"
    case frontend = "frontend"
}

enum ADGatewayMethodParamsDecision: String, Codable, Equatable {
    case allow = "allow"
    case deny = "deny"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADGateway
struct ADGateway: Codable, Equatable {
    var accepted: Bool?
    var expiresAt: Double?
    var sessionToken: String?
    var runId: String?
    var aborted: Bool?
    var resolved: Bool?
    var sessions: [ADGatewaySession]?
    var nonce: String?
    /// Incremental text chunk (delta state).
    var delta: String?
    /// Error message (error state).
    var error: String?
    /// Token accounting (final state).
    var inputTokens: Double?
    /// Model identifier used for this turn.
    var modelId: String?
    /// Session identifier when Gateway creates a new session mid-chat.
    var newSessionId: String?
    var outputTokens: Double?
    /// User prompt text, as echoed by Gateway on first delta.
    var prompt: String?
    /// Full assembled response (final state).
    var response: String?
    var sessionKey: String?
    var state: ADState?
    /// Tool invocations observed in this turn.
    var tools: [ADChatToolInvocation]?
    var command: String?
    var id: String?
    /// Options surfaced to the user (default: allow/deny).
    var options: [ADOption]?
    var reason: String?
    var tool: String?
    var decision: ADPayloadDecision?
    var clientId: String?
    var connected: Bool?
    var deviceId: String?
    var serverTime: Double?
    var restartAt: Double?

    enum CodingKeys: String, CodingKey {
        case accepted = "accepted"
        case expiresAt = "expiresAt"
        case sessionToken = "sessionToken"
        case runId = "runId"
        case aborted = "aborted"
        case resolved = "resolved"
        case sessions = "sessions"
        case nonce = "nonce"
        case delta = "delta"
        case error = "error"
        case inputTokens = "inputTokens"
        case modelId = "modelId"
        case newSessionId = "newSessionId"
        case outputTokens = "outputTokens"
        case prompt = "prompt"
        case response = "response"
        case sessionKey = "sessionKey"
        case state = "state"
        case tools = "tools"
        case command = "command"
        case id = "id"
        case options = "options"
        case reason = "reason"
        case tool = "tool"
        case decision = "decision"
        case clientId = "clientId"
        case connected = "connected"
        case deviceId = "deviceId"
        case serverTime = "serverTime"
        case restartAt = "restartAt"
    }
}

// MARK: ADGateway convenience initializers and mutators

extension ADGateway {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADGateway.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        accepted: Bool?? = nil,
        expiresAt: Double?? = nil,
        sessionToken: String?? = nil,
        runId: String?? = nil,
        aborted: Bool?? = nil,
        resolved: Bool?? = nil,
        sessions: [ADGatewaySession]?? = nil,
        nonce: String?? = nil,
        delta: String?? = nil,
        error: String?? = nil,
        inputTokens: Double?? = nil,
        modelId: String?? = nil,
        newSessionId: String?? = nil,
        outputTokens: Double?? = nil,
        prompt: String?? = nil,
        response: String?? = nil,
        sessionKey: String?? = nil,
        state: ADState?? = nil,
        tools: [ADChatToolInvocation]?? = nil,
        command: String?? = nil,
        id: String?? = nil,
        options: [ADOption]?? = nil,
        reason: String?? = nil,
        tool: String?? = nil,
        decision: ADPayloadDecision?? = nil,
        clientId: String?? = nil,
        connected: Bool?? = nil,
        deviceId: String?? = nil,
        serverTime: Double?? = nil,
        restartAt: Double?? = nil
    ) -> ADGateway {
        return ADGateway(
            accepted: accepted ?? self.accepted,
            expiresAt: expiresAt ?? self.expiresAt,
            sessionToken: sessionToken ?? self.sessionToken,
            runId: runId ?? self.runId,
            aborted: aborted ?? self.aborted,
            resolved: resolved ?? self.resolved,
            sessions: sessions ?? self.sessions,
            nonce: nonce ?? self.nonce,
            delta: delta ?? self.delta,
            error: error ?? self.error,
            inputTokens: inputTokens ?? self.inputTokens,
            modelId: modelId ?? self.modelId,
            newSessionId: newSessionId ?? self.newSessionId,
            outputTokens: outputTokens ?? self.outputTokens,
            prompt: prompt ?? self.prompt,
            response: response ?? self.response,
            sessionKey: sessionKey ?? self.sessionKey,
            state: state ?? self.state,
            tools: tools ?? self.tools,
            command: command ?? self.command,
            id: id ?? self.id,
            options: options ?? self.options,
            reason: reason ?? self.reason,
            tool: tool ?? self.tool,
            decision: decision ?? self.decision,
            clientId: clientId ?? self.clientId,
            connected: connected ?? self.connected,
            deviceId: deviceId ?? self.deviceId,
            serverTime: serverTime ?? self.serverTime,
            restartAt: restartAt ?? self.restartAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADPayloadDecision: String, Codable, Equatable {
    case allow = "allow"
    case deny = "deny"
    case timeout = "timeout"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADOption
struct ADOption: Codable, Equatable {
    var key: String
    var label: String

    enum CodingKeys: String, CodingKey {
        case key = "key"
        case label = "label"
    }
}

// MARK: ADOption convenience initializers and mutators

extension ADOption {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADOption.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        key: String? = nil,
        label: String? = nil
    ) -> ADOption {
        return ADOption(
            key: key ?? self.key,
            label: label ?? self.label
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADGatewaySession
struct ADGatewaySession: Codable, Equatable {
    var displayName: String?
    var key: String
    var kind: String?
    var label: String?
    var sessionId: String?
    var updatedAt: Double?

    enum CodingKeys: String, CodingKey {
        case displayName = "displayName"
        case key = "key"
        case kind = "kind"
        case label = "label"
        case sessionId = "sessionId"
        case updatedAt = "updatedAt"
    }
}

// MARK: ADGatewaySession convenience initializers and mutators

extension ADGatewaySession {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADGatewaySession.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        displayName: String?? = nil,
        key: String? = nil,
        kind: String?? = nil,
        label: String?? = nil,
        sessionId: String?? = nil,
        updatedAt: Double?? = nil
    ) -> ADGatewaySession {
        return ADGatewaySession(
            displayName: displayName ?? self.displayName,
            key: key ?? self.key,
            kind: kind ?? self.kind,
            label: label ?? self.label,
            sessionId: sessionId ?? self.sessionId,
            updatedAt: updatedAt ?? self.updatedAt
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADState: String, Codable, Equatable {
    case aborted = "aborted"
    case delta = "delta"
    case error = "error"
    case stateFinal = "final"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADChatToolInvocation
struct ADChatToolInvocation: Codable, Equatable {
    var input: JSONAny?
    var name: String
    var output: JSONAny?
    var status: ADStatus?

    enum CodingKeys: String, CodingKey {
        case input = "input"
        case name = "name"
        case output = "output"
        case status = "status"
    }
}

// MARK: ADChatToolInvocation convenience initializers and mutators

extension ADChatToolInvocation {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADChatToolInvocation.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        input: JSONAny?? = nil,
        name: String? = nil,
        output: JSONAny?? = nil,
        status: ADStatus?? = nil
    ) -> ADChatToolInvocation {
        return ADChatToolInvocation(
            input: input ?? self.input,
            name: name ?? self.name,
            output: output ?? self.output,
            status: status ?? self.status
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADStatus: String, Codable, Equatable {
    case error = "error"
    case pending = "pending"
    case success = "success"
}

enum ADType: String, Codable, Equatable {
    case event = "event"
    case req = "req"
    case res = "res"
}

// MARK: - Helper functions for creating encoders and decoders

func newJSONDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        decoder.dateDecodingStrategy = .iso8601
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        encoder.dateEncodingStrategy = .iso8601
    }
    return encoder
}

// MARK: - Encode/decode helpers

class JSONNull: Codable, Hashable {

    public static func == (lhs: JSONNull, rhs: JSONNull) -> Bool {
            return true
    }

    public var hashValue: Int {
            return 0
    }

    public init() {}

    public required init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if !container.decodeNil() {
                    throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
            }
    }

    public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encodeNil()
    }
}

class JSONCodingKey: CodingKey {
    let key: String

    required init?(intValue: Int) {
            return nil
    }

    required init?(stringValue: String) {
            key = stringValue
    }

    var intValue: Int? {
            return nil
    }

    var stringValue: String {
            return key
    }
}

class JSONAny: Codable {

    let value: Any

    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
            let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
            return DecodingError.typeMismatch(JSONAny.self, context)
    }

    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
            let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
            return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
            if let value = try? container.decode(Bool.self) {
                    return value
            }
            if let value = try? container.decode(Int64.self) {
                    return value
            }
            if let value = try? container.decode(Double.self) {
                    return value
            }
            if let value = try? container.decode(String.self) {
                    return value
            }
            if container.decodeNil() {
                    return JSONNull()
            }
            throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
            if let value = try? container.decode(Bool.self) {
                    return value
            }
            if let value = try? container.decode(Int64.self) {
                    return value
            }
            if let value = try? container.decode(Double.self) {
                    return value
            }
            if let value = try? container.decode(String.self) {
                    return value
            }
            if let value = try? container.decodeNil() {
                    if value {
                            return JSONNull()
                    }
            }
            if var container = try? container.nestedUnkeyedContainer() {
                    return try decodeArray(from: &container)
            }
            if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
                    return try decodeDictionary(from: &container)
            }
            throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
            if let value = try? container.decode(Bool.self, forKey: key) {
                    return value
            }
            if let value = try? container.decode(Int64.self, forKey: key) {
                    return value
            }
            if let value = try? container.decode(Double.self, forKey: key) {
                    return value
            }
            if let value = try? container.decode(String.self, forKey: key) {
                    return value
            }
            if let value = try? container.decodeNil(forKey: key) {
                    if value {
                            return JSONNull()
                    }
            }
            if var container = try? container.nestedUnkeyedContainer(forKey: key) {
                    return try decodeArray(from: &container)
            }
            if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
                    return try decodeDictionary(from: &container)
            }
            throw decodingError(forCodingPath: container.codingPath)
    }

    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
            var arr: [Any] = []
            while !container.isAtEnd {
                    let value = try decode(from: &container)
                    arr.append(value)
            }
            return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
            var dict = [String: Any]()
            for key in container.allKeys {
                    let value = try decode(from: &container, forKey: key)
                    dict[key.stringValue] = value
            }
            return dict
    }

    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
            for value in array {
                    if let value = value as? Bool {
                            try container.encode(value)
                    } else if let value = value as? Int64 {
                            try container.encode(value)
                    } else if let value = value as? Double {
                            try container.encode(value)
                    } else if let value = value as? String {
                            try container.encode(value)
                    } else if value is JSONNull {
                            try container.encodeNil()
                    } else if let value = value as? [Any] {
                            var container = container.nestedUnkeyedContainer()
                            try encode(to: &container, array: value)
                    } else if let value = value as? [String: Any] {
                            var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                            try encode(to: &container, dictionary: value)
                    } else {
                            throw encodingError(forValue: value, codingPath: container.codingPath)
                    }
            }
    }

    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
            for (key, value) in dictionary {
                    let key = JSONCodingKey(stringValue: key)!
                    if let value = value as? Bool {
                            try container.encode(value, forKey: key)
                    } else if let value = value as? Int64 {
                            try container.encode(value, forKey: key)
                    } else if let value = value as? Double {
                            try container.encode(value, forKey: key)
                    } else if let value = value as? String {
                            try container.encode(value, forKey: key)
                    } else if value is JSONNull {
                            try container.encodeNil(forKey: key)
                    } else if let value = value as? [Any] {
                            var container = container.nestedUnkeyedContainer(forKey: key)
                            try encode(to: &container, array: value)
                    } else if let value = value as? [String: Any] {
                            var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                            try encode(to: &container, dictionary: value)
                    } else {
                            throw encodingError(forValue: value, codingPath: container.codingPath)
                    }
            }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
            if let value = value as? Bool {
                    try container.encode(value)
            } else if let value = value as? Int64 {
                    try container.encode(value)
            } else if let value = value as? Double {
                    try container.encode(value)
            } else if let value = value as? String {
                    try container.encode(value)
            } else if value is JSONNull {
                    try container.encodeNil()
            } else {
                    throw encodingError(forValue: value, codingPath: container.codingPath)
            }
    }

    public required init(from decoder: Decoder) throws {
            if var arrayContainer = try? decoder.unkeyedContainer() {
                    self.value = try JSONAny.decodeArray(from: &arrayContainer)
            } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
                    self.value = try JSONAny.decodeDictionary(from: &container)
            } else {
                    let container = try decoder.singleValueContainer()
                    self.value = try JSONAny.decode(from: container)
            }
    }

    public func encode(to encoder: Encoder) throws {
            if let arr = self.value as? [Any] {
                    var container = encoder.unkeyedContainer()
                    try JSONAny.encode(to: &container, array: arr)
            } else if let dict = self.value as? [String: Any] {
                    var container = encoder.container(keyedBy: JSONCodingKey.self)
                    try JSONAny.encode(to: &container, dictionary: dict)
            } else {
                    var container = encoder.singleValueContainer()
                    try JSONAny.encode(to: &container, value: self.value)
            }
    }
}
