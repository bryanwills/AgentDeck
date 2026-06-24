#if os(macOS)
// AdbModule.swift — In-process ADB stub.
//
// Android dashboards (CremaS, Pantone, Kobo, Lenovo tablets) connect through
// a desktop bridge that runs separately from this app and drives `adb reverse`
// itself. The in-process daemon never spawns adb, so this module is a
// status-only placeholder that reports "disabled" and keeps the snapshot
// shape stable for downstream parsers.
//
// NOTE: Ulanzi TC001 is NOT an ADB device — it is an ESP32 board (env
// `led8x32`) that connects over USB serial / WiFi WS like the other ESP32
// displays and surfaces through the serial pipeline (`esp32DisplayName`). The
// legacy `AdbDeviceClass.ulanziTc001` case + `TopologyRail` ADB lookups were
// removed on 2026-06-25; do not reintroduce TC001 into the ADB tier.

import Foundation

struct ClassifiedAdbDevice: Sendable, Hashable {
    let serial: String
    let manufacturer: String?
    let model: String?
    let deviceClass: AdbDeviceClass
}

final class AdbModule: DeviceModule, @unchecked Sendable {
    let name = "adb"

    nonisolated(unsafe) var commandHandler: (([String: Any]) -> Void)?

    init(daemonPort: Int) {
        _ = daemonPort
    }

    func start() async {
        DaemonLogger.shared.debug("ADB", "in-process module disabled — ADB devices arrive through external daemon if running")
    }

    func stop() async {}

    func handleBroadcast(_ event: [String: Any]) {
        _ = event
    }

    func statusSnapshot() -> [String: Any] {
        return [
            "available": false,
            "disabled": true,
            "devices": [] as [String],
            "classifiedDevices": [] as [[String: Any]],
            "reverseReadyCount": 0,
        ]
    }

    /// Classify a device by (manufacturer, model) strings. Case-insensitive.
    /// Retained as a static helper because external-daemon-pushed device
    /// payloads still flow through `AdbDeviceClass`-aware UI code.
    static func classifyDevice(
        manufacturer: String?,
        model: String?
    ) -> AdbDeviceClass {
        let m = (manufacturer ?? "").lowercased()
        if m.contains("ridi") { return .eInkCrema }
        if m.contains("onyx") { return .eInkPantone }
        if m.contains("rakuten") || m.contains("kobo") { return .eInkKobo }
        return .androidTablet
    }
}
#endif
