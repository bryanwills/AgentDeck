#if os(macOS)
// The Swift daemon's Bonjour identity, gated at the PUBLISHER, not just the
// SSOT mirror.
//
// The bug this guards against: DaemonServer advertised `daemon-9120` with a
// hand-typed TXT for the whole life of the feature, while the SSOT-following
// construction sat in a module nothing instantiated. The mdns-identity drift
// gate (mirror bytes + pure functions) stayed green throughout, because the
// publisher consulted neither. So this suite does two things the drift gate
// cannot: it drives the builder the publisher actually calls, and it scans the
// publisher's source to prove the call is still there and no literal came back.

import XCTest
@testable import AgentDeck

final class MdnsAdvertisementTests: XCTestCase {

    // MARK: - The record the listener advertises

    func testInstanceNameComesFromTheIdentitySSOT() {
        let record = MdnsAdvertisement.record(
            port: 9120, hostname: "Sams-MacBook.local", userTag: "a1b2c3")
        // One pinned literal, so the builder cannot agree with a broken helper
        // by both drifting together.
        XCTAssertEqual(record.instanceName, "AgentDeck-Sams-MacBook-a1b2c3-9120")
        // And the same value the SSOT computes, so the pin and the helper are
        // cross-checked against each other.
        XCTAssertEqual(
            record.instanceName,
            MdnsIdentity.instanceName(
                project: "AgentDeck", hostname: MdnsIdentity.sanitizeLabel("Sams-MacBook.local"),
                userTag: "a1b2c3", port: 9120))
    }

    func testTxtRecordMatchesTheNodeDaemonContract() {
        let record = MdnsAdvertisement.record(
            port: 9120, hostname: "mac.local", userTag: "a1b2c3", lanIP: "192.0.2.10")
        // The Node daemon advertises with projectName 'AgentDeck' and
        // agentType 'daemon' (bridge/src/daemon-server.ts createDefaultModules
        // + initModules context); whichever daemon owns the port must read the
        // same, or a client's identity answer depends on the port race.
        XCTAssertEqual(record.txt["project"], "AgentDeck")
        XCTAssertEqual(record.txt["agent"], "daemon")
        XCTAssertEqual(record.txt["v"], MdnsIdentity.txtSchemaVersion)
        XCTAssertEqual(record.txt["port"], "9120")
        XCTAssertEqual(record.txt["host"], "mac")
        XCTAssertEqual(record.txt["user"], "a1b2c3")
        XCTAssertEqual(record.txt["ip"], "192.0.2.10")
    }

    func testNoLanIPMeansNoIpKeyNotALoopbackClaim() {
        // The Node daemon omits `ip` when it has none; claiming 127.0.0.1 on
        // multicast tells every peer to dial itself.
        let record = MdnsAdvertisement.record(port: 9120, hostname: "mac", userTag: "t")
        XCTAssertNil(record.txt["ip"])
    }

    func testTxtNeverCarriesACredential() {
        // mDNS TXT is multicast (issue #145): the pairing token must never
        // appear, under any key. The builder has no token parameter on
        // purpose; this pins the record against one growing a leak later.
        let record = MdnsAdvertisement.record(
            port: 9120, hostname: "mac", userTag: "t", lanIP: "192.0.2.10")
        for (key, value) in record.txt {
            XCTAssertFalse(key.lowercased().contains("token"), "TXT key \(key)")
            XCTAssertLessThan(value.count, 64, "TXT value for \(key) is suspiciously long")
        }
    }

    // MARK: - The publisher actually uses it

    func testDaemonServerPublishesThroughTheBuilderAndHoldsNoLiteral() throws {
        // A pure-function gate stays green while the publisher ignores the
        // SSOT — that is exactly how `daemon-9120` shipped. So read the
        // publisher's source and pin the call site itself.
        let source = try daemonServerSource()
        XCTAssertTrue(
            source.contains("MdnsAdvertisement.service(port:"),
            "DaemonServer must compose its Bonjour service through MdnsAdvertisement")
        XCTAssertFalse(
            source.contains("name: \"daemon-"),
            "the hand-typed Bonjour instance name is back")
        XCTAssertFalse(
            source.contains("_agentdeck._tcp"),
            "the service type belongs to MdnsAdvertisement.serviceType alone")
        XCTAssertFalse(
            source.contains("NWListener.Service("),
            "DaemonServer must not hand-build a Bonjour service")
    }

    private func daemonServerSource() throws -> String {
        let here = URL(fileURLWithPath: #filePath)
        let repo = here.deletingLastPathComponent().deletingLastPathComponent()
        let daemonServer = repo
            .appendingPathComponent("AgentDeck/Daemon/Server/DaemonServer.swift")
        return try String(contentsOf: daemonServer, encoding: .utf8)
    }
}
#endif
