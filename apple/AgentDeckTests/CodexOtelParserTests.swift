#if os(macOS)
import XCTest
@testable import AgentDeck

final class CodexOtelParserTests: XCTestCase {

    func testTurnStartFromTopLevelTurn() {
        let json = otlp(spans: [
            ["name": "codex.turn", "attributes": attr(["codex.thread_id": "t1", "codex.turn_id": "u1", "cwd": "/repo"])]
        ])
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [.turnStart(threadId: "t1", turnId: "u1", cwd: "/repo")]
        )
    }

    func testFullTurnSequence() {
        let json = otlp(spans: [
            ["name": "codex.turn.start", "attributes": attr(["codex.thread_id": "t2", "codex.turn_id": "u2"])],
            ["name": "codex.tool.call", "attributes": attr(["codex.thread_id": "t2", "codex.turn_id": "u2", "tool.name": "Read"])],
            ["name": "codex.tool.result", "attributes": attr(["codex.thread_id": "t2", "codex.turn_id": "u2"])],
            ["name": "codex.turn.end", "attributes": attr(["codex.thread_id": "t2", "codex.turn_id": "u2"])]
        ])
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [
                .turnStart(threadId: "t2", turnId: "u2", cwd: nil),
                .toolCall(threadId: "t2", turnId: "u2", tool: "Read"),
                .toolResult(threadId: "t2", turnId: "u2"),
                .turnEnd(threadId: "t2", turnId: "u2"),
            ]
        )
    }

    func testObservedCodexNamesFromTuiLog() {
        let json = otlp(spans: [
            ["name": "op.dispatch.user_input_with_turn_context", "attributes": attr(["thread.id": "t-log", "turn.id": "u-log", "cwd": "/repo"])],
            ["name": "session_task.turn", "attributes": attr(["thread.id": "t-log", "turn.id": "u-log"])]
        ])
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [
                .turnStart(threadId: "t-log", turnId: "u-log", cwd: "/repo"),
                .turnEnd(threadId: "t-log", turnId: "u-log"),
            ]
        )
    }

    func testIgnoresUnknownSpan() {
        let json = otlp(spans: [
            ["name": "codex.heartbeat", "attributes": attr(["codex.thread_id": "t3"])]
        ])
        XCTAssertEqual(CodexTelemetryModule.parse(json), [])
    }

    func testMissingThreadIdSkips() {
        let json = otlp(spans: [
            ["name": "codex.turn", "attributes": attr(["cwd": "/repo"])]
        ])
        XCTAssertEqual(CodexTelemetryModule.parse(json), [])
    }

    func testUnderscoreVariantNormalizedToDot() {
        // `codex.tool_call` (underscored) and `tool` (vs `tool.name`) are
        // both legal — schema is not nailed down in Codex 1.x yet.
        let json = otlp(spans: [
            ["name": "codex.tool_call", "attributes": attr(["thread_id": "t4", "tool": "Bash"])]
        ])
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [.toolCall(threadId: "t4", turnId: "", tool: "Bash")]
        )
    }

    func testAttributeFromResourceFallsThrough() {
        // Resource-level attribute should populate threadId when the span
        // itself doesn't carry one (some exporters emit thread_id only on
        // the resource because it's batch-stable).
        let json: [String: Any] = [
            "resourceSpans": [[
                "resource": ["attributes": attr(["codex.thread_id": "from-resource"])],
                "scopeSpans": [["spans": [
                    ["name": "codex.turn.end", "attributes": attr([:])]
                ]]]
            ]]
        ]
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [.turnEnd(threadId: "from-resource", turnId: "")]
        )
    }

    func testIntValueAttributeAccepted() {
        // OTLP ints arrive as either Int or stringified — we just need the
        // span name to dispatch correctly even when other attrs are int.
        let json = otlp(spans: [
            ["name": "codex.turn.start", "attributes": [
                ["key": "codex.thread_id", "value": ["stringValue": "t5"]],
                ["key": "codex.turn_id", "value": ["intValue": "42"]],  // stringified int
            ]]
        ])
        XCTAssertEqual(
            CodexTelemetryModule.parse(json),
            [.turnStart(threadId: "t5", turnId: "42", cwd: nil)]
        )
    }

    func testSpanNameSummaryForDiagnostics() {
        let json = otlp(spans: [
            ["name": "unknown.one", "attributes": attr([:])],
            ["name": "unknown.two", "attributes": attr([:])]
        ])
        XCTAssertEqual(CodexTelemetryModule.spanNameSummary(json), "unknown.one,unknown.two")
    }

    func testEmptyResourceSpansReturnsEmpty() {
        XCTAssertEqual(CodexTelemetryModule.parse(["resourceSpans": []]), [])
        XCTAssertEqual(CodexTelemetryModule.parse([:]), [])
    }

    // MARK: - Helpers

    private func otlp(spans: [[String: Any]]) -> [String: Any] {
        return [
            "resourceSpans": [[
                "scopeSpans": [["spans": spans]]
            ]]
        ]
    }

    /// Wrap a flat dict into OTLP's `{key, value: {stringValue}}` array.
    /// String / int / bool dispatch automatically by Swift type.
    private func attr(_ dict: [String: Any]) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for (key, value) in dict {
            let wrap: [String: Any]
            if let s = value as? String { wrap = ["stringValue": s] }
            else if let i = value as? Int { wrap = ["intValue": i] }
            else if let b = value as? Bool { wrap = ["boolValue": b] }
            else { wrap = ["stringValue": String(describing: value)] }
            out.append(["key": key, "value": wrap])
        }
        return out
    }
}
#endif
