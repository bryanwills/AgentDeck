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

    // MARK: - Type Icons

    func testTypeIcons() {
        XCTAssertEqual(typeIcon(for: .chatStart), "▶")
        XCTAssertEqual(typeIcon(for: .chatEnd), "■")
        XCTAssertEqual(typeIcon(for: .error), "✗")
        XCTAssertEqual(typeIcon(for: .toolRequest), "⚡")
    }
}
