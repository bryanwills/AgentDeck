#if os(macOS)
// MdnsAdvertisement.swift — the ONE place the Swift daemon composes its
// _agentdeck._tcp advertisement.
//
// History that shapes this file: the publisher in DaemonServer used a
// hand-typed literal (`name: "daemon-\(port)"`, TXT `project: "daemon"`,
// no host/user keys) while the SSOT-following construction sat in
// MdnsModule.swift — a module nothing instantiated. The mdns-identity drift
// gate compares the pure functions and the generated mirror bytes, so a
// publisher that ignores both stays green; the gate that catches this class
// of bug has to look at the publish path itself (MdnsAdvertisementTests
// drives this builder AND scans DaemonServer's call site).
//
// Parity target is the Node daemon (bridge/src/mdns.ts with
// projectName 'AgentDeck', agentType 'daemon'): whichever daemon owns the
// port must advertise the same identity, or a client's "which daemon is
// this?" answer depends on who won the port race.

import Foundation
import Network

enum MdnsAdvertisement {
    static let serviceType = "_agentdeck._tcp"

    /// What goes on the air, in an assertable shape. `NWListener.Service` and
    /// `NWTXTRecord` are write-mostly types; tests read this instead.
    struct Record {
        let instanceName: String
        let txt: [String: String]
    }

    static func record(
        port: UInt16,
        hostname: String = ProcessInfo.processInfo.hostName,
        userTag: String = MdnsIdentity.currentUserTag(),
        lanIP: String? = nil
    ) -> Record {
        let shortHostname = MdnsIdentity.sanitizeLabel(hostname)
        var txt: [String: String] = [
            // The keys clients actually walk (the ESP32 reads `agent` and
            // `project`), in lockstep with the Node daemon's advertisement.
            "project": "AgentDeck",
            "agent": "daemon",
            "port": "\(port)",
            "v": MdnsIdentity.txtSchemaVersion,
            // So a client can tell WHICH daemon this is without resolving and
            // dialling it. `user` is a hash, never the account name —
            // multicast is readable by everyone on the segment.
            "host": shortHostname,
            "user": userTag,
        ]
        // Never the pairing token: TXT is multicast (issue #145). There is no
        // token parameter on purpose — a future caller cannot pass one.
        if let lanIP { txt["ip"] = lanIP }
        return Record(
            instanceName: MdnsIdentity.instanceName(
                project: "AgentDeck", hostname: shortHostname, userTag: userTag, port: Int(port)),
            txt: txt)
    }

    /// The Bonjour service for the unified WebSocket listener. All the
    /// composition lives in `record(port:)` so the tests assert on the same
    /// values the listener advertises.
    static func service(port: UInt16, lanIP: String?) -> NWListener.Service {
        let record = record(port: port, lanIP: lanIP)
        return NWListener.Service(
            name: record.instanceName,
            type: serviceType,
            txtRecord: NWTXTRecord(record.txt))
    }
}
#endif
