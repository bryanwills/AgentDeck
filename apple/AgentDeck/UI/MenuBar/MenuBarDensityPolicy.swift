// MenuBarDensityPolicy.swift — bounded-density rules for the macOS glance surface.

#if os(macOS)
import CoreGraphics

/// One policy shared by the menu bar session roster and surface summary.
/// The menu bar adapts the amount of detail before falling back to a semantic
/// rollup; its outer window must never grow with collection size.
enum MenuBarCollectionDensity: Equatable {
    case detailed
    case grouped
    case summarized
}

enum MenuBarDensityPolicy {
    static let preferredPanelHeight: CGFloat = 560
    static let minimumPanelHeight: CGFloat = 420
    static let panelBottomSafety: CGFloat = 20
    static let maxInlineIdleSessions = 3
    static let sessionColumnWidth: CGFloat = 424
    static let overviewColumnWidth: CGFloat = 286

    static func collectionDensity(count: Int) -> MenuBarCollectionDensity {
        switch max(0, count) {
        case 0...6: return .detailed
        case 7...15: return .grouped
        default: return .summarized
        }
    }

    static func inlineIdleSessionCount(totalSessionCount: Int, idleSessionCount: Int) -> Int {
        let idleCount = max(0, idleSessionCount)
        switch collectionDensity(count: totalSessionCount) {
        case .detailed:
            return idleCount
        case .grouped:
            return min(maxInlineIdleSessions, idleCount)
        case .summarized:
            return 0
        }
    }

    static func panelHeight(availableHeight: CGFloat) -> CGFloat {
        let screenBudget = availableHeight - panelBottomSafety
        if screenBudget >= minimumPanelHeight {
            return min(preferredPanelHeight, screenBudget)
        }
        return max(300, screenBudget)
    }
}

struct MenuBarSurfaceFamily: Equatable, Identifiable {
    let name: String
    let count: Int

    var id: String { name }
}

struct MenuBarSurfaceIssue: Equatable, Identifiable {
    let label: String
    let count: Int

    var id: String { label }
}

/// Transport-aware rollup for the bounded menu bar topology summary.
/// Serial-active ESP32 Wi-Fi sockets are excluded because the USB row already
/// represents that physical board, matching the full TopologyRail rule.
struct MenuBarSurfaceRollup: Equatable {
    let total: Int
    let issueCount: Int
    let families: [MenuBarSurfaceFamily]
    let issues: [MenuBarSurfaceIssue]

