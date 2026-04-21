// ApmeTaskBoundaryTests.swift — Swift mirror of
// bridge/src/__tests__/apme-task-boundary.test.ts.
//
// Exercises the task-unit evaluation pipeline that runs on-device via Apple
// Intelligence (Foundation Models) for App Store builds. Tests focus on the
// deterministic parts — boundary detection, task lifecycle, task_id wiring —
// and skip the judge network path (the E2E with FM is a manual verification
// step, same as ApmeCategoryE2ETests).

#if os(macOS)
import XCTest
@testable import AgentDeck

@MainActor
final class ApmeTaskBoundaryTests: XCTestCase {

    // MARK: - Helpers

    private func makeTempStore() throws -> (store: ApmeStore, dir: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("apme-task-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        setenv("AGENTDECK_DATA_DIR", dir.path, 1)
        let store = ApmeStore()
        XCTAssertTrue(store.open(), "store should open")
        return (store, dir)
    }

    private func cleanup(_ tmp: (store: ApmeStore, dir: URL)) {
        tmp.store.close()
        try? FileManager.default.removeItem(at: tmp.dir)
        unsetenv("AGENTDECK_DATA_DIR")
    }

    /// Bring up a collector with an active hook session so UserPromptSubmit /
    /// PostToolUse events are attributed to a real run. Returns the runId.
    @discardableResult
    private func openSessionAndRun(_ collector: ApmeCollector) -> String {
        collector.handleHook(event: "session_start", data: [
            "agent_type": "claude-code",
            "project_name": "demo",
        ])
        // The generated runId is internal — fetch it by scanning the newest
        // run. Tests only run one at a time against a fresh DB.
        return ""
    }

    // MARK: - allTodosCompleted (helper unit)

    func testAllTodosCompleted_trueWhenEveryStatusIsCompleted() {
        let data: [String: Any] = [
            "tool_name": "TodoWrite",
            "tool_input": [
                "todos": [
                    ["content": "a", "status": "completed"],
                    ["content": "b", "status": "completed"],
                ]
            ],
        ]
        XCTAssertTrue(ApmeCollector.allTodosCompleted(data: data))
    }

    func testAllTodosCompleted_falseWhenAnyTodoIsInProgress() {
        let data: [String: Any] = [
            "tool_name": "TodoWrite",
            "tool_input": [
                "todos": [
                    ["content": "a", "status": "completed"],
                    ["content": "b", "status": "in_progress"],
                ]
            ],
        ]
        XCTAssertFalse(ApmeCollector.allTodosCompleted(data: data))
    }

    func testAllTodosCompleted_falseWhenTodosMissingOrEmpty() {
        XCTAssertFalse(ApmeCollector.allTodosCompleted(data: [:]))
        XCTAssertFalse(ApmeCollector.allTodosCompleted(data: [
            "tool_input": ["todos": []],
        ]))
    }

    // MARK: - Task lifecycle through handleHook

    func testFirstUserPromptOpensTaskAndAttachesTurn() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let collector = ApmeCollector(store: store)
        openSessionAndRun(collector)

        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "hello"])

        // Find the run (there is exactly one).
        guard let run = store.listRuns().first else { return XCTFail("no run") }
        let tasks = store.listTasksForRun(run.id)
        XCTAssertEqual(tasks.count, 1, "exactly one task opened on first prompt")
        XCTAssertEqual(tasks[0].taskIndex, 0)
        XCTAssertNil(tasks[0].endedAt, "task still open until boundary")
        XCTAssertEqual(tasks[0].boundarySignal, "open")

        // Turn is attached to the task.
        let turns = store.listTurns(runId: run.id)
        XCTAssertEqual(turns.count, 1)
        XCTAssertEqual(turns[0]["task_id"] as? String, tasks[0].id)

        XCTAssertEqual(collector.activeTaskId, tasks[0].id)
    }

    func testTodoWriteAllCompletedClosesActiveTask() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let collector = ApmeCollector(store: store)
        openSessionAndRun(collector)

        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "build plan"])
        collector.handleHook(event: "PostToolUse", data: [
            "tool_name": "TodoWrite",
            "tool_input": [
                "todos": [
                    ["content": "a", "status": "completed"],
                    ["content": "b", "status": "completed"],
                ]
            ],
        ])

        guard let run = store.listRuns().first else { return XCTFail("no run") }
        let tasks = store.listTasksForRun(run.id)
        XCTAssertEqual(tasks.count, 1)
        XCTAssertEqual(tasks[0].boundarySignal, "todo_complete")
        XCTAssertNotNil(tasks[0].endedAt, "boundary hit should stamp ended_at")
        XCTAssertNil(collector.activeTaskId, "no active task after boundary")
    }

    func testTodoWritePartialDoesNotCloseTask() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let collector = ApmeCollector(store: store)
        openSessionAndRun(collector)

        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "p"])
        collector.handleHook(event: "PostToolUse", data: [
            "tool_name": "TodoWrite",
            "tool_input": [
                "todos": [
                    ["content": "a", "status": "completed"],
                    ["content": "b", "status": "in_progress"],
                ]
            ],
        ])

        guard let run = store.listRuns().first else { return XCTFail("no run") }
        let tasks = store.listTasksForRun(run.id)
        XCTAssertEqual(tasks.count, 1)
        XCTAssertNil(tasks[0].endedAt)
        XCTAssertEqual(tasks[0].boundarySignal, "open")
    }

    func testSecondUserPromptAfterBoundaryOpensNewTask() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let collector = ApmeCollector(store: store)
        openSessionAndRun(collector)

        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "first"])
        collector.handleHook(event: "PostToolUse", data: [
            "tool_name": "TodoWrite",
            "tool_input": ["todos": [["content": "a", "status": "completed"]]],
        ])
        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "second"])

        guard let run = store.listRuns().first else { return XCTFail("no run") }
        let tasks = store.listTasksForRun(run.id)
        XCTAssertEqual(tasks.count, 2, "second prompt opens a new task")
        XCTAssertEqual(tasks[0].taskIndex, 0)
        XCTAssertEqual(tasks[1].taskIndex, 1)
        XCTAssertNotNil(tasks[0].endedAt)
        XCTAssertNil(tasks[1].endedAt)
    }

    func testSessionEndClosesActiveTaskWithSessionEndBoundary() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let collector = ApmeCollector(store: store)
        openSessionAndRun(collector)

        collector.handleHook(event: "UserPromptSubmit", data: ["prompt": "x"])
        // Must grab runId BEFORE session_end — sessionToRun clears it there.
        guard let run = store.listRuns().first else { return XCTFail("no run") }

        collector.handleHook(event: "session_end", data: [:])

        let tasks = store.listTasksForRun(run.id)
        XCTAssertEqual(tasks.count, 1)
        XCTAssertEqual(tasks[0].boundarySignal, "session_end")
        XCTAssertNotNil(tasks[0].endedAt)
    }

    // MARK: - parseJudgeJson summary extraction

    func testParseJudgeJsonExtractsSummaryAndScores() {
        let raw = #"""
        {
          "summary": "Added task boundary detection.",
          "completion": 0.9,
          "coherence": 0.8,
          "efficiency": 0.7,
          "overall": 0.85,
          "reasoning": "agent delivered end-to-end",
          "done": ["boundary detection"],
          "missed": []
        }
        """#
        guard let parsed = ApmeRunner.parseJudgeJson(raw) else {
            return XCTFail("parseJudgeJson returned nil")
        }
        XCTAssertEqual(parsed.summary, "Added task boundary detection.")
        XCTAssertEqual(parsed.scores["overall"] ?? -1, 0.85, accuracy: 0.001)
        XCTAssertEqual(parsed.scores["completion"] ?? -1, 0.9, accuracy: 0.001)
        XCTAssertEqual(parsed.scores["coherence"] ?? -1, 0.8, accuracy: 0.001)
        XCTAssertEqual(parsed.scores["efficiency"] ?? -1, 0.7, accuracy: 0.001)
        XCTAssertEqual(parsed.done ?? [], ["boundary detection"])
    }

    func testParseJudgeJsonSummaryIsOptional() {
        // No summary field — the existing turn/run eval path must still parse.
        let raw = #"{"overall": 0.5, "reasoning": ""}"#
        guard let parsed = ApmeRunner.parseJudgeJson(raw) else {
            return XCTFail("parseJudgeJson returned nil")
        }
        XCTAssertNil(parsed.summary)
        XCTAssertEqual(parsed.scores["overall"] ?? -1, 0.5, accuracy: 0.001)
    }

    func testParseJudgeJsonSummaryClippedTo280() {
        let longStr = String(repeating: "x", count: 400)
        let raw = "{\"summary\":\"\(longStr)\",\"overall\":0.5}"
        guard let parsed = ApmeRunner.parseJudgeJson(raw) else {
            return XCTFail("parseJudgeJson returned nil")
        }
        XCTAssertEqual(parsed.summary?.count, 280, "summary defensively clipped")
    }

    // MARK: - task_rollup rubric seeded

    func testTaskRollupRubricSeededOnOpen() throws {
        let tmp = try makeTempStore()
        defer { cleanup(tmp) }
        let store = tmp.store
        let rubric = store.getCurrentRubric(purpose: "task_rollup")
        XCTAssertNotNil(rubric, "task_rollup rubric should be seeded")
        if let prompt = rubric?["prompt"] as? String {
            XCTAssertTrue(prompt.contains("completion"), "rubric covers completion axis")
            XCTAssertTrue(prompt.contains("summary"), "rubric asks for summary")
        }
    }
}
#endif
