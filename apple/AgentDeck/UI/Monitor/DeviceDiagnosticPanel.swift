// DeviceDiagnosticPanel.swift — Device module health overview for HUD

import SwiftUI

struct DeviceDiagnosticPanel: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("⚡ DEVICES")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext)

            if let health = stateHolder.state.moduleHealth {
                if let adb = health.adb {
                    DeviceRow(
                        name: "ADB",
                        status: adb.available ? .online : .offline,
                        detail: adb.devices.isEmpty
                            ? "No devices"
                            : "\(adb.devices.count) device\(adb.devices.count == 1 ? "" : "s"), \(adb.reverseReadyCount) reverse"
                    )
                }

                if let d200h = health.d200h {
                    DeviceRow(
                        name: "D200H",
                        status: d200h.connected ? .online : (d200h.managerOpened ? .warning : .offline),
                        detail: d200h.connected
                            ? "HID \(d200h.writeOK)↑ \(d200h.writeFail)✗ btn:\(d200h.buttonPressCount)"
                            : d200h.lastOpenError ?? (d200h.usbEntitlementPresent ? "Disconnected" : "No USB entitlement")
                    )
                }

                if let pixoo = health.pixoo {
                    if pixoo.configuredDeviceCount > 0 {
                        ForEach(pixoo.devices, id: \.ip) { dev in
                            DeviceRow(
                                name: "Pixoo \(dev.ip.components(separatedBy: ".").last ?? dev.ip)",
                                status: dev.online ? .online : (dev.backedOff ? .warning : .offline),
                                detail: dev.online
                                    ? (pixoo.hasFrame ? "Streaming" : "Connected")
                                    : "Fail:\(dev.failures)\(dev.backedOff ? " backed off" : "")"
                            )
                        }
                    }
                }

                if let serial = health.serial {
                    if !serial.connectedPorts.isEmpty {
                        ForEach(serial.connectedPorts, id: \.self) { port in
                            let shortPort = port.components(separatedBy: "/").last ?? port
                            DeviceRow(
                                name: "ESP32",
                                status: .online,
                                detail: shortPort
                            )
                        }
                    }
                }

                // Show placeholder when no modules have data
                if health.adb == nil && health.d200h == nil && health.pixoo == nil && health.serial == nil {
                    Text("No module data")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                }
            } else {
                Text("Awaiting health data…")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext)
            }
        }
        .padding(10)
        .background(TerrariumHUD.bg, in: RoundedRectangle(cornerRadius: 8))
        .opacity(stateHolder.state.bridgeConnected ? 1.0 : 0.6)
    }
}

// MARK: - Device Row

private enum DeviceRowStatus {
    case online, warning, offline
}

private struct DeviceRow: View {
    let name: String
    let status: DeviceRowStatus
    let detail: String

    private var dotColor: Color {
        switch status {
        case .online: TerrariumHUD.ledGreen
        case .warning: TerrariumHUD.ledAmber
        case .offline: TerrariumHUD.ledRed
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 6, height: 6)

            Text(name)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(TerrariumHUD.text)
                .frame(width: 56, alignment: .leading)

            Text(detail)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}
