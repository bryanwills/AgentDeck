// ProtocolTests.swift — Protocol decoding tests

import XCTest
@testable import AgentDeck

final class ProtocolTests: XCTestCase {

    // MARK: - State Update Decoding

    func testDecodeStateUpdate() throws {
        let json = """
        {
            "type": "state_update",
            "state": "processing",
            "permissionMode": "default",
            "projectName": "my-project",
            "modelName": "opus-4",
            "currentTool": "Read",
            "toolInput": "src/main.ts"
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .stateUpdate(let e) = event else {
            XCTFail("Expected stateUpdate, got \(String(describing: event))")
            return
        }

        XCTAssertEqual(e.state, "processing")
        XCTAssertEqual(e.permissionMode, "default")
        XCTAssertEqual(e.projectName, "my-project")
        XCTAssertEqual(e.modelName, "opus-4")
        XCTAssertEqual(e.currentTool, "Read")
        XCTAssertEqual(e.toolInput, "src/main.ts")
    }

    func testDecodeStateUpdateWithCapabilities() throws {
        let json = """
        {
            "type": "state_update",
            "state": "idle",
            "agentType": "claude-code",
            "agentCapabilities": {
                "type": "claude-code",
                "displayName": "Claude Code",
                "hasTerminal": true,
                "hasModeSwitching": true,
                "hasDiffReview": true,
                "hasOptionLists": true,
                "hasNavigablePrompts": true,
                "hasSuggestedPrompts": true,
                "hasApiUsage": true
            }
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .stateUpdate(let e) = event else {
            XCTFail("Expected stateUpdate")
            return
        }

        XCTAssertEqual(e.agentType, "claude-code")
        XCTAssertNotNil(e.agentCapabilities)
        XCTAssertEqual(e.agentCapabilities?.hasTerminal, true)
        XCTAssertEqual(e.agentCapabilities?.displayName, "Claude Code")
    }

    // MARK: - Usage Update

    func testDecodeUsageUpdate() throws {
        let json = """
        {
            "type": "usage_update",
            "sessionDurationSec": 3600,
            "inputTokens": 50000,
            "outputTokens": 25000,
            "toolCalls": 42,
            "fiveHourPercent": 72.5,
            "fiveHourResetsAt": "2026-03-12T18:00:00Z",
            "sevenDayPercent": 45.0,
            "oauthConnected": true
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .usageUpdate(let e) = event else {
            XCTFail("Expected usageUpdate")
            return
        }

        XCTAssertEqual(e.sessionDurationSec, 3600)
        XCTAssertEqual(e.inputTokens, 50000)
        XCTAssertEqual(e.outputTokens, 25000)
        XCTAssertEqual(e.toolCalls, 42)
        XCTAssertEqual(e.fiveHourPercent, 72.5)
        XCTAssertEqual(e.oauthConnected, true)
    }

    // MARK: - Connection Event

    func testDecodeConnectionEvent() throws {
        let json = """
        {"type": "connection", "status": "connected", "sessionId": "abc123"}
        """

        let event = BridgeEventParser.parse(json)
        guard case .connection(let e) = event else {
            XCTFail("Expected connection")
            return
        }

        XCTAssertEqual(e.status, "connected")
        XCTAssertEqual(e.sessionId, "abc123")
    }

    // MARK: - Sessions List

    func testDecodeSessionsList() throws {
        let json = """
        {
            "type": "sessions_list",
            "sessions": [
                {"id": "s1", "port": 9120, "projectName": "proj1", "agentType": "claude-code", "alive": true},
                {"id": "s2", "port": 9121, "projectName": "proj2", "alive": false}
            ]
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .sessionsList(let e) = event else {
            XCTFail("Expected sessionsList")
            return
        }

        XCTAssertEqual(e.sessions.count, 2)
        XCTAssertEqual(e.sessions[0].projectName, "proj1")
        XCTAssertEqual(e.sessions[0].agentType, "claude-code")
        XCTAssertEqual(e.sessions[1].alive, false)
    }

    // MARK: - Button State

    func testDecodeButtonState() throws {
        let json = """
        {
            "type": "button_state",
            "buttons": [
                {"slot": 0, "title": "DEFAULT", "bgColor": "#1e293b", "textColor": "#ffffff", "enabled": true, "action": "switch_mode"},
                {"slot": 7, "title": "STOP", "bgColor": "#991b1b", "textColor": "#ffffff", "enabled": true, "icon": "■", "action": "interrupt"}
            ]
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .buttonState(let e) = event else {
            XCTFail("Expected buttonState")
            return
        }

        XCTAssertEqual(e.buttons.count, 2)
        XCTAssertEqual(e.buttons[0].action, "switch_mode")
        XCTAssertEqual(e.buttons[1].icon, "■")
    }

    // MARK: - Encoder State

    func testDecodeEncoderState() throws {
        let json = """
        {
            "type": "encoder_state",
            "encoders": [
                {"slot": 0, "encoderType": "utility", "header": "VOLUME", "value": "65%", "icon": "🔊", "accentColor": "#22d3ee"},
                {"slot": 3, "encoderType": "voice", "header": "VOICE", "value": "Ready", "accentColor": "#a855f7", "voiceState": "idle"}
            ],
            "takeoverActive": false
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .encoderState(let e) = event else {
            XCTFail("Expected encoderState")
            return
        }

        XCTAssertEqual(e.encoders.count, 2)
        XCTAssertEqual(e.encoders[0].header, "VOLUME")
        XCTAssertEqual(e.encoders[1].voiceState, "idle")
        XCTAssertEqual(e.takeoverActive, false)
    }

    // MARK: - Unknown Event

    func testUnknownEventReturnsNil() {
        let json = """
        {"type": "future_event", "data": {}}
        """
        XCTAssertNil(BridgeEventParser.parse(json))
    }

    func testInvalidJsonReturnsNil() {
        XCTAssertNil(BridgeEventParser.parse("not json"))
        XCTAssertNil(BridgeEventParser.parse(""))
    }

    // MARK: - Plugin Command Encoding

    func testEncodeRespondCommand() throws {
        let cmd = PluginCommand.respond(value: "y")
        let data = try JSONEncoder().encode(cmd)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["type"] as? String, "respond")
        XCTAssertEqual(json?["value"] as? String, "y")
    }

    func testEncodeSelectOptionCommand() throws {
        let cmd = PluginCommand.selectOption(index: 2)
        let data = try JSONEncoder().encode(cmd)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["type"] as? String, "select_option")
        XCTAssertEqual(json?["index"] as? Int, 2)
    }

    func testEncodeSwitchModeCommand() throws {
        let cmd = PluginCommand.switchMode(mode: "plan")
        let data = try JSONEncoder().encode(cmd)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["type"] as? String, "switch_mode")
        XCTAssertEqual(json?["mode"] as? String, "plan")
    }

    func testEncodeInterruptCommand() throws {
        let cmd = PluginCommand.interrupt
        let data = try JSONEncoder().encode(cmd)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(json?["type"] as? String, "interrupt")
    }
}
