// TimelineTests.swift — Timeline store and grouping tests

import XCTest
@testable import AgentDeck

final class TimelineTests: XCTestCase {

    // MARK: - Timeline Entry Decoding

    func testDecodeTimelineEvent() throws {
        let json = """
        {
            "type": "timeline_event",
            "entry": {
                "ts": 1710200000000,
                "type": "tool_request",
                "raw": "Read src/main.ts",
                "detail": "Reading file contents",
                "status": "pending"
            }
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .timelineEvent(let e) = event else {
            XCTFail("Expected timelineEvent")
            return
        }

        XCTAssertEqual(e.entry.type, .toolRequest)
        XCTAssertEqual(e.entry.raw, "Read src/main.ts")
        XCTAssertEqual(e.entry.detail, "Reading file contents")
        XCTAssertEqual(e.entry.status, "pending")
    }

    func testDecodeTimelineHistory() throws {
        let json = """
        {
            "type": "timeline_history",
            "entries": [
                {"ts": 1710200000000, "type": "chat_start", "raw": "Starting chat"},
                {"ts": 1710200010000, "type": "tool_request", "raw": "Read file"},
                {"ts": 1710200020000, "type": "chat_end", "raw": "Done"}
            ]
        }
        """

        let event = BridgeEventParser.parse(json)
        guard case .timelineHistory(let e) = event else {
            XCTFail("Expected timelineHistory")
            return
        }

        XCTAssertEqual(e.entries.count, 3)
        XCTAssertEqual(e.entries[0].type, .chatStart)
        XCTAssertEqual(e.entries[2].type, .chatEnd)
    }

    // MARK: - Task hierarchy + lenient unknown-type decode (Phase 1)

    func testDecodeTaskStartEntry() throws {
        let json = """
        {
          "ts": 1710200000000,
          "type": "task_start",
          "raw": "Task 1",
          "taskId": "task-abc",
          "sessionId": "sess-1",
          "runId": "run-1",
          "startedAt": 1710200000000
        }
        """.data(using: .utf8)!
        let entry = try JSONDecoder().decode(TimelineEntry.self, from: json)
        XCTAssertEqual(entry.type, .taskStart)
        XCTAssertEqual(entry.taskId, "task-abc")
        XCTAssertEqual(entry.sessionId, "sess-1")
    }

    func testDecodeTaskEndWithBoundarySignal() throws {
        let json = """
        {
          "ts": 1710200060000,
          "type": "task_end",
          "raw": "TODO done · 60s",
          "taskId": "task-abc",
          "boundarySignal": "todo_complete",
          "startedAt": 1710200000000,
          "endedAt": 1710200060000
        }
        """.data(using: .utf8)!
        let entry = try JSONDecoder().decode(TimelineEntry.self, from: json)
        XCTAssertEqual(entry.type, .taskEnd)
        XCTAssertEqual(entry.boundarySignal, .todoComplete)
    }

    func testUnknownTimelineEntryTypeDecodesToUnknown() throws {
        // A future protocol could add a new entry type. The lenient enum must
        // decode it into `.unknown(raw)` so old clients don't crash on the
        // first entry of the new type.
        let json = """
        { "ts": 1, "type": "future_thing", "raw": "x" }
        """.data(using: .utf8)!
        let entry = try JSONDecoder().decode(TimelineEntry.self, from: json)
        switch entry.type {
        case .unknown(let raw):
            XCTAssertEqual(raw, "future_thing")
        default:
            XCTFail("expected .unknown, got \(entry.type)")
        }
    }

    func testTimelineEntryRoundTripsTaskId() throws {
        let original = TimelineEntry(
            ts: 1, type: .toolRequest, raw: "edit",
            taskId: "task-123"
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(TimelineEntry.self, from: data)
        XCTAssertEqual(decoded.taskId, "task-123")
    }

    func testTimelineEntryRoundTripsSummaryKind() throws {
        let original = TimelineEntry(
            ts: 1, type: .chatEnd, raw: "Refactor · 4s",
            summaryKind: "heuristic"
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(TimelineEntry.self, from: data)
        XCTAssertEqual(decoded.summaryKind, "heuristic")
    }

    // MARK: - groupConsecutive — task entries never group

    func testTaskEntriesNeverGroup() {
        let entries = [
            TimelineEntry(ts: 1000, type: .taskStart, raw: "Task 1", taskId: "a"),
            TimelineEntry(ts: 2000, type: .taskStart, raw: "Task 1", taskId: "b"),
            TimelineEntry(ts: 3000, type: .taskEnd,   raw: "Task 1", taskId: "a"),
            TimelineEntry(ts: 4000, type: .taskEnd,   raw: "Task 1", taskId: "b"),
        ]
        let grouped = groupConsecutive(entries)
        // Each task entry must remain its own group (never collapsed by
        // identical raw within window).
        XCTAssertEqual(grouped.count, 4)
        XCTAssertTrue(grouped.allSatisfy { $0.count == 1 })
    }

    // MARK: - Grouping

    func testGroupConsecutiveSameType() {
        let entries = [
            TimelineEntry(ts: 1000, type: .toolRequest, raw: "Read file"),
            TimelineEntry(ts: 2000, type: .toolRequest, raw: "Read file"),
            TimelineEntry(ts: 3000, type: .toolRequest, raw: "Read file"),
        ]

        let grouped = groupConsecutive(entries, windowSeconds: 60)
        XCTAssertEqual(grouped.count, 1)
        XCTAssertEqual(grouped[0].count, 3)
    }

    func testGroupConsecutiveDifferentTypes() {
        let entries = [
            TimelineEntry(ts: 1000, type: .toolRequest, raw: "Read file"),
            TimelineEntry(ts: 2000, type: .chatStart, raw: "Starting"),
            TimelineEntry(ts: 3000, type: .toolRequest, raw: "Read file"),
        ]

        let grouped = groupConsecutive(entries, windowSeconds: 60)
        XCTAssertEqual(grouped.count, 3)
    }

    func testGroupConsecutiveWindowBreak() {
        let entries = [
            TimelineEntry(ts: 0, type: .toolRequest, raw: "Read file"),
            TimelineEntry(ts: 120_000, type: .toolRequest, raw: "Read file"), // 2 min later
        ]

        let grouped = groupConsecutive(entries, windowSeconds: 60)
        XCTAssertEqual(grouped.count, 2)
    }

    func testGroupConsecutiveEmpty() {
        let grouped = groupConsecutive([], windowSeconds: 60)
        XCTAssertEqual(grouped.count, 0)
    }

    // MARK: - Timeline Store

    func testTimelineStoreAdd() {
        let store = TimelineStore()
        store.addEntry(TimelineEntry(ts: 1000, type: .chatStart, raw: "Start"))
        store.addEntry(TimelineEntry(ts: 2000, type: .toolRequest, raw: "Read"))

        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.grouped.count, 2)
    }

    func testTimelineStoreUpsert() {
        let store = TimelineStore()
        store.addEntry(TimelineEntry(ts: 1000, type: .toolRequest, raw: "Read", status: "pending"))
        store.addEntry(TimelineEntry(ts: 1000, type: .toolRequest, raw: "Read", status: "approved"), upsert: true)

        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries[0].status, "approved")
    }

    func testTimelineStoreMergeHistory() {
        let store = TimelineStore()
        store.addEntry(TimelineEntry(ts: 2000, type: .chatStart, raw: "Current"))

        store.mergeHistory([
            TimelineEntry(ts: 1000, type: .chatStart, raw: "Old"),
            TimelineEntry(ts: 2000, type: .chatStart, raw: "Dupe"),  // should be deduped
            TimelineEntry(ts: 3000, type: .chatEnd, raw: "New"),
        ])

        XCTAssertEqual(store.entries.count, 3)
        // Should be sorted by ts
        XCTAssertEqual(store.entries[0].ts, 1000)
        XCTAssertEqual(store.entries[1].ts, 2000)
        XCTAssertEqual(store.entries[2].ts, 3000)
    }

    func testTimelineStoreMaxEntries() {
        let store = TimelineStore()
        for i in 0..<250 {
            store.addEntry(TimelineEntry(ts: Double(i), type: .chatStart, raw: "Entry \(i)"))
        }

        XCTAssertEqual(store.entries.count, 200)
        // Oldest should have been trimmed
        XCTAssertEqual(store.entries[0].ts, 50)
    }

    func testDashboardDisplayKeepsMeaningfulPromptAfterCompletion() {
        let entries = [
            TimelineEntry(
                ts: 1000,
                type: .chatStart,
                raw: "hello",
                agentType: "claude-code",
                projectName: "AgentDeck",
                sessionId: "s1",
                startedAt: 1000
            ),
            TimelineEntry(
                ts: 2000,
                type: .chatResponse,
                raw: "Hello. What do you want to work on?",
                agentType: "claude-code",
                projectName: "AgentDeck",
                sessionId: "s1",
                startedAt: 1000,
                endedAt: 2000
            ),
            TimelineEntry(
                ts: 2001,
                type: .chatEnd,
                raw: "Completed · 1s",
                agentType: "claude-code",
                projectName: "AgentDeck",
                sessionId: "s1",
                startedAt: 1000,
                endedAt: 2001
            ),
        ]

        let displayed = timelineDisplayGroupsForDashboard(groupConsecutive(entries))
        XCTAssertEqual(displayed.map(\.entry.type), [.chatStart, .chatResponse])
        XCTAssertEqual(displayed.first?.entry.raw, "hello")
    }

    func testDashboardDisplayStillHidesSyntheticCompletedStart() {
        let entries = [
            TimelineEntry(
                ts: 1000,
                type: .chatStart,
                raw: "Prompt sent",
                agentType: "claude-code",
                sessionId: "s1",
                startedAt: 1000
            ),
            TimelineEntry(
                ts: 2000,
                type: .chatEnd,
                raw: "Completed · 1s",
                agentType: "claude-code",
                sessionId: "s1",
                startedAt: 1000,
                endedAt: 2000
            ),
        ]

        let displayed = timelineDisplayGroupsForDashboard(groupConsecutive(entries))
        XCTAssertEqual(displayed.map(\.entry.type), [.chatEnd])
    }

    func testDashboardDisplayDropsAnonymousCodexToolNoise() {
        let entries = [
            TimelineEntry(
                ts: 1000,
                type: .toolExec,
                raw: "tool completed",
                agentType: "codex-cli",
                sessionId: "codex:otel-active"
            ),
            TimelineEntry(
                ts: 2000,
                type: .chatStart,
                raw: "Fix timeline grouping",
                agentType: "codex-cli",
                sessionId: "codex:thread-123456"
            ),
        ]

        let displayed = timelineDisplayGroupsForDashboard(groupConsecutive(entries))
        XCTAssertEqual(displayed.count, 1)
        XCTAssertEqual(displayed[0].entry.raw, "Fix timeline grouping")
    }

    #if os(macOS)
    func testDaemonTimelineStoreDropsAnonymousCodexToolNoise() async {
        let store = DaemonTimelineStore()
        await store.add(DaemonTimelineEntry(
            ts: 1000,
            type: "tool_exec",
            raw: "exec completed",
            detail: nil,
            approvalId: nil,
            status: nil,
            agentType: "codex-cli",
            repeatCount: nil,
            automated: nil,
            projectName: nil,
            sessionId: "codex:otel-active",
            startedAt: nil,
            endedAt: nil,
            runId: nil
        ))
        await store.add(DaemonTimelineEntry(
            ts: 2000,
            type: "chat_start",
            raw: "Fix timeline grouping",
            detail: nil,
            approvalId: nil,
            status: nil,
            agentType: "codex-cli",
            repeatCount: nil,
            automated: nil,
            projectName: "AgentDeck",
            sessionId: "codex:thread-123456",
            startedAt: 2000,
            endedAt: nil,
            runId: nil
        ))

        let entries = await store.getAll()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].raw, "Fix timeline grouping")
    }
    #endif

    // MARK: - Type Icons (semantic key + ASCII fallback)

    func testTimelineIconKeys() {
        XCTAssertEqual(timelineIconKey(for: .chatStart), .running)
        XCTAssertEqual(timelineIconKey(for: .chatEnd), .success)
        XCTAssertEqual(timelineIconKey(for: .error), .error)
        XCTAssertEqual(timelineIconKey(for: .toolRequest), .awaiting)
        XCTAssertEqual(timelineIconKey(for: .toolRequest, status: "approved"), .success)
        XCTAssertEqual(timelineIconKey(for: .toolRequest, status: "denied"), .error)
        XCTAssertEqual(timelineIconKey(for: .taskStart), .task)
        XCTAssertEqual(timelineIconKey(for: .taskEnd), .task)
    }

    func testTypeIconsAsciiFallback() {
        // ASCII fallback used by preview snapshots / monospaced contexts.
        // SwiftUI renders the SF Symbol via `sfSymbol(for:)`; this glyph
        // is the secondary surface.
        XCTAssertEqual(timelineTypeIcon(for: .chatStart), "▶")
        XCTAssertEqual(timelineTypeIcon(for: .chatEnd), "✓")
        XCTAssertEqual(timelineTypeIcon(for: .error), "✗")
        XCTAssertEqual(timelineTypeIcon(for: .toolRequest), "⏳")
    }
}
