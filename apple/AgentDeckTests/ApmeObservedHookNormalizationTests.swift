#if os(macOS)
import XCTest
@testable import AgentDeck

final class ApmeObservedHookNormalizationTests: XCTestCase {
    func testCodexPromptBecomesAgentNeutralBoundaryWithDurableSession() {
        let hook = DaemonServer.normalizeApmeObservedHook(
            event: "codex_user_prompt_submit",
            json: ["session_id": "raw-thread", "prompt": "fix it"],
            sessionId: "codex:550e8400-e29b-41d4-a716-446655440000"
        )

        XCTAssertEqual(hook?.event, "user_prompt_submit")
        XCTAssertEqual(hook?.payload["session_id"] as? String, "codex:550e8400-e29b-41d4-a716-446655440000")
        XCTAssertEqual(hook?.payload["agent_type"] as? String, "codex-cli")
        XCTAssertEqual(hook?.payload["prompt"] as? String, "fix it")
    }

    func testOpenCodeLifecycleAndCodexTurnCompleteMapWithoutLosingSource() {
        let start = DaemonServer.normalizeApmeObservedHook(
            event: "opencode_session_start",
            json: ["session_id": "ses_1"],
            sessionId: "opencode:ses_1"
        )
        let end = DaemonServer.normalizeApmeObservedHook(
            event: "codex_turn_complete",
            json: [:],
            sessionId: "codex:thread-1"
        )

        XCTAssertEqual(start?.event, "session_start")
        XCTAssertEqual(start?.payload["session_id"] as? String, "opencode:ses_1")
        XCTAssertEqual(start?.payload["agent_type"] as? String, "opencode")
        XCTAssertEqual(end?.event, "stop")
        XCTAssertEqual(end?.payload["agent_type"] as? String, "codex-cli")
    }

    func testSourcePrefixedEventWithoutDurableSessionIsRejected() {
        XCTAssertNil(DaemonServer.normalizeApmeObservedHook(
            event: "codex_tool_start",
            json: ["session_id": "7"],
            sessionId: nil
        ))
    }

    func testNonLifecycleSourceEventRetainsPrefixAsRawStep() {
        let hook = DaemonServer.normalizeApmeObservedHook(
            event: "opencode_permission_asked",
            json: [:],
            sessionId: "opencode:ses_1"
        )
        XCTAssertEqual(hook?.event, "opencode_permission_asked")
    }
}
#endif
