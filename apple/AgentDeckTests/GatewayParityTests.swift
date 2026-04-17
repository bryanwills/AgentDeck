// GatewayParityTests.swift — Swift-side counterpart of
// `bridge/src/__tests__/gateway-parity-fixtures.test.ts`.
//
// Decodes every JSON fixture under `tests/parity/gateway-frames/` and asserts
// the same discriminator/shape invariants the Node adapter relies on. Both
// test suites walk the same directory, so adding/removing a fixture on either
// side surfaces immediately across languages.

import XCTest

final class GatewayParityTests: XCTestCase {

    // MARK: - Fixture loading

    /// Repo-root-relative path to the shared parity fixtures. Computed from
    /// `#filePath` so the test works regardless of the xctest bundle layout.
    private static func fixtureDirectory() -> URL {
        // #filePath → .../apple/AgentDeckTests/GatewayParityTests.swift
        let thisFile = URL(fileURLWithPath: #filePath)
        return thisFile
            .deletingLastPathComponent()   // AgentDeckTests
            .deletingLastPathComponent()   // apple
            .deletingLastPathComponent()   // repo root
            .appendingPathComponent("tests/parity/gateway-frames", isDirectory: true)
    }

    private struct Fixture {
        let name: String
        let url: URL
        let data: Data
        let json: [String: Any]
    }

    private func loadFixtures() throws -> [Fixture] {
        let dir = Self.fixtureDirectory()
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: dir.path),
            "Gateway parity fixture dir missing: \(dir.path)"
        )
        let names = try FileManager.default
            .contentsOfDirectory(atPath: dir.path)
            .filter { $0.hasSuffix(".json") }
            .sorted()

