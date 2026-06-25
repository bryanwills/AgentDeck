import XCTest
#if os(macOS)
@testable import AgentDeck

final class SessionLauncherTests: XCTestCase {
    func testDaemonPromotionUsesCurrentFallbackPort() {
        XCTAssertEqual(
            DaemonService.promotionTargetPort(currentPort: 9124, effectivePort: 9120),
            9124
        )
    }

    func testDaemonPromotionFallsBackToConfiguredPortWhenDisconnected() {
        XCTAssertEqual(
            DaemonService.promotionTargetPort(currentPort: 0, effectivePort: 9120),
            9120
        )
    }

    func testResolvedSessionOverrideTracksActualBoundPort() {
        XCTAssertEqual(
            DaemonService.resolvedSessionOverridePort(configuredPort: 9120, actualPort: 9124),
            9124
        )
        XCTAssertNil(
            DaemonService.resolvedSessionOverridePort(configuredPort: 9124, actualPort: 9124)
        )
    }

    func testDeviceSummaryMirrorsExternalDaemonModuleHealth() {
        let summary = DeviceSummary.make(fromModuleHealth: [
            "adb": [
                "available": true,
                "devices": ["android-1", "android-2"],
                "reverseReadyCount": 1,
                "lastError": NSNull(),
            ],
            "d200h": [
                "connected": true,
                "managerOpened": true,
                "buttonPressCount": 2,
            ],
            "pixoo": [
                "configuredDeviceCount": 1,
                "deviceIps": ["192.168.68.110"],
                "hasFrame": true,
                "devices": [
                    [
                        "ip": "192.168.68.110",
                        "online": true,
                        "failures": 0,
                        "backedOff": false,
                    ],
                ],
            ],
            "trmnl": [
                "deviceCount": 1,
                "currentRefreshRate": 180,
                "telemetry": [
                    [
                        "mac": "AA:BB:CC:DD:EE:FF",
                        "width": 800,
                        "height": 480,
                        "rssi": -62,
                        "secondsSinceSeen": 12,
                        "stale": false,
                    ],
                ],
            ],
            "serial": [
                "connections": [
                    [
                        "port": "/dev/cu.usbmodem1",
                        "connected": true,
                        "deviceInfo": [
                            "board": "ips_35",
                            "version": "1.0.0",
                            "wifiConnected": true,
                        ],
                    ],
                ],
            ],
        ])

        XCTAssertEqual(summary.d200h?.status, .connected)
        XCTAssertEqual(summary.pixoo.count, 1)
        XCTAssertEqual(summary.pixoo.first?.status, .connected)
        XCTAssertEqual(summary.trmnl.count, 1)
        XCTAssertEqual(summary.trmnl.first?.status, .connected)
        XCTAssertEqual(summary.trmnl.first?.kind, .trmnl)
        XCTAssertEqual(summary.serial.count, 1)
        XCTAssertEqual(summary.serial.first?.status, .connected)
        XCTAssertEqual(summary.adb.count, 2)
        XCTAssertEqual(summary.adb.first?.status, .connected)
        XCTAssertEqual(summary.adb.last?.status, .reconnecting)
    }
}
#endif
