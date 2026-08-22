#if os(macOS)
import XCTest
@testable import AgentDeck

final class ApmeActivityHistoryTests: XCTestCase {
    private func row(
        key: String = "activity:v1:a",
        agent: String = "codex-cli",
        session: String = "thread-1",
        start: Int = 1_000,
        end: Int? = 11_000,
        provenance: [String] = ["node"]
    ) -> ApmeActivityHistory.Row {
        ApmeActivityHistory.Row(
            originKey: key, agentType: agent, sessionId: session, taskIndex: 0,
            projectName: "AgentDeck", modelId: nil, task: "Fix the parser",
            startedAt: start, endedAt: end, durationMs: max(0, (end ?? start) - start),
            turnCount: 1, inputTokens: nil, outputTokens: nil, costUsd: nil,
            overallScore: nil, provenance: provenance
        )
    }

    func testOriginKeyMatchesNodeContract() {
        XCTAssertEqual(
            ApmeActivityHistory.originKey(
                agentType: "codex-cli",
                sessionId: "codex:thread-1",
                taskIndex: 3,
                firstPrompt: "  Fix   the parser  "
            ),
            "activity:v1:da0d9af3fd0f247f1befac63"
        )
    }

    func testHandoverFragmentsMergeButDistantResumeDoesNot() {
        let near = row(key: "activity:v1:b", start: 12_000, end: 20_000, provenance: ["swift"])
        let distant = row(start: 8 * 60 * 60 * 1_000, end: nil, provenance: ["swift"])

        let merged = ApmeActivityHistory.merge(rows: [row(), near])
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].provenance, ["node", "swift"])
        XCTAssertEqual(merged[0].endedAt, 20_000)
        XCTAssertEqual(ApmeActivityHistory.merge(rows: [row(), distant]).count, 2)
    }
}
#endif
