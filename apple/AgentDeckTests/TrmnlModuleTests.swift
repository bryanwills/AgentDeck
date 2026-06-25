import XCTest
#if os(macOS)
@testable import AgentDeck

final class TrmnlModuleTests: XCTestCase {
    private var originalDataDir: String?

    override func setUp() {
        super.setUp()
        originalDataDir = ProcessInfo.processInfo.environment["AGENTDECK_DATA_DIR"]
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentdeck-trmnl-\(UUID().uuidString)", isDirectory: true)
        setenv("AGENTDECK_DATA_DIR", dir.path, 1)
    }

    override func tearDown() {
        if let originalDataDir {
            setenv("AGENTDECK_DATA_DIR", originalDataDir, 1)
        } else {
            unsetenv("AGENTDECK_DATA_DIR")
        }
        super.tearDown()
    }

    func testDisplayAutoEnrollsPersistsAndWidensWeakLinkTimeout() async throws {
        let module = TrmnlModule()
        await module.start()

        let response = await module.display(
            headers: [
                "id": "AA:BB:CC:DD:EE:FF",
                "rssi": "-85",
                "width": "800",
                "height": "480",
                "user-agent": "TRMNL/1.5.12",
            ],
            base: "http://127.0.0.1:9120"
        )
        XCTAssertEqual(response.status, 200)

        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: response.body) as? [String: Any])
        XCTAssertEqual(body["status"] as? Int, 0)
        XCTAssertEqual(body["refresh_rate"] as? Int, 180)
        XCTAssertGreaterThanOrEqual(body["image_url_timeout"] as? Int ?? 0, 60)

        let snapshot = await module.statusSnapshot().value
        XCTAssertEqual(snapshot["deviceCount"] as? Int, 1)
        let telemetry = try XCTUnwrap(snapshot["telemetry"] as? [[String: Any]])
        XCTAssertEqual(telemetry.first?["mac"] as? String, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(telemetry.first?["width"] as? Int, 800)

        let persisted = TrmnlSettings.load()
        XCTAssertEqual(persisted.devices.count, 1)
        XCTAssertEqual(persisted.devices.first?.mac, "AA:BB:CC:DD:EE:FF")

        let restarted = TrmnlModule()
        await restarted.start()
        let restartedSnapshot = await restarted.statusSnapshot().value
        XCTAssertEqual(restartedSnapshot["deviceCount"] as? Int, 1)
    }
}
#endif
