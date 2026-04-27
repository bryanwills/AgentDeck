#if os(macOS)
// DaemonLogger.swift — Logging utility for daemon components

import Foundation
import os.log

final class DaemonLogger: @unchecked Sendable {
    static let shared = DaemonLogger()

    nonisolated(unsafe) var isDebugEnabled = true
    private let stateLock = NSLock()
    private var throttledKeys: [String: Date] = [:]
    private var sampledCounters: [String: Int] = [:]
    private let fileWriteQueue = DispatchQueue(label: "dev.agentdeck.daemon.file-log", qos: .utility)
    private let fileWriteLock = NSLock()
    private var fileWriteInFlight = false
    private let fileReadQueue = DispatchQueue(label: "dev.agentdeck.daemon.file-log-read", qos: .utility)

    private let osLog = os.Logger(subsystem: "dev.agentdeck.daemon", category: "daemon")
    private let logFile: URL = AgentDeckPaths.swiftDaemonLog

    private func writeToFile(_ line: String) {
        let entry = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
        guard let data = entry.data(using: .utf8) else { return }

        fileWriteLock.lock()
        guard !fileWriteInFlight else {
            fileWriteLock.unlock()
            return
        }
        fileWriteInFlight = true
        fileWriteLock.unlock()

        fileWriteQueue.async { [data, logFile] in
            defer {
                self.fileWriteLock.lock()
                self.fileWriteInFlight = false
                self.fileWriteLock.unlock()
            }

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

    func throttledDebug(_ category: String, key: String, _ message: String, minInterval: TimeInterval) {
        let now = Date()
        stateLock.lock()
        let last = throttledKeys[key]
        if let last, now.timeIntervalSince(last) < minInterval {
            stateLock.unlock()
            return
        }
        throttledKeys[key] = now
        stateLock.unlock()
        debug(category, message)
    }

    func sampledDebug(_ category: String, key: String, every: Int, _ message: String) {
        guard every > 1 else {
            debug(category, message)
            return
        }

        stateLock.lock()
        let nextCount = (sampledCounters[key] ?? 0) + 1
        sampledCounters[key] = nextCount
        stateLock.unlock()

        guard nextCount == 1 || nextCount % every == 0 else { return }
        let suffix = nextCount == 1 ? "" : " [count=\(nextCount)]"
        debug(category, message + suffix)
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
        let box = DaemonLogReadBox()
        let semaphore = DispatchSemaphore(value: 0)
        fileReadQueue.async { [logFile] in
            box.set(try? String(contentsOf: logFile, encoding: .utf8))
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + .milliseconds(500)) == .success,
              let text = box.get() else { return [] }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        guard lines.count > limit else { return lines }
        return Array(lines.suffix(limit))
    }
}

private final class DaemonLogReadBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    func set(_ value: String?) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func get() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
#endif
