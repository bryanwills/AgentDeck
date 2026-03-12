// DeckButtonLayout.swift — Button layout computation (local fallback)

import Foundation

enum DeckButtonLayout {
    /// Default button configs when bridge doesn't provide button_state
    static func defaultButtons(state: DashboardState) -> [ButtonSlotState] {
        var buttons: [ButtonSlotState] = []

        // Slot 0: Mode
        buttons.append(ButtonSlotState(
            slot: 0,
            title: state.permissionMode.rawValue.uppercased(),
            bgColor: "#1e293b",
            textColor: "#ffffff",
            enabled: true,
            action: "switch_mode"
        ))

        // Slot 1: Session
        buttons.append(ButtonSlotState(
            slot: 1,
            title: state.projectName ?? "—",
            subtitle: state.modelName,
            bgColor: "#1e293b",
            textColor: "#ffffff",
            enabled: true
        ))

        // Slot 2: Usage
        let usageTitle = state.fiveHourPercent.map { "\(Int($0))%" } ?? "—"
        buttons.append(ButtonSlotState(
            slot: 2,
            title: usageTitle,
            subtitle: "Usage",
            bgColor: "#1e293b",
            textColor: "#ffffff",
            enabled: true
        ))

        // Slots 3-6: Quick Actions (state-dependent)
        if state.state.isAwaiting {
            // Show options
            for (i, option) in state.options.prefix(4).enumerated() {
                buttons.append(ButtonSlotState(
                    slot: 3 + i,
                    title: option.label,
                    bgColor: option.recommended == true ? "#1d4ed8" : "#374151",
                    textColor: "#ffffff",
                    enabled: true,
                    action: "select_option:\(option.index)"
                ))
            }
            // Pad remaining
            for i in state.options.prefix(4).count..<4 {
                buttons.append(ButtonSlotState(
                    slot: 3 + i,
                    title: "—",
                    bgColor: "#111827",
                    textColor: "#4b5563",
                    enabled: false,
                    dim: true
                ))
            }
        } else {
            // Default quick actions
            let quickActions = [
                ("GO ON", "command:go on", "#065f46"),
                ("REVIEW", "command:/review", "#1e40af"),
                ("COMMIT", "command:/commit", "#7c2d12"),
                ("CLEAR", "command:/clear", "#374151"),
            ]
            for (i, (title, action, color)) in quickActions.enumerated() {
                buttons.append(ButtonSlotState(
                    slot: 3 + i,
                    title: title,
                    bgColor: color,
                    textColor: "#ffffff",
                    enabled: state.state == .idle,
                    action: action
                ))
            }
        }

        // Slot 7: Stop
        buttons.append(ButtonSlotState(
            slot: 7,
            title: state.state == .processing ? "STOP" : "ESC",
            bgColor: state.state == .processing ? "#991b1b" : "#374151",
            textColor: "#ffffff",
            enabled: state.state == .processing || state.state.isAwaiting,
            icon: state.state == .processing ? "■" : "←",
            action: state.state == .processing ? "interrupt" : "escape"
        ))

        return buttons
    }
}
