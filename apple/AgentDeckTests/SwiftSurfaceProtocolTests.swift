#if os(macOS)
import XCTest
@testable import AgentDeck

final class SwiftSurfaceProtocolTests: XCTestCase {
    private func headers(_ overrides: [String: String] = [:]) -> [String: String] {
        var value = [
            "agentdeck-surface-protocol": "1",
            "agentdeck-surface-profile": "portable-reader/v1",
            "agentdeck-client-id": "io.pocketdaily.reader",
            "agentdeck-client-version": "1.4.1-pocket",
            "agentdeck-product-id": "io.pocketdaily.reader",
            "agentdeck-capabilities": "feed.pull,feed.conditional,outbox.push,glance.read,ota.feed,device.telemetry,future.unknown",
            "agentdeck-board": "xteink_x3",
            "agentdeck-update-channel": "stable",
        ]
        value.merge(overrides) { _, new in new }
        return value
    }

    func testHeaderlessFeedRemainsLegacy() throws {
        let identity = try DaemonServer.parseSurfaceHTTPIdentity(
            headers: [:], requiredCapability: "feed.pull"
        ).get()
        XCTAssertNil(identity)
    }

    func testPocketFeedIdentityIntersectsToSwiftOwnedCapabilities() throws {
        let identity = try XCTUnwrap(DaemonServer.parseSurfaceHTTPIdentity(
            headers: headers(), query: ["board": "xteink_x3"], requiredCapability: "feed.pull"
        ).get())
        XCTAssertEqual(identity.productId, "io.pocketdaily.reader")
        XCTAssertEqual(identity.board, "xteink_x3")
        XCTAssertEqual(identity.capabilities, ["feed.pull", "feed.conditional", "glance.read"])
        XCTAssertFalse(identity.capabilities.contains("outbox.push"))
        XCTAssertFalse(identity.capabilities.contains("ota.feed"))
    }

    func testPartialWrongMajorAndTupleMismatchFailClosed() {
        switch DaemonServer.parseSurfaceHTTPIdentity(
            headers: ["agentdeck-surface-protocol": "1"], requiredCapability: "feed.pull"
        ) {
        case .failure(let error): XCTAssertEqual(error.status, 400)
        case .success: XCTFail("partial Surface identity must fail")
        }
        switch DaemonServer.parseSurfaceHTTPIdentity(
            headers: headers(["agentdeck-surface-protocol": "2"]), requiredCapability: "feed.pull"
        ) {
        case .failure(let error): XCTAssertEqual(error.status, 426)
        case .success: XCTFail("wrong major must fail")
        }
        switch DaemonServer.parseSurfaceHTTPIdentity(
            headers: headers(), query: ["board": "xteink_x4"], requiredCapability: "feed.pull"
        ) {
        case .failure(let error): XCTAssertEqual(error.code, "surface_query_identity_mismatch")
        case .success: XCTFail("query tuple must not override headers")
        }
    }

    func testSwiftWelcomeIsBoundedAndNeverGrantsInbox() throws {
        let negotiation = try DaemonServer.negotiateSurface([
            "protocol": 1,
            "clientId": "io.pocketdaily.reader",
            "clientVersion": "1.4.1-pocket",
            "productId": "io.pocketdaily.reader",
            "profiles": [[
                "id": "portable-reader/v1",
                "capabilities": ["feed.pull", "glance.read", "outbox.push", "ota.feed", "inbox.ws"],
            ]],
        ]).get()
        XCTAssertEqual(negotiation.profile, "portable-reader/v1")
        XCTAssertEqual(negotiation.capabilities, ["feed.pull", "glance.read"])
        XCTAssertFalse(negotiation.capabilities.contains("inbox.ws"))
    }
}
#endif
