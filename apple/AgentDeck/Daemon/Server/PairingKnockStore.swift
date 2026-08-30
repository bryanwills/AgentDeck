#if os(macOS)
// PairingKnockStore.swift — who tried to connect, and who the operator let in.
//
// The daemon already knew everything this needs: it refuses an unauthenticated
// LAN peer at the WebSocket handshake and logs the IP. What it did not do was
// tell anyone. So a device with no credential retried forever into a log nobody
// reads (measured on this machine: one reader knocked 116 times and then went
// quiet for three weeks; another is still knocking every few seconds), while the
// only ways to give it a credential asked the DEVICE to do something — scan a
// QR, type six digits, type a 32-character token. An e-ink reader can do none
// of them comfortably, and one with no camera cannot do the first at all.
//
// Turning the refusal into a prompt inverts that: the device does nothing, and
// the operator — who is holding the Mac — approves a peer they can see. That is
// also the stronger of the two trust models. A pairing code trusts whoever knows
// a secret, so anyone in range may guess at it while the window is open; an
// approval trusts a specific peer the operator pointed at, and an attacker
// cannot approve themselves.
//
// Three properties this file has to keep.
//
// **Identity is the IP, and that is a real limitation, not a shortcut.** The
// refusal happens at the HTTP upgrade, before any frame — `client_register`,
// which is where a device says its name, arrives only after a socket exists. So
// at decision time the IP is the only fact there is. Consequence: a DHCP lease
// change retires an approval, and the device knocks again. Say that in the UI
// rather than implying the approval follows the device.
//
// **A claimed name is never identity.** Nothing here reads one. If a name is
// ever surfaced it must sit beside the IP, never instead of it.
//
// **Bounded, and expired on read.** A hostile peer must not be able to grow this
// list without limit, so it is capped and the oldest knock is dropped — which
// does mean a flood can push a real device out of view, and the cap is chosen
// high enough that a human notices the flood first. Expiry is evaluated when the
// list is read, never by a timer: a timer that fires late on a sleeping laptop
// would keep a stale knock alive past its promise, exactly as in
// PairingWindowStore.
//
// Lock-based rather than actor-isolated on purpose: the WebSocket accept path
// calls `isApproved` synchronously before it may upgrade, and an actor hop there
// would mean answering the handshake from a different turn. Same reasoning, and
// same shape, as AuthManager.

import Foundation

final class PairingKnockStore: @unchecked Sendable {

    static let shared = PairingKnockStore()

    /// A knock is worth showing for this long after its last attempt. Long
    /// enough that the operator can walk to the Mac; short enough that a device
    /// carried out of the building stops being offered.
    static let knockTTL: TimeInterval = 15 * 60

    /// Cap on simultaneously-tracked peers.
    static let maxKnocks = 12

    struct Knock: Sendable, Equatable {
        let ip: String
        var attempts: Int
        var firstSeen: Date
        var lastSeen: Date
        /// True when the peer presented a token we do not accept, rather than no
        /// token at all. Reads very differently to an operator: usually a
        /// provisioned device whose credential went stale, not a new device.
        var staleToken: Bool
    }

    struct Approval: Sendable, Equatable, Codable {
        let ip: String
        let approvedAt: Date
    }

    private let lock = NSLock()
    private var pending: [String: Knock] = [:]
    private var approved: [String: Approval]

    private init() {
        approved = Self.loadApprovals()
    }

    // MARK: - Knocks

    /// Called from the refusal path. Cheap on purpose — it runs for every
    /// rejected handshake, and a looping device produces one every few seconds.
    func record(ip: String, staleToken: Bool, now: Date = Date()) {
        guard !ip.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        if approved[ip] != nil { return }   // already let in; not a knock
        if var existing = pending[ip] {
            existing.attempts += 1
            existing.lastSeen = now
            existing.staleToken = staleToken
            pending[ip] = existing
        } else {
            pending[ip] = Knock(ip: ip, attempts: 1, firstSeen: now,
                                lastSeen: now, staleToken: staleToken)
            evictIfNeeded()
        }
    }

    /// Live knocks, newest first. Expiry is applied here — see the header.
    func knocks(now: Date = Date()) -> [Knock] {
        lock.lock()
        defer { lock.unlock() }
        pending = pending.filter { now.timeIntervalSince($0.value.lastSeen) < Self.knockTTL }
        return pending.values.sorted { $0.lastSeen > $1.lastSeen }
    }

    /// Drop a knock without approving it. Not a block: the peer may knock again,
    /// which is deliberate — a permanent denylist keyed on an IP a stranger can
    /// change is security theatre, and it would silently strand a real device
    /// that later inherits that address.
    func dismiss(ip: String) {
        lock.lock()
        defer { lock.unlock() }
        pending.removeValue(forKey: ip)
    }

    private func evictIfNeeded() {
        guard pending.count > Self.maxKnocks else { return }
        let ordered = pending.values.sorted { $0.lastSeen < $1.lastSeen }
        for knock in ordered.prefix(pending.count - Self.maxKnocks) {
            pending.removeValue(forKey: knock.ip)
        }
    }

    // MARK: - Approvals

    /// Approving is what a pairing code would have done, minus the typing: from
    /// here on this peer authenticates by address. Persisted immediately.
    func approve(ip: String, now: Date = Date()) {
        guard !ip.isEmpty else { return }
        lock.lock()
        approved[ip] = Approval(ip: ip, approvedAt: now)
        pending.removeValue(forKey: ip)
        let snapshot = approved
        lock.unlock()
        Self.persist(snapshot)
    }

    func revoke(ip: String) {
        lock.lock()
        approved.removeValue(forKey: ip)
        let snapshot = approved
        lock.unlock()
        Self.persist(snapshot)
    }

    /// The question the WebSocket gate asks. Must stay allocation-light.
    func isApproved(_ ip: String) -> Bool {
        guard !ip.isEmpty else { return false }
        lock.lock()
        defer { lock.unlock() }
        return approved[ip] != nil
    }

    func approvals() -> [Approval] {
        lock.lock()
        defer { lock.unlock() }
        return approved.values.sorted { $0.approvedAt > $1.approvedAt }
    }

    // MARK: - Persistence

    private static func loadApprovals() -> [String: Approval] {
        guard let data = try? Data(contentsOf: AgentDeckPaths.pairingApproved),
              let rows = try? JSONDecoder().decode([Approval].self, from: data) else { return [:] }
        return Dictionary(uniqueKeysWithValues: rows.map { ($0.ip, $0) })
    }

    private static func persist(_ approved: [String: Approval]) {
        let rows = approved.values.sorted { $0.approvedAt < $1.approvedAt }
        guard let data = try? JSONEncoder().encode(rows) else { return }
        let url = AgentDeckPaths.pairingApproved
        let tmp = url.appendingPathExtension("tmp")
        // tmp+rename, as everywhere else that writes the data dir: a truncated
        // approvals file reads as "nobody is approved" and silently locks the
        // whole fleet out.
        do {
            try data.write(to: tmp)
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }
}
#endif
