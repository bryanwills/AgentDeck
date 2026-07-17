#if os(macOS)
import XCTest
@testable import AgentDeck

/// Regression guard for the WiFi-WS ESP32 flap fix.
///
/// A WiFi ESP32 board is a *display* client, not a dashboard. It must ONLY ever
/// receive the whitelisted, `prepareForSerial`-shrunk event stream — never the
/// full dashboard-state fanout. The regression that these tests exist to prevent
/// (commit f7443d42) blasted the full state at every ESP32 board on every
/// (re)connect, overran their small buffers over congested 2.4 GHz, and flapped
/// the socket every few seconds in a self-reinforcing storm. If someone routes
/// unshrunk / non-display events at ESP32 boards again, these fail.
/// See memory `esp32-wifi-flap-broadcast-amplification`.
final class ESP32WifiForwardTests: XCTestCase {

    /// Dashboard-only events must be dropped (nil) for a display board.
    func testNonForwardedEventIsDroppedForEsp32() {
        let dashboardOnly: [[String: Any]] = [
            ["type": "apme_eval", "scorecard": ["x": 1]],
            ["type": "sessions_update_internal"],
            ["type": "recommend_result"],
        ]
        for ev in dashboardOnly {
            XCTAssertNil(
                ESP32Serial.wifiEsp32Forward(ev, deviceInfo: nil),
                "non-forwarded event \(ev["type"] ?? "?") must be dropped for WiFi ESP32")
        }
    }

    /// A forwarded event is delivered but STRIPPED of heavy dashboard-only fields —
    /// that shrink is exactly what keeps the board's buffer from overrunning.
    func testForwardedStateUpdateIsShrunkNotFull() {
        let full: [String: Any] = [
            "type": "state_update",
            "agentType": "claude",
            "modelCatalog": ["big": Array(repeating: "x", count: 200)],
            "moduleHealth": ["serial": ["connected": true]],
            "subscriptions": ["a", "b"],
        ]
        guard let out = ESP32Serial.wifiEsp32Forward(full, deviceInfo: nil) else {
            return XCTFail("state_update must be forwarded to WiFi ESP32 boards")
        }
        XCTAssertEqual(out["type"] as? String, "state_update")
        XCTAssertNil(out["modelCatalog"], "modelCatalog must be stripped for ESP32 display boards")
        XCTAssertNil(out["moduleHealth"], "moduleHealth must be stripped for ESP32 display boards")
        XCTAssertNil(out["subscriptions"], "subscriptions must be stripped for ESP32 display boards")
        XCTAssertEqual(out["agentType"] as? String, "claude", "display-relevant fields survive the shrink")
    }

    /// Timeline rows must be capped to the firmware's byte-sized TimelineEntry
    /// buffers on a UTF-8 character boundary. Uncapped raw let the board's
    /// 119-byte strncpy cut mid-한글 and the IPS10 cards / InkDeck ticker drew a
    /// broken trailing glyph (Node parity: bridge/src/esp32-serial.ts `stamp`).
    func testTimelineEventRawIsByteCappedUtf8Safe() {
        let raw = String(repeating: "가", count: 60)   // 180 UTF-8 bytes, 60 Characters
        let ev: [String: Any] = [
            "type": "timeline_event",
            "entry": ["ts": 1_752_700_000_000, "type": "chat_start", "raw": raw,
                      "detail": String(repeating: "나", count: 100),
                      "projectName": String(repeating: "다", count: 30)],
        ]
        guard let out = ESP32Serial.wifiEsp32Forward(ev, deviceInfo: nil),
              let entry = out["entry"] as? [String: Any],
              let outRaw = entry["raw"] as? String,
              let outDetail = entry["detail"] as? String,
              let outProject = entry["projectName"] as? String else {
            return XCTFail("timeline_event must be forwarded with a shrunk entry")
        }
        XCTAssertLessThanOrEqual(outRaw.utf8.count, 119)
        XCTAssertEqual(outRaw, String(repeating: "가", count: 39), "cut must land on a character boundary")
        XCTAssertLessThanOrEqual(outDetail.utf8.count, 199)
        XCTAssertLessThanOrEqual(outProject.utf8.count, 39)
    }

