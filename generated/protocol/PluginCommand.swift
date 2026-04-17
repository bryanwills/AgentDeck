// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let aDPluginCommand = try ADPluginCommand(json)

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

import Foundation

/// Session-scoped command — daemon forwards the inner command to the specified session's
/// bridge. Enables direct control of a specific session from any client (MenuBarExtra,
/// Dashboard, etc.)
///
/// APME vibe check — user approves or rejects a completed run's output quality.
///
/// Ask bridge/daemon for model recommendation given a task context.
// MARK: - ADPluginCommand
struct ADPluginCommand: Codable, Equatable {
    var type: ADType
    var value: ADValue?
    var index: Double?
    var direction: ADDirection?
    var text: String?
    var mode: ADMode?
    var action: ADAction?
    var agent: ADAgent?
    var sessionId: String?
    var command: ADCommand?
    var note: String?
    var runId: String?
    var verdict: ADVerdict?
    var budgetUsd: Double?
    var latencyBudgetMs: Double?
    var preferLocal: Bool?
    var taskKind: String?

    enum CodingKeys: String, CodingKey {
        case type = "type"
        case value = "value"
        case index = "index"
        case direction = "direction"
        case text = "text"
        case mode = "mode"
        case action = "action"
        case agent = "agent"
        case sessionId = "sessionId"
        case command = "command"
        case note = "note"
        case runId = "runId"
        case verdict = "verdict"
        case budgetUsd = "budgetUsd"
        case latencyBudgetMs = "latencyBudgetMs"
        case preferLocal = "preferLocal"
        case taskKind = "taskKind"
    }
}

// MARK: ADPluginCommand convenience initializers and mutators

extension ADPluginCommand {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADPluginCommand.self, from: data)
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
        type: ADType? = nil,
        value: ADValue?? = nil,
        index: Double?? = nil,
        direction: ADDirection?? = nil,
        text: String?? = nil,
        mode: ADMode?? = nil,
        action: ADAction?? = nil,
        agent: ADAgent?? = nil,
        sessionId: String?? = nil,
        command: ADCommand?? = nil,
        note: String?? = nil,
        runId: String?? = nil,
        verdict: ADVerdict?? = nil,
        budgetUsd: Double?? = nil,
        latencyBudgetMs: Double?? = nil,
        preferLocal: Bool?? = nil,
        taskKind: String?? = nil
    ) -> ADPluginCommand {
        return ADPluginCommand(
            type: type ?? self.type,
            value: value ?? self.value,
            index: index ?? self.index,
            direction: direction ?? self.direction,
            text: text ?? self.text,
            mode: mode ?? self.mode,
            action: action ?? self.action,
            agent: agent ?? self.agent,
            sessionId: sessionId ?? self.sessionId,
            command: command ?? self.command,
            note: note ?? self.note,
            runId: runId ?? self.runId,
            verdict: verdict ?? self.verdict,
            budgetUsd: budgetUsd ?? self.budgetUsd,
            latencyBudgetMs: latencyBudgetMs ?? self.latencyBudgetMs,
            preferLocal: preferLocal ?? self.preferLocal,
            taskKind: taskKind ?? self.taskKind
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADAction: String, Codable, Equatable {
    case adjustBrightness = "adjust_brightness"
    case adjustVolume = "adjust_volume"
    case analyze = "analyze"
    case cancel = "cancel"
    case dump = "dump"
    case mediaNext = "media_next"
    case mediaPlayPause = "media_play_pause"
    case mediaPrev = "media_prev"
    case start = "start"
    case stop = "stop"
    case toggleMute = "toggle_mute"
}

enum ADAgent: String, Codable, Equatable {
    case claudeCode = "claude-code"
    case openclaw = "openclaw"
}

//
// Hashable or Equatable:
// The compiler will not be able to synthesize the implementation of Hashable or Equatable
// for types that require the use of JSONAny, nor will the implementation of Hashable be
// synthesized for types that have collections (such as arrays or dictionaries).

// MARK: - ADCommand
struct ADCommand: Codable, Equatable {
    var type: String

    enum CodingKeys: String, CodingKey {
        case type = "type"
    }
}

// MARK: ADCommand convenience initializers and mutators

extension ADCommand {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ADCommand.self, from: data)
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
        type: String? = nil
    ) -> ADCommand {
        return ADCommand(
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

enum ADDirection: String, Codable, Equatable {
    case down = "down"
    case up = "up"
}

enum ADMode: String, Codable, Equatable {
    case acceptEdits = "acceptEdits"
    case modeDefault = "default"
    case plan = "plan"
}

enum ADType: String, Codable, Equatable {
    case apmeRecommend = "apme_recommend"
    case apmeVibe = "apme_vibe"
    case diag = "diag"
    case escape = "escape"
    case focusSession = "focus_session"
    case interrupt = "interrupt"
    case navigateOption = "navigate_option"
    case queryUsage = "query_usage"
    case respond = "respond"
    case selectOption = "select_option"
    case sendPrompt = "send_prompt"
    case sessionCommand = "session_command"
    case switchAgent = "switch_agent"
    case switchMode = "switch_mode"
    case utility = "utility"
    case voice = "voice"
}

enum ADValue: Codable, Equatable {
    case double(Double)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(Double.self) {
            self = .double(x)
            return
        }
        if let x = try? container.decode(String.self) {
            self = .string(x)
            return
        }
        throw DecodingError.typeMismatch(ADValue.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for ADValue"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .double(let x):
            try container.encode(x)
        case .string(let x):
            try container.encode(x)
        }
    }
}

enum ADVerdict: String, Codable, Equatable {
    case approve = "approve"
    case neutral = "neutral"
    case reject = "reject"
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
