#if os(macOS)
// WifiConfig.swift — WiFi credential management for ESP32 auto-provisioning.
//
// Persists user-supplied SSID/password for ESP32 firmware to consume during
// the first-boot handshake. Auto-detection of the current SSID and Keychain
// password lookup both required `networksetup` / `security` subprocesses,
// which are not allowed under Apple Review Guideline 2.5.2 — the
// ESP32ProvisionSheet asks the user to type both fields directly.

import Foundation

struct WifiConfig: Codable {
    let ssid: String
    let password: String
    var autoProvision: Bool = true
}

enum WifiConfigManager {
    private static let configFile = AuthManager.agentDeckDir.appendingPathComponent("wifi-config.json")

    static func load() -> WifiConfig? {
        guard let data = try? Data(contentsOf: configFile),
              let config = try? JSONDecoder().decode(WifiConfig.self, from: data),
              !config.ssid.isEmpty, !config.password.isEmpty else { return nil }
        return config
    }

    static func save(_ config: WifiConfig) throws {
        try FileManager.default.createDirectory(at: AuthManager.agentDeckDir, withIntermediateDirectories: true)
        let data = try JSONEncoder.pretty.encode(config)
        try data.write(to: configFile)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configFile.path)
    }

    /// SSID auto-detection is unavailable in the App Store build; the
    /// provisioning sheet prompts the user for the SSID.
    static func detectCurrentSSID() -> String? { nil }

    /// Keychain password lookup is unavailable in the App Store build; the
    /// provisioning sheet prompts the user for the password.
    static func getKeychainPassword(ssid: String) -> String? {
        _ = ssid
        return nil
    }
}
#endif
