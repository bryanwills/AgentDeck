// DeviceIdentity.swift — a stable random identifier for this install, sent on
// every WebSocket handshake so the daemon can approve THIS device rather than
// its address.
//
// The daemon decides whether to accept a peer at the HTTP upgrade, before any
// frame — `client_register`, where this app says its name, has not been sent
// yet — so an identity that arrives later is no use to it. An address was the
// only thing available, and behind NAT an address is shared: approving one
// device approved every device behind it.
//
// Random rather than `identifierForVendor`, which is null before first unlock,
// resets when the last app from a vendor is removed, and is shared with sibling
// apps. None of that is wanted: the daemon needs to tell two of the user's own
// devices apart. A reinstall producing a new id is correct — it IS a new
// install, and it should be approved again rather than inheriting a grant.
//
// Not a secret in transit: the link is plaintext `ws://`, so this is observable
// on the segment exactly as the `?token=` query already is. It buys granularity
// and revocation, not confidentiality.

import Foundation

enum DeviceIdentity {

    private static let defaultsKey = "agentdeck.deviceId"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cached: String?

    /// This install's id, minted and persisted on first use.
    static var current: String {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        let defaults = UserDefaults.standard
        if let stored = PairingCodeRules.normalizeDeviceId(defaults.string(forKey: defaultsKey)) {
            cached = stored
            return stored
        }
        let fresh = generate()
        defaults.set(fresh, forKey: defaultsKey)
        cached = fresh
        return fresh
    }

    private static func generate() -> String {
        var bytes = [UInt8](repeating: 0, count: PairingCodeRules.DEVICE_ID_LENGTH / 2)
        // SecRandomCopyBytes can fail; a UUID-derived fallback keeps the id
        // unique per install, which is all this needs — it is an identifier,
        // not a key.
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            return String(uuid.prefix(PairingCodeRules.DEVICE_ID_LENGTH))
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
