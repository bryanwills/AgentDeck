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
