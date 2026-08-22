#if os(macOS)
import XCTest
@testable import AgentDeck

final class MenuBarDensityPolicyTests: XCTestCase {
    func testCollectionDensityUsesStableDetailBands() {
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 0), .detailed)
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 6), .detailed)
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 7), .grouped)
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 15), .grouped)
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 16), .summarized)
        XCTAssertEqual(MenuBarDensityPolicy.collectionDensity(count: 500), .summarized)
    }

    func testIdleSessionRowsAdaptWithoutLosingTheirCount() {
        XCTAssertEqual(MenuBarDensityPolicy.inlineIdleSessionCount(totalSessionCount: 6, idleSessionCount: 6), 6)
        XCTAssertEqual(MenuBarDensityPolicy.inlineIdleSessionCount(totalSessionCount: 7, idleSessionCount: 6), 3)
        XCTAssertEqual(MenuBarDensityPolicy.inlineIdleSessionCount(totalSessionCount: 16, idleSessionCount: 6), 0)
    }

    func testPanelHeightIsIndependentOfCollectionSizeAndRespectsScreenBudget() {
        XCTAssertEqual(MenuBarDensityPolicy.panelHeight(availableHeight: 1_400), 560)
        XCTAssertEqual(MenuBarDensityPolicy.panelHeight(availableHeight: 580), 560)
        XCTAssertEqual(MenuBarDensityPolicy.panelHeight(availableHeight: 470), 450)
    }

    func testSurfaceRollupScalesByFamilyAndDeduplicatesDualHomedESP32() {
        var health = ModuleHealthState()
        health.streamDeck = StreamDeckHealth(devices: [
            StreamDeckDeviceInfo(id: "sd-1", name: "Stream Deck+", family: nil, columns: 4, rows: 2),
            StreamDeckDeviceInfo(id: "sd-2", name: "Stream Deck XL", family: nil, columns: 8, rows: 4),
        ])
        health.eink = EinkHealth(devices: (0..<12).map {
            EinkDeviceInfo(id: "e-\($0)", name: "Panel \($0)", family: "eink", columns: 800, rows: 480)
        })
        health.serial = SerialHealth(connectedBoards: [
            SerialPortInfo(port: "/dev/cu.usbmodem1", board: "inkdeck", firmwareVersion: nil, wifiConnected: true),
        ])
        health.esp32Wifi = Esp32WifiHealth(devices: [
            WifiEsp32DeviceInfo(board: "inkdeck", ip: "10.0.0.2", version: nil, serialActive: true),
            WifiEsp32DeviceInfo(board: "ips10", ip: "10.0.0.3", version: nil, serialActive: false),
        ])

        let rollup = MenuBarSurfaceRollup.make(from: health)

        XCTAssertEqual(rollup.total, 16)
        XCTAssertEqual(rollup.families, [
            MenuBarSurfaceFamily(name: "Controls", count: 2),
            MenuBarSurfaceFamily(name: "E-ink", count: 12),
            MenuBarSurfaceFamily(name: "ESP32", count: 2),
        ])
    }

    func testSurfaceRollupKeepsFailuresVisibleWithoutExpandingRows() {
        var health = ModuleHealthState()
        health.pixoo = PixooHealth(
            configuredDeviceCount: 3,
            hasFrame: true,
            devices: [
                PixooDeviceHealth(ip: "10.0.0.10", online: true, failures: 0, backedOff: false),
                PixooDeviceHealth(ip: "10.0.0.11", online: false, failures: 2, backedOff: true),
            ]
        )
        health.esp32Wifi = Esp32WifiHealth(devices: [
            WifiEsp32DeviceInfo(board: "ips35", ip: "10.0.0.20", version: nil, stale: true, serialActive: false),
        ])

        let rollup = MenuBarSurfaceRollup.make(from: health)

        XCTAssertEqual(rollup.total, 4)
        XCTAssertEqual(rollup.issueCount, 3)
        XCTAssertEqual(rollup.families.map(\.name), ["LED", "ESP32"])
        XCTAssertEqual(rollup.issues, [
            MenuBarSurfaceIssue(label: "Pixoo 10.0.0.11 · offline", count: 1),
            MenuBarSurfaceIssue(label: "Pixoo devices not reporting", count: 1),
            MenuBarSurfaceIssue(label: "ips35 10.0.0.20 · stale", count: 1),
        ])
    }

    func testHundredsOfSurfacesStillProduceOnlyBoundedFamilyRows() {
        var health = ModuleHealthState()
        health.streamDeck = StreamDeckHealth(devices: (0..<100).map {
            StreamDeckDeviceInfo(
                id: "sd-\($0)", name: "Deck \($0)",
                family: nil, columns: nil, rows: nil
            )
        })
        health.eink = EinkHealth(devices: (0..<100).map {
            EinkDeviceInfo(
                id: "e-\($0)", name: "E-ink \($0)",
                family: "eink", columns: nil, rows: nil
            )
        })
        health.pixoo = PixooHealth(configuredDeviceCount: 100)
        health.esp32Wifi = Esp32WifiHealth(devices: (0..<100).map {
            WifiEsp32DeviceInfo(
                board: "ips10", ip: "10.0.1.\($0)", version: nil,
                stale: false, serialActive: false
            )
        })
        health.tuiDashboards = TuiDashboardHealth(devices: (0..<100).map {
            TuiClientInfo(id: "tui-\($0)", name: "Host \($0)")
        })

        let rollup = MenuBarSurfaceRollup.make(from: health)

        XCTAssertEqual(rollup.total, 500)
        XCTAssertEqual(rollup.families.count, 5)
        XCTAssertEqual(rollup.families.map(\.count), [100, 100, 100, 100, 100])
    }

    func testAndroidWifiAndAdbPathsMergeOnlyWithStrongIdentityMatch() {
        var health = ModuleHealthState()
        health.androidDashboards = AndroidDashboardHealth(devices: [
            AndroidDashboardDeviceInfo(id: "wifi-tablet", name: "Lenovo TB-J606F", kind: "tablet"),
            AndroidDashboardDeviceInfo(id: "CREMAA21W09235", name: "Crema S", kind: "eink"),
        ])
        health.adb = AdbHealth(
            available: true,
            devices: ["HVA095B4", "CREMAA21W09235", "OTHER"],
            classifiedDevices: [
                ClassifiedDevice(
                    serial: "HVA095B4", manufacturer: "Lenovo", model: "TB-J606F",
                    deviceClass: AdbDeviceClass.androidTablet.rawValue
                ),
                ClassifiedDevice(
                    serial: "CREMAA21W09235", manufacturer: nil, model: "CREMA-0680S",
                    deviceClass: AdbDeviceClass.eInkCrema.rawValue
                ),
                ClassifiedDevice(
                    serial: "OTHER", manufacturer: nil, model: "Unrelated",
                    deviceClass: AdbDeviceClass.androidTablet.rawValue
                ),
            ]
        )

        let rollup = MenuBarSurfaceRollup.make(from: health)

        XCTAssertEqual(rollup.total, 3)
        XCTAssertEqual(rollup.families, [
            MenuBarSurfaceFamily(name: "E-ink", count: 1),
            MenuBarSurfaceFamily(name: "Apps", count: 2),
        ])
    }
}
#endif