        return try names.map { name in
            let url = dir.appendingPathComponent(name)
            let data = try Data(contentsOf: url)
            guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(
                    domain: "GatewayParityTests",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Fixture \(name) is not a JSON object"]
                )
            }
            return Fixture(name: name, url: url, data: data, json: obj)
        }
    }

    // MARK: - Mirror of bridge/src/__tests__/gateway-parity-fixtures.test.ts

    func testFixtureSetIsNonEmpty() throws {
        let fixtures = try loadFixtures()
        XCTAssertFalse(fixtures.isEmpty, "Expected at least one .json fixture under tests/parity/gateway-frames/")
    }

    func testEveryFixtureCarriesValidFrameDiscriminator() throws {
        let valid: Set<String> = ["req", "res", "event"]
        for f in try loadFixtures() {
            let type = f.json["type"] as? String
            XCTAssertNotNil(type, "[\(f.name)] missing `type` discriminator")
            if let type {
                XCTAssertTrue(valid.contains(type), "[\(f.name)] unknown frame type: \(type)")
            }
        }
    }

    func testEveryFixtureConformsToItsFrameShape() throws {
        for f in try loadFixtures() {
            let type = f.json["type"] as? String ?? ""

            switch type {
            case "req":
                XCTAssertTrue(f.json["id"] is String, "[\(f.name)] req.id must be String")
                XCTAssertTrue(f.json["method"] is String, "[\(f.name)] req.method must be String")
                XCTAssertTrue(f.json["params"] is [String: Any], "[\(f.name)] req.params must be object")

            case "res":
                XCTAssertTrue(f.json["id"] is String, "[\(f.name)] res.id must be String")
                let ok = f.json["ok"] as? Bool
                XCTAssertNotNil(ok, "[\(f.name)] res.ok must be Bool")
                if ok == true {
                    XCTAssertNotNil(f.json["payload"], "[\(f.name)] ok=true res must carry payload")
                } else {
                    guard let error = f.json["error"] as? [String: Any] else {
                        XCTFail("[\(f.name)] ok=false res must carry error object")
                        continue
                    }
                    XCTAssertTrue(error["code"] is String, "[\(f.name)] error.code must be String")
                    XCTAssertTrue(error["message"] is String, "[\(f.name)] error.message must be String")
                }

            case "event":
                XCTAssertTrue(f.json["event"] is String, "[\(f.name)] event name must be String")
                XCTAssertTrue(f.json["payload"] is [String: Any], "[\(f.name)] event.payload must be object")

            default:
                XCTFail("[\(f.name)] unexpected type: \(type)")
            }
        }
    }

    // MARK: - Adapter-contract fixtures

    func testChatFinalFixtureCarriesFieldsTheAdapterDependsOn() throws {
        let fixtures = try loadFixtures()
        guard let f = fixtures.first(where: { $0.name == "chat-final-with-tools.json" }) else {
            XCTFail("chat-final-with-tools.json fixture not found")
            return
        }
        XCTAssertEqual(f.json["type"] as? String, "event")
        XCTAssertEqual(f.json["event"] as? String, "chat")

        let payload = f.json["payload"] as? [String: Any] ?? [:]
        XCTAssertEqual(payload["state"] as? String, "final")
        XCTAssertTrue(payload["response"] is String, "final payload must carry `response` string")
        XCTAssertTrue(payload["tools"] is [Any], "final payload must carry `tools` array")
        XCTAssertTrue(payload["modelId"] is String, "final payload must carry `modelId` string")
    }

    func testExecApprovalRequestedFixtureExposesOptionsForTheUserPrompt() throws {
        let fixtures = try loadFixtures()
        guard let f = fixtures.first(where: { $0.name == "exec-approval-requested.json" }) else {
            XCTFail("exec-approval-requested.json fixture not found")
            return
        }
        XCTAssertEqual(f.json["type"] as? String, "event")
        XCTAssertEqual(f.json["event"] as? String, "exec.approval.requested")

        let payload = f.json["payload"] as? [String: Any] ?? [:]
        XCTAssertTrue(payload["id"] is String, "approval.requested must carry `id` string")

        guard let options = payload["options"] as? [[String: Any]] else {
            XCTFail("approval.requested must carry `options` array")
            return
        }
        XCTAssertGreaterThanOrEqual(options.count, 2, "approval options should include at least allow+deny")
        for (idx, opt) in options.enumerated() {
            XCTAssertTrue(opt["key"] is String, "options[\(idx)].key must be String")
            XCTAssertTrue(opt["label"] is String, "options[\(idx)].label must be String")
        }
    }

    // MARK: - Typed Codable round-trip

    /// Narrow Codable mirror of the three frame envelopes. The generated
    /// `ADGatewayFrame` (quicktype) currently lives only in the main app
    /// target, so the tests keep a local decode-only shim. The goal is to
    /// prove JSONDecoder succeeds on every fixture — the field-level shape
    /// assertions above still use JSONSerialization (matches the TS test).
    private struct FrameEnvelope: Decodable {
        let type: String
        let id: String?
        let method: String?
        let event: String?
        let ok: Bool?
    }

    func testEveryFixtureDecodesWithJSONDecoder() throws {
        let decoder = JSONDecoder()
        for f in try loadFixtures() {
            XCTAssertNoThrow(
                try decoder.decode(FrameEnvelope.self, from: f.data),
                "[\(f.name)] JSONDecoder failed on envelope"
            )
            let envelope = try decoder.decode(FrameEnvelope.self, from: f.data)
            switch envelope.type {
            case "req":
                XCTAssertNotNil(envelope.id, "[\(f.name)] req.id missing after decode")
                XCTAssertNotNil(envelope.method, "[\(f.name)] req.method missing after decode")
            case "res":
                XCTAssertNotNil(envelope.id, "[\(f.name)] res.id missing after decode")
                XCTAssertNotNil(envelope.ok, "[\(f.name)] res.ok missing after decode")
            case "event":
                XCTAssertNotNil(envelope.event, "[\(f.name)] event name missing after decode")
            default:
                XCTFail("[\(f.name)] unexpected envelope type: \(envelope.type)")
            }
        }
    }
}
