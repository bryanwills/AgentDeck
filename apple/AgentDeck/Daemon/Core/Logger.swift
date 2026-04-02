#if os(macOS)
// DaemonLogger.swift — Logging utility for daemon components

import Foundation
import os.log

final class DaemonLogger: Sendable {
    static let shared = DaemonLogger()

    nonisolated(unsafe) var isDebugEnabled = true

    private let osLog = os.Logger(subsystem: "dev.agentdeck.daemon", category: "daemon")
    private let logFile: URL = {
        // Use getpwuid to bypass App Sandbox container redirect
        let homeDir: String
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            homeDir = String(cString: dir)
        } else {
            homeDir = FileManager.default.homeDirectoryForCurrentUser.path
        }
        let dir = URL(fileURLWithPath: homeDir).appendingPathComponent(".agentdeck")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("swift-daemon.log")
    }()

    private func writeToFile(_ line: String) {
        let entry = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
        if let data = entry.data(using: .utf8) {
            if let fh = try? FileHandle(forWritingTo: logFile) {
                fh.seekToEndOfFile()
                fh.write(data)
                fh.closeFile()
            } else {
                try? data.write(to: logFile)
            }
        }
    }

    func debug(_ category: String, _ message: String) {
        let line = "DEBUG [\(category)] \(message)"
        writeToFile(line)
        guard isDebugEnabled else { return }
        osLog.debug("[\(category)] \(message)")
    }

    func info(_ message: String) {
        let line = "INFO \(message)"
        writeToFile(line)
        osLog.info("\(message)")
    }

    func error(_ message: String) {
        let line = "ERROR \(message)"
        writeToFile(line)
        osLog.error("\(message)")
    }

    func recentLines(limit: Int = 200) -> [String] {
        guard let text = try? String(contentsOf: logFile, encoding: .utf8) else { return [] }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        guard lines.count > limit else { return lines }
        return Array(lines.suffix(limit))
    }
}
#endif
