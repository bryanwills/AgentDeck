#if os(macOS)
// Desktop-vs-TUI detection from a Codex rollout's first line.
//
// The fixture lines are patterned on a line captured from a live store
// (~/.codex/sessions/2026/09/01/rollout-…jsonl, 2026-09-01) rather than
// composed from the parser's own field list — a fixture built from what the
// reader expects agrees with it forever. The originator VALUES are the ones a
// 200-rollout survey of that store actually held: "Codex Desktop",
// "codex-tui", "codex_cli_rs", "codex_vscode", "codex_exec".

import XCTest
@testable import AgentDeck

final class CodexOriginatorTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("codex-originator-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("2026/09/01"),
            withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func writeRollout(id: String, firstLine: String, extraLines: [String] = []) throws {
        let url = root.appendingPathComponent(
            "2026/09/01/rollout-2026-09-01T00-52-37-\(id).jsonl")
        let body = ([firstLine] + extraLines).joined(separator: "\n") + "\n"
        try body.data(using: .utf8)!.write(to: url)
    }

    private func metaLine(originator: String, id: String, instructionBytes: Int = 20_000) -> String {
        // Shape captured off a live rollout — keys and nesting verbatim. The
        // base_instructions bulk is load-bearing, not decoration: real first
        // lines measure 18–22 KB (20-rollout survey, 2026-09-01), and a
        // fixture patterned on a `head -c 600` capture hid that the 8 KB head
        // window truncated every real line into a no-claim verdict.
        let instructions = String(repeating: "x", count: instructionBytes)
        return """
        {"timestamp":"2026-08-31T15:53:40.772Z","ordinal":0,"type":"session_meta","payload":{"session_id":"\(id)","id":"\(id)","timestamp":"2026-08-31T15:52:37.127Z","cwd":"/Users/u/project","originator":"\(originator)","cli_version":"0.150.0-alpha.8","source":"vscode","thread_source":"user","model_provider":"openai","base_instructions":{"text":"\(instructions)"}}}
        """
    }

    func testDesktopOriginatorIsDesktop() throws {
        let id = "01a05885-c5e3-7ce0-9c45-06ec2f04a6fd"
        try writeRollout(id: id, firstLine: metaLine(originator: "Codex Desktop", id: id))
        XCTAssertEqual(
            CodexRolloutResponseReader.originatorIsDesktop(sessionId: id, sessionsRoot: root),
            true)
    }

    func testTuiOriginatorsAreNotDesktop() throws {
        for (index, originator) in ["codex-tui", "codex_cli_rs", "codex_vscode", "codex_exec"].enumerated() {
            let id = "0000000\(index)-c5e3-7ce0-9c45-06ec2f04a6fd"
            try writeRollout(id: id, firstLine: metaLine(originator: originator, id: id))
            XCTAssertEqual(
                CodexRolloutResponseReader.originatorIsDesktop(sessionId: id, sessionsRoot: root),
                false, originator)
        }
    }

    func testHookSessionIdPrefixIsAccepted() throws {
        // The hook path synthesizes ids as `codex:<uuid>`; locateRollout
        // strips the prefix, and the verdict must ride through it.
        let id = "11a05885-c5e3-7ce0-9c45-06ec2f04a6fd"
        try writeRollout(id: id, firstLine: metaLine(originator: "Codex Desktop", id: id))
        XCTAssertEqual(
            CodexRolloutResponseReader.originatorIsDesktop(
                sessionId: "codex:\(id)", sessionsRoot: root),
            true)
    }

    func testMissingRolloutMakesNoClaim() {
        XCTAssertNil(CodexRolloutResponseReader.originatorIsDesktop(
            sessionId: "22a05885-c5e3-7ce0-9c45-06ec2f04a6fd", sessionsRoot: root))
    }

    func testUnparseableFirstLineMakesNoClaim() throws {
        // "Could not read" must never collapse into "not desktop" at THIS
        // layer — the caller retries; a cached false would stick forever.
        let id = "33a05885-c5e3-7ce0-9c45-06ec2f04a6fd"
        try writeRollout(id: id, firstLine: "{\"type\":\"session_meta\",\"payload\"")
        XCTAssertNil(CodexRolloutResponseReader.originatorIsDesktop(
            sessionId: id, sessionsRoot: root))
    }

    func testOnlyTheFirstLineDecides() throws {
        // A later line claiming a different originator is not session_meta's
        // to override; the head is written once at session open.
        let id = "44a05885-c5e3-7ce0-9c45-06ec2f04a6fd"
        try writeRollout(
            id: id,
            firstLine: metaLine(originator: "codex-tui", id: id),
            extraLines: [#"{"type":"event_msg","payload":{"type":"agent_message","message":"Codex Desktop"}}"#])
        XCTAssertEqual(
            CodexRolloutResponseReader.originatorIsDesktop(sessionId: id, sessionsRoot: root),
            false)
    }
}
#endif
