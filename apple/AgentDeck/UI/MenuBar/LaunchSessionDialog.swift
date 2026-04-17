// LaunchSessionDialog.swift — Folder/agent/terminal picker for Launch Session
#if os(macOS)
import SwiftUI
import AppKit

struct LaunchSessionDialog: View {
    let daemonPort: UInt16?

    @AppStorage("launch.lastFolder") private var folderPath: String = ""
    @AppStorage("launch.lastAgent") private var agentRaw: String = LaunchAgentType.claudeCode.rawValue
    @AppStorage("launch.lastTerminal") private var terminalRaw: String = TerminalApp.system.rawValue

    @State private var installedTerminals: [TerminalApp] = TerminalApp.installed()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Launch Session")
                .font(.headline)

            // Folder row
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

            // Agent picker
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

            // Terminal picker
            VStack(alignment: .leading, spacing: 4) {
                Text("Terminal")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Picker("", selection: $terminalRaw) {
                    ForEach(installedTerminals, id: \.rawValue) { term in
                        Text(term.displayName).tag(term.rawValue)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }

            HStack {
                Spacer()
                Button("Cancel") { closeWindow() }
                    .keyboardShortcut(.cancelAction)
                Button("Launch") { launch() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(folderPath.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
        .onAppear {
            installedTerminals = TerminalApp.installed()
            // If saved terminal is no longer installed, fall back to system
            if !installedTerminals.contains(where: { $0.rawValue == terminalRaw }) {
                terminalRaw = TerminalApp.system.rawValue
            }
        }
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
        let terminal = TerminalApp(rawValue: terminalRaw) ?? .system
        SessionLauncher.launchSession(
            project: folderPath.isEmpty ? nil : folderPath,
            agent: agent,
            terminalApp: terminal,
            daemonPort: daemonPort
        )
        closeWindow()
    }

    private func closeWindow() {
        // Find the window hosting this view and close it
        if let window = NSApp.windows.first(where: { $0.title == "Launch Session" }) {
            window.close()
        }
    }
}
#endif
