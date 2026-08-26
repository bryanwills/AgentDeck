#if os(macOS)
import CryptoKit
import Foundation

/// App-container-native persistence for Surface pull OTA.
///
/// The Node daemon stores paths supplied by its CLI. A sandboxed App Store app
/// cannot retain or reopen those paths, so Swift copies the bytes into its own
/// Application Support directory and persists only container-relative names.
actor SwiftSurfaceFirmwareStore {
    struct Identity: Codable, Hashable, Sendable {
        let productId: String
        let board: String
        let updateChannel: String
    }

    struct Advert: Sendable {
        let identity: Identity?
        let size: Int
        let md5: String
    }

    struct Segment: Sendable {
        let data: Data
        let from: Int
        let total: Int
        let md5: String
    }

    struct StageResult: Sendable {
        let board: String
        let bytes: Int
        let md5: String
    }

    enum StoreError: Error, Equatable {
        case targetMismatch
        case notStaged
        case corruptStage
    }

    private struct Entry: Codable, Sendable {
        let fileName: String
        let md5: String
        let size: Int
        let stagedAt: Int64
        let firmwareVersion: String?
    }

    private struct IdentityEntry: Codable, Sendable {
        let identity: Identity
        let entry: Entry
    }

    private struct State: Codable, Sendable {
        let version: Int
        let identities: [IdentityEntry]
        let legacy: [String: Entry]
    }

    private let directory: URL
    private let stateURL: URL
    private var identities: [Identity: Entry] = [:]
    private var legacy: [String: Entry] = [:]

    init(baseDirectory: URL) {
        directory = baseDirectory.appendingPathComponent("surface-firmware", isDirectory: true)
        stateURL = baseDirectory.appendingPathComponent("staged-fw-swift.json")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? Data(contentsOf: stateURL),
              let state = try? JSONDecoder().decode(State.self, from: data),
              state.version == 1 else { return }
        identities = Dictionary(uniqueKeysWithValues: state.identities.map { ($0.identity, $0.entry) })
        legacy = state.legacy
    }

    func stage(firmware: Data, target: String, identity: Identity?) throws -> StageResult {
        if let identity, identity.board != target { throw StoreError.targetMismatch }
        let md5 = Self.md5(firmware)
        let namespace = identity.map(Self.identityKey) ?? "legacy-\(target)"
        let safe = namespace.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" }
        let fileName = "\(String(safe))-\(md5).bin"
        let destination = directory.appendingPathComponent(fileName)
        try firmware.write(to: destination, options: .atomic)
        let entry = Entry(
            fileName: fileName,
            md5: md5,
            size: firmware.count,
            stagedAt: Int64(Date().timeIntervalSince1970 * 1000),
            firmwareVersion: Self.embeddedFirmwareVersion(firmware)
        )
        let replaced: Entry?
        if let identity {
            replaced = identities.updateValue(entry, forKey: identity)
        } else {
            replaced = legacy.updateValue(entry, forKey: target)
        }
        if let replaced, replaced.fileName != entry.fileName {
            removeIfUnreferenced(replaced.fileName)
        }
        try persist()
        return StageResult(board: target, bytes: firmware.count, md5: md5)
    }

    /// Returns nil once the client reports the embedded version, which is the
    /// install acknowledgement for a wake-sync-sleep device.
    func advert(identity: Identity?, board: String, clientVersion: String?) -> Advert? {
        guard let entry = entry(identity: identity, board: board) else { return nil }
        guard validatedData(entry) != nil else {
            if let identity { identities.removeValue(forKey: identity) } else { legacy.removeValue(forKey: board) }
            try? persist()
            return nil
        }
        if let expected = entry.firmwareVersion, expected == clientVersion {
            if let identity { identities.removeValue(forKey: identity) } else { legacy.removeValue(forKey: board) }
            removeIfUnreferenced(entry.fileName)
            try? persist()
            return nil
        }
        return Advert(identity: identity, size: entry.size, md5: entry.md5)
    }

    func segment(identity: Identity?, board: String, requestedFrom: Int, requestedLimit: Int?) throws -> Segment {
        guard let entry = entry(identity: identity, board: board) else {
            throw StoreError.notStaged
        }
        guard let firmware = validatedData(entry) else { throw StoreError.corruptStage }
        let from = min(max(0, requestedFrom), firmware.count)
        let defaultLimit = 256 * 1024
        let limit = requestedLimit.map { min(max($0, 32 * 1024), 512 * 1024) } ?? defaultLimit
        let end = min(firmware.count, from + limit)
        return Segment(data: firmware.subdata(in: from..<end), from: from, total: firmware.count, md5: entry.md5)
    }

    private func validatedData(_ entry: Entry) -> Data? {
        let url = directory.appendingPathComponent(entry.fileName)
        guard let data = try? Data(contentsOf: url), data.count == entry.size,
              Self.md5(data) == entry.md5 else { return nil }
        return data
    }

    private func entry(identity: Identity?, board: String) -> Entry? {
        if let identity { return identities[identity] }
        return legacy[board]
    }

    private func persist() throws {
        let state = State(
            version: 1,
            identities: identities.map { IdentityEntry(identity: $0.key, entry: $0.value) },
            legacy: legacy
        )
        let data = try JSONEncoder().encode(state)
        try data.write(to: stateURL, options: .atomic)
    }

    private func removeIfUnreferenced(_ fileName: String) {
        guard !identities.values.contains(where: { $0.fileName == fileName }),
              !legacy.values.contains(where: { $0.fileName == fileName }) else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(fileName))
    }

    nonisolated static func md5(_ data: Data) -> String {
        Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func embeddedFirmwareVersion(_ data: Data) -> String? {
        let marker = Data("CrossPoint version: ".utf8)
        guard let range = data.range(of: marker) else { return nil }
        var bytes: [UInt8] = []
        var index = range.upperBound
        while index < data.endIndex, bytes.count < 96 {
            let byte = data[index]
            if byte == 0 || byte == 10 || byte == 13 { break }
            guard byte >= 0x20 && byte <= 0x7e else { return nil }
            bytes.append(byte)
            index = data.index(after: index)
        }
        guard !bytes.isEmpty, bytes.count < 96 else { return nil }
        return String(bytes: bytes, encoding: .ascii)
    }

    nonisolated private static func identityKey(_ identity: Identity) -> String {
        "\(identity.productId)-\(identity.board)-\(identity.updateChannel)"
    }
}
#endif
