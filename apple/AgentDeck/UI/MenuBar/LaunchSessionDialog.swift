// LaunchSessionDialog.swift — Folder + agent picker for the Launch Session info alert.
#if os(macOS)
import SwiftUI
import AppKit

struct LaunchSessionDialog: View {
    let daemonPort: UInt16?

    @AppStorage("launch.lastFolder") private var folderPath: String = ""
    @AppStorage("launch.lastAgent") private var agentRaw: String = LaunchAgentType.claudeCode.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Launch Session")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("Project Folder")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                HStack {
                    Text(displayFolder)
                        .font(.system(size: 12, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(folderPath.isEmpty ? .secondary : .primary)
                    Spacer()
                    Button("Choose…") { pickFolder() }
                        .controlSize(.small)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Agent")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Picker("", selection: $agentRaw) {
                    ForEach(LaunchAgentType.allCases, id: \.rawValue) { agent in
                        Text(agent.displayName).tag(agent.rawValue)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            HStack {
                Spacer()
                Button("Cancel") { closeWindow() }
                    .keyboardShortcut(.cancelAction)
                Button("Continue") { launch() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private var displayFolder: String {
        if folderPath.isEmpty { return "No folder selected" }
        return (folderPath as NSString).abbreviatingWithTildeInPath
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Select"
        if !folderPath.isEmpty, FileManager.default.fileExists(atPath: folderPath) {
            panel.directoryURL = URL(fileURLWithPath: folderPath)
        }
        if panel.runModal() == .OK, let url = panel.url {
            folderPath = url.path
        }
    }

    private func launch() {
        let agent = LaunchAgentType(rawValue: agentRaw) ?? .claudeCode
        SessionLauncher.launchSession(
            project: folderPath.isEmpty ? nil : folderPath,
            agent: agent
        )
        closeWindow()
    }

    private func closeWindow() {
        if let window = NSApp.windows.first(where: { $0.title == "Launch Session" }) {
            window.close()
        }
    }
}
#endif