    /// History seeds are capped to the firmware ring (newest 64) with each entry shrunk.
    func testTimelineHistoryCappedToFirmwareRing() {
        let entries: [[String: Any]] = (0..<100).map { ["ts": $0, "type": "chat_start", "raw": "row \($0)"] }
        let ev: [String: Any] = ["type": "timeline_history", "entries": entries]
        guard let out = ESP32Serial.wifiEsp32Forward(ev, deviceInfo: nil),
              let outEntries = out["entries"] as? [[String: Any]] else {
            return XCTFail("timeline_history must be forwarded")
        }
        XCTAssertEqual(outEntries.count, 64)
        XCTAssertEqual(outEntries.first?["raw"] as? String, "row 36", "newest 64 survive")
        XCTAssertEqual(outEntries.last?["raw"] as? String, "row 99")
    }

    /// sessions_list string caps are UTF-8 BYTE budgets, not Character counts —
    /// 39 한글 Characters would be 117 bytes and overflow projectName[40] on-device.
    func testSessionsListCapsAreByteBudgets() {
        let ev: [String: Any] = [
            "type": "sessions_list",
            "sessions": [["id": "s1", "alive": true,
                          "projectName": String(repeating: "가", count: 39)]],
        ]
        guard let out = ESP32Serial.wifiEsp32Forward(ev, deviceInfo: nil),
              let sessions = out["sessions"] as? [[String: Any]],
              let project = sessions.first?["projectName"] as? String else {
            return XCTFail("sessions_list must be forwarded")
        }
        XCTAssertLessThanOrEqual(project.utf8.count, 39)
        XCTAssertEqual(project, String(repeating: "가", count: 13))
    }

    /// The daemon-computed lastEvent* milestone fields (TIMELINE parity for the
    /// IPS10 cards) survive the sessions_list shrink — byte-capped, and omitted
    /// entirely when absent (empty strings would waste the serial line budget).
    func testSessionsListLastEventFieldsForwardedConditionally() {
        let ev: [String: Any] = [
            "type": "sessions_list",
            "sessions": [
                ["id": "s1", "alive": true,
                 "lastEventText": String(repeating: "가", count: 60),
                 "lastEventTask": "ips10 카드 개선", "lastEventHm": "14:07"],
                ["id": "s2", "alive": true],
            ],
        ]
        guard let out = ESP32Serial.wifiEsp32Forward(ev, deviceInfo: nil),
              let sessions = out["sessions"] as? [[String: Any]] else {
            return XCTFail("sessions_list must be forwarded")
        }
        let withEvent = sessions[0]
        XCTAssertLessThanOrEqual((withEvent["lastEventText"] as? String)?.utf8.count ?? 999, 99)
        XCTAssertEqual(withEvent["lastEventTask"] as? String, "ips10 카드 개선")
        XCTAssertEqual(withEvent["lastEventHm"] as? String, "14:07")
        let without = sessions[1]
        XCTAssertNil(without["lastEventText"], "absent milestone must be omitted, not sent as empty string")
        XCTAssertNil(without["lastEventTask"])
        XCTAssertNil(without["lastEventHm"])
    }

    /// The whitelist must cover the display events a board renders, and match the
    /// USB-serial path (single source of truth: `serialForwardedEvents`).
    func testDisplayEventWhitelistForwarded() {
        for t in ["state_update", "usage_update", "sessions_list", "display_state", "timeline_event", "timeline_history"] {
            XCTAssertTrue(ESP32Serial.serialForwardedEvents.contains(t), "\(t) should be a forwarded display event")
            XCTAssertNotNil(
                ESP32Serial.wifiEsp32Forward(["type": t], deviceInfo: nil),
                "display event \(t) must be forwarded to WiFi ESP32 boards")
        }
    }
}
#endif
