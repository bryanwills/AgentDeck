// MenuBarDensityPolicy.swift — bounded-density rules for the macOS glance surface.

#if os(macOS)
import CoreGraphics

/// One policy shared by the menu bar session roster and surface summary.
/// The Dashboard owns exhaustive lists; the menu bar owns interruption-first
/// triage and must not grow with the number of sessions or connected surfaces.
enum MenuBarDensityPolicy {
    static let preferredPanelHeight: CGFloat = 560
    static let minimumPanelHeight: CGFloat = 420
    static let panelBottomSafety: CGFloat = 20
    static let maxInlineIdleSessions = 3
    static let sessionColumnWidth: CGFloat = 424
    static let overviewColumnWidth: CGFloat = 286

    static func collapsesIdleSessions(_ count: Int) -> Bool {
        count > maxInlineIdleSessions
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

/// Transport-aware rollup for the bounded menu bar topology summary.
/// Serial-active ESP32 Wi-Fi sockets are excluded because the USB row already
/// represents that physical board, matching the full TopologyRail rule.
struct MenuBarSurfaceRollup: Equatable {
    let total: Int
    let issueCount: Int
    let families: [MenuBarSurfaceFamily]

    static func make(from health: ModuleHealthState?) -> MenuBarSurfaceRollup {
        guard let health else {
            return MenuBarSurfaceRollup(total: 0, issueCount: 0, families: [])
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

        var issues = 0
        if health.d200h?.connected == false { issues += 1 }
        if let pixooHealth = health.pixoo {
            let reportedIssues = pixooHealth.devices.filter {
                !$0.online || $0.backedOff || $0.failures > 0 || !pixooHealth.hasFrame
            }.count
            issues += reportedIssues
            issues += max(0, pixooHealth.configuredDeviceCount - pixooHealth.devices.count)
        }
        for matrix in [health.timebox, health.idotmatrix].compactMap({ $0 }) {
            if matrix.configuredDeviceCount > 0 && !matrix.connected {
                issues += matrix.configuredDeviceCount
            }
        }
        issues += (health.esp32Wifi?.devices ?? []).filter { !$0.serialActive && $0.stale }.count
        if health.adb?.lastError?.isEmpty == false { issues += 1 }
        if health.serial?.lastError?.isEmpty == false { issues += 1 }

        return MenuBarSurfaceRollup(
            total: families.reduce(0) { $0 + $1.count },
            issueCount: issues,
            families: families
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