    static func make(from health: ModuleHealthState?) -> MenuBarSurfaceRollup {
        guard let health else {
            return MenuBarSurfaceRollup(total: 0, issueCount: 0, families: [], issues: [])
        }

        let streamDeck = health.streamDeck?.devices.count ?? 0
        let d200h = health.d200h == nil ? 0 : 1

        let nativeEink = health.eink?.devices.count ?? 0
        let dashboards = health.androidDashboards?.devices ?? []
        let unmatchedAdb = unmatchedAdbDevices(
            health.adb?.classifiedDevices ?? [],
            dashboards: dashboards
        )
        let adbEink = unmatchedAdb.filter { $0.deviceClass.hasPrefix("e-ink.") }.count
        let dashboardEink = dashboards.filter { $0.kind == "eink" }.count

        let pixoo = max(
            health.pixoo?.configuredDeviceCount ?? 0,
            health.pixoo?.devices.count ?? 0
        )
        let timebox = health.timebox?.configuredDeviceCount ?? 0
        let idotmatrix = health.idotmatrix?.configuredDeviceCount ?? 0

        let serial = health.serial?.connectedBoards.count ?? 0
        let wifiOnly = (health.esp32Wifi?.devices ?? [])
            .filter { !$0.serialActive }.count

        let tui = health.tuiDashboards?.devices.count ?? 0
        let dashboardApps = dashboards.filter { $0.kind != "eink" }.count
        let adbApps: Int = {
            if !(health.adb?.classifiedDevices ?? []).isEmpty {
                return unmatchedAdb.filter { !$0.deviceClass.hasPrefix("e-ink.") }.count
            }
            return health.adb?.devices.count ?? 0
        }()

        let candidates = [
            MenuBarSurfaceFamily(name: "Controls", count: streamDeck + d200h),
            MenuBarSurfaceFamily(name: "E-ink", count: nativeEink + adbEink + dashboardEink),
            MenuBarSurfaceFamily(name: "LED", count: pixoo + timebox + idotmatrix),
            MenuBarSurfaceFamily(name: "ESP32", count: serial + wifiOnly),
            MenuBarSurfaceFamily(name: "Apps", count: tui + dashboardApps + adbApps),
        ]
        let families = candidates.filter { $0.count > 0 }

        var issues: [MenuBarSurfaceIssue] = []
        if health.d200h?.connected == false {
            issues.append(MenuBarSurfaceIssue(label: "D200H disconnected", count: 1))
        }
        if let pixooHealth = health.pixoo {
            for device in pixooHealth.devices where
                !device.online || device.backedOff || device.failures > 0 || !pixooHealth.hasFrame {
                let state: String
                if !device.online { state = "offline" }
                else if device.backedOff { state = "retry paused" }
                else if device.failures > 0 { state = "retrying" }
                else { state = "waiting for frame" }
                issues.append(MenuBarSurfaceIssue(label: "Pixoo \(device.ip) · \(state)", count: 1))
            }
            let missing = max(0, pixooHealth.configuredDeviceCount - pixooHealth.devices.count)
            if missing > 0 {
                issues.append(MenuBarSurfaceIssue(label: "Pixoo devices not reporting", count: missing))
            }
        }
        for (name, matrix) in [("Timebox Mini", health.timebox), ("iDotMatrix", health.idotmatrix)] {
            guard let matrix else { continue }
            if matrix.configuredDeviceCount > 0 && !matrix.connected {
                issues.append(MenuBarSurfaceIssue(
                    label: "\(name) disconnected",
                    count: matrix.configuredDeviceCount
                ))
            }
        }
        for device in (health.esp32Wifi?.devices ?? []) where !device.serialActive && device.stale {
            let address = device.ip ?? "unknown address"
            issues.append(MenuBarSurfaceIssue(
                label: "\(device.board) \(address) · stale",
                count: 1
            ))
        }
        if health.adb?.lastError?.isEmpty == false {
            issues.append(MenuBarSurfaceIssue(label: "ADB connection error", count: 1))
        }
        if health.serial?.lastError?.isEmpty == false {
            issues.append(MenuBarSurfaceIssue(label: "ESP32 serial error", count: 1))
        }

        return MenuBarSurfaceRollup(
            total: families.reduce(0) { $0 + $1.count },
            issueCount: issues.reduce(0) { $0 + $1.count },
            families: families,
            issues: issues
        )
    }

    /// Android apps can report the same physical panel through a live Wi-Fi
    /// dashboard socket and ADB. Merge only when identity evidence is strong:
    /// exact serial/id, or a model token (at least four alphanumerics) contained
    /// in the dashboard's advertised name. Ambiguous devices stay separate.
    private static func unmatchedAdbDevices(
        _ adbDevices: [ClassifiedDevice],
        dashboards: [AndroidDashboardDeviceInfo]
    ) -> [ClassifiedDevice] {
        var unmatched = adbDevices
        for dashboard in dashboards {
            let dashboardIsEink = dashboard.kind == "eink"
            let dashboardId = normalizedIdentity(dashboard.id)
            let dashboardName = normalizedIdentity(dashboard.name)
            guard let index = unmatched.firstIndex(where: { adb in
                let adbIsEink = adb.deviceClass.hasPrefix("e-ink.")
                guard adbIsEink == dashboardIsEink else { return false }

                let serial = normalizedIdentity(adb.serial)
                if !dashboardId.isEmpty && dashboardId == serial { return true }

                let model = normalizedIdentity(adb.model ?? "")
                guard model.count >= 4, !dashboardName.isEmpty else { return false }
                return dashboardName.contains(model) || model.contains(dashboardName)
            }) else { continue }
            unmatched.remove(at: index)
        }
        return unmatched
    }

    private static func normalizedIdentity(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}
#endif
