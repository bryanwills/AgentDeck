// D200hHidModule.swift — Ulanzi D200H HID protocol module (IOKit)
// Communicates via stock HID protocol (VID 0x2207, PID 0x0019).
// No ADB, no firmware modification, no on-device agent.
//
// Ported from bridge/src/d200h/ (hid-protocol.ts + image-renderer.ts + d200h-module.ts)

import Foundation

#if os(macOS)
import IOKit
import IOKit.hid
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

// MARK: - HID Protocol Constants

private let D200H_VID: Int32 = 0x2207
private let D200H_PID: Int32 = 0x0019
private let CONSUMER_USAGE_PAGE: Int32 = 12
private let KEYBOARD_USAGE_PAGE: Int32 = 1
private let PACKET_SIZE = 1024
private let ICON_SIZE = 196

private let POLL_INTERVAL: UInt64 = 500_000_000   // 500ms device detection
private let KEEPALIVE_INTERVAL: TimeInterval = 15  // 15s keep-alive (D200H reverts to default after ~30s)

// HID Commands
private let CMD_SET_BUTTONS: UInt16    = 0x0001
private let CMD_PARTIAL_UPDATE: UInt16 = 0x000d
private let CMD_SET_SMALL_WINDOW: UInt16 = 0x0006
private let CMD_SET_BRIGHTNESS: UInt16 = 0x000a
private let CMD_IN_BUTTON: UInt16      = 0x0101
private let CMD_IN_DEVICE_INFO: UInt16 = 0x0303

private let ANIM_INTERVAL: UInt64 = 250_000_000  // 250ms = 4fps animation

// MARK: - D200hHidModule

final class D200hHidModule: DeviceModule, @unchecked Sendable {
    let name = "d200h"

    nonisolated(unsafe) var commandHandler: (([String: Any]) -> Void)?

    private var hidManager: IOHIDManager?
    private var consumerDevice: IOHIDDevice?
    private var keyboardDevice: IOHIDDevice?
    private var connected = false
    private var managerOpened = false
    private var lastStateHash = ""

    private var pollTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var animationTask: Task<Void, Never>?

    // Cached state for rendering
    nonisolated(unsafe) private var cachedStateEvent: [String: Any]?
    nonisolated(unsafe) private var cachedUsageEvent: [String: Any]?
    nonisolated(unsafe) private var cachedSessionsList: [[String: Any]] = []

    // Display mode
    private enum DisplayMode { case sessionList, optionSelect }
    private var currentMode: DisplayMode = .sessionList
    private var focusedSessionId: String?
    private var animFrame: Int = 0
    private var needsAnimation = false
    private var sessionPage: Int = 0
    private var optionPage: Int = 0
    private var buttonPressCount: Int = 0
    private var lastButtonIndex: Int = -1
    private var hidReportCount: Int = 0
    private var writeSuccessCount: Int = 0
    private var writeFailCount: Int = 0
    private var lastWriteError: Int32 = 0
    private var lastFullSlots: [ButtonSlot] = []  // cache for partial update diff
    private var animatedButtonIds: [Int] = []      // buttons needing animation
    private var partialUpdateSupported = true       // fallback if PARTIAL_UPDATE fails

    // MARK: - DeviceModule

    func start() async {
        DaemonLogger.shared.info("D200H HID module starting")

        // Create IOHIDManager
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        hidManager = manager

        // Match D200H device (VID/PID)
        let matchDict: [[String: Any]] = [
            [
                kIOHIDVendorIDKey as String: D200H_VID,
                kIOHIDProductIDKey as String: D200H_PID,
            ]
        ]
        IOHIDManagerSetDeviceMatchingMultiple(manager, matchDict as CFArray)

        // Register device attach/remove callbacks
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        IOHIDManagerRegisterDeviceMatchingCallback(manager, { context, _, _, device in
            guard let context else { return }
            let module = Unmanaged<D200hHidModule>.fromOpaque(context).takeUnretainedValue()
            module.handleDeviceAttached(device)
        }, selfPtr)

        IOHIDManagerRegisterDeviceRemovalCallback(manager, { context, _, _, device in
            guard let context else { return }
            let module = Unmanaged<D200hHidModule>.fromOpaque(context).takeUnretainedValue()
            module.handleDeviceRemoved(device)
        }, selfPtr)

        // Schedule on main run loop — fires matching callback for already-present devices
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)

        // Don't call IOHIDManagerOpen — it fails with kIOReturnNotPermitted when
        // Keyboard interface is matched (requires Input Monitoring).
        // Instead, open each device individually in handleDeviceAttached.
        managerOpened = true

        // If device was already attached during scheduling, run deferred initialization now
        if connected {
            initializeDevice()
        }

        // Heartbeat timer starts in initializeDevice() when device connects
        DaemonLogger.shared.info("D200H HID module started — watching for device")
    }

    func stop() async {
        pollTask?.cancel()
        heartbeatTask?.cancel()
        animationTask?.cancel()
        disconnect()

        if let manager = hidManager {
            IOHIDManagerUnscheduleFromRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
            IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        }
        hidManager = nil
        DaemonLogger.shared.debug("D200H", "Module stopped")
    }

    // MARK: - Broadcast Handler

    func handleBroadcast(_ event: [String: Any]) {
        guard let type = event["type"] as? String else { return }
        switch type {
        case "state_update":
            cachedStateEvent = event
            updateDisplay()
        case "usage_update":
            cachedUsageEvent = event
            updateDisplay()
        case "sessions_list":
            let sessions = event["sessions"] as? [[String: Any]] ?? []
            debugLog("BROADCAST sessions_list: \(sessions.count) sessions")
            cachedSessionsList = sessions
            updateDisplay()
        default: break
        }
    }

    func statusSnapshot() -> [String: Any] {
        [
            "connected": connected,
            "managerOpened": managerOpened,
            "hasConsumerDevice": consumerDevice != nil,
            "hasKeyboardDevice": keyboardDevice != nil,
            "buttonPressCount": buttonPressCount,
            "lastButtonIndex": lastButtonIndex,
            "hidReportCount": hidReportCount,
            "writeOK": writeSuccessCount,
            "writeFail": writeFailCount,
            "lastWriteError": lastWriteError,
            "mode": currentMode == .sessionList ? "sessions" : "options",
            "sessionsCount": cachedSessionsList.count,
            "lastStateHash": lastStateHash,
            "animFrame": animFrame,
            "needsAnimation": needsAnimation,
        ]
    }

    // MARK: - Device Attach/Remove (IOKit callbacks, run loop thread)

    private func hidDeviceProperty(_ device: IOHIDDevice, _ key: String) -> Int32? {
        if let val = IOHIDDeviceGetProperty(device, key as CFString) {
            if let num = val as? NSNumber { return num.int32Value }
        }
        return nil
    }

    private func handleDeviceAttached(_ device: IOHIDDevice) {
        let usagePage = hidDeviceProperty(device, kIOHIDPrimaryUsagePageKey) ?? 0

        if usagePage == CONSUMER_USAGE_PAGE {
            // Open consumer device individually — needed for IOHIDDeviceSetReport (display writes)
            let openResult = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
            if openResult != kIOReturnSuccess {
                DaemonLogger.shared.debug("D200H", "Consumer device open failed: \(openResult)")
            }
            consumerDevice = device
            DaemonLogger.shared.info("D200H Consumer Control interface attached")
        } else if usagePage == KEYBOARD_USAGE_PAGE {
            keyboardDevice = device
            DaemonLogger.shared.info("D200H Keyboard interface attached (button events)")

            // Open keyboard device — seize not required for D200H custom HID protocol
            // (D200H button reports use 0x7C7C framing, not standard keyboard usage, so hidd doesn't intercept)
            let openResult = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
            if openResult != kIOReturnSuccess {
                DaemonLogger.shared.debug("D200H", "Keyboard open failed: \(openResult)")
            }

            // Register input report callback for button events
            registerInputCallback(device)
        }

        if consumerDevice != nil {
            if !connected {
                connected = true
                DaemonLogger.shared.info("D200H connected via HID")

                // Initial setup deferred if manager not yet open (callback fires during scheduling)
                if managerOpened {
                    initializeDevice()
                }
            }
        }
    }

    private func initializeDevice() {
        writePacket(buildBrightnessPacket(100))
        writePacket(buildLabelStylePacket())
        if let cd = consumerDevice {
            registerInputCallback(cd)
        }

        // Force full render (clear hash so updateDisplay always sends)
        lastStateHash = ""
        updateDisplay()

        // Start heartbeat — periodic re-render + small window keep-alive
        // Prevents D200H firmware timeout (reverts to default after ~30s)
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)  // 15s
                guard let self, self.connected, self.managerOpened else { continue }
                self.lastStateHash = ""  // force re-render
                self.updateDisplay()
                self.sendKeepAlive()
            }
        }
    }

    private func handleDeviceRemoved(_ device: IOHIDDevice) {
        if device === consumerDevice {
            consumerDevice = nil
            DaemonLogger.shared.info("D200H Consumer Control interface removed")
        }
        if device === keyboardDevice {
            keyboardDevice = nil
            DaemonLogger.shared.info("D200H Keyboard interface removed")
        }

        if consumerDevice == nil {
            connected = false
            lastStateHash = ""
            heartbeatTask?.cancel()
            heartbeatTask = nil
            DaemonLogger.shared.info("D200H disconnected — heartbeat stopped")
        }
    }

    // MARK: - Input Report (Button Events)

    private func registerInputCallback(_ device: IOHIDDevice) {
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        IOHIDDeviceRegisterInputReportCallback(
            device,
            UnsafeMutablePointer<UInt8>.allocate(capacity: PACKET_SIZE),
            PACKET_SIZE,
            { context, _, _, _, _, report, reportLength in
                guard let context else { return }
                let module = Unmanaged<D200hHidModule>.fromOpaque(context).takeUnretainedValue()
                let data = Data(bytes: report, count: reportLength)
                module.handleInputReport(data)
            },
            selfPtr
        )
    }

    private func handleInputReport(_ data: Data) {
        hidReportCount += 1
        guard data.count >= 8, data[0] == 0x7C, data[1] == 0x7C else { return }

        let command = UInt16(data[2]) << 8 | UInt16(data[3])

        if command == CMD_IN_BUTTON && data.count >= 12 {
            let buttonIndex = Int(data[9])
            let pressed = data[11] == 0x01

            if pressed {
                buttonPressCount += 1
                lastButtonIndex = buttonIndex
                if let cmd = resolveButtonCommand(buttonIndex) {
                    DaemonLogger.shared.debug("D200H", "Button \(buttonIndex) pressed -> \(cmd["type"] ?? "")")
                    commandHandler?(cmd)
                } else {
                    DaemonLogger.shared.debug("D200H", "Button \(buttonIndex) pressed (unmapped)")
                }
            }
        } else if command == CMD_IN_DEVICE_INFO {
            if let jsonStr = String(data: data[8...], encoding: .ascii)?.components(separatedBy: "\0").first,
               let jsonData = jsonStr.data(using: .utf8),
               let info = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
                DaemonLogger.shared.debug("D200H", "Device: \(info["DeviceType"] ?? "") fw=\(info["Dversion"] ?? "") hw=\(info["HardwareVersion"] ?? "")")
            }
        }
    }

    // MARK: - Dynamic Button Command Resolution

    private func resolveButtonCommand(_ index: Int) -> [String: Any]? {
        let sessions = buildSessionList()

        switch currentMode {
        case .sessionList:
            // All 13 slots are sessions
            let startIdx = sessionPage * 13
            let sessionIdx = startIdx + index
            guard sessionIdx < sessions.count else { return nil }
            let session = sessions[sessionIdx]

            // Focus this session and enter detail view
            focusedSessionId = session.id
            commandHandler?(["type": "focus_session", "sessionId": session.id])
            currentMode = .optionSelect
            optionPage = 0
            lastStateHash = ""  // force re-render on mode change
            debugLog("BUTTON \(index) → optionSelect session=\(session.id)")
            updateDisplay()
            return nil

        case .optionSelect:
            guard let focusId = focusedSessionId,
                  let session = sessions.first(where: { $0.id == focusId }) else {
                currentMode = .sessionList
                lastStateHash = ""
                updateDisplay()
                return nil
            }

            switch index {
            case 0, 12:  // BACK
                currentMode = .sessionList
                lastStateHash = ""
                updateDisplay()
                return nil

            case 1:  // Info display, no action
                return nil

            case 2...9:  // Option buttons or Quick Actions
                if session.options.isEmpty && session.isIdle {
                    // Quick actions: GO ON, REVIEW, COMMIT, CLEAR
                    let actions = ["go on", "/review", "/commit", "/clear"]
                    let qaIdx = index - 2
                    guard qaIdx < actions.count else { return nil }
                    return ["type": "send_prompt", "text": actions[qaIdx]]
                }

                let optIdx = optionPage * 8 + (index - 2)
                guard optIdx < session.options.count else { return nil }
                let opt = session.options[optIdx]
                let shortcut = opt["shortcut"] as? String ?? ""
                let label = opt["label"] as? String ?? ""

                currentMode = .sessionList
                lastStateHash = ""
                updateDisplay()

                if session.navigable {
                    return ["type": "select_option", "index": optIdx]
                } else {
                    let key = shortcut.isEmpty ? String(label.prefix(1)).lowercased() : shortcut
                    return ["type": "respond", "response": key]
                }

            case 10:  // STOP/ESC combined
                if session.isProcessing {
                    return ["type": "interrupt"]
                } else {
                    currentMode = .sessionList
                    lastStateHash = ""
                    updateDisplay()
                    return ["type": "escape"]
                }

            case 11:  // MORE
                let totalOptPages = max(1, (session.options.count + 7) / 8)
                optionPage = (optionPage + 1) % totalOptPages
                updateDisplay()
                return nil
            default: return nil
            }
        }
    }

    // MARK: - Display Update (Hybrid: full SET_BUTTONS + partial PARTIAL_UPDATE for animation)

    private func debugLog(_ msg: String) {
        DaemonLogger.shared.debug("D200H", msg)
        NSLog("[D200H] %@", msg)
    }

    private func updateDisplay(animationOnly: Bool = false) {
        guard connected, managerOpened else {
            debugLog("updateDisplay SKIP: connected=\(connected) managerOpened=\(managerOpened)")
            return
        }

        let allSessions = buildSessionList()

        var slots: [ButtonSlot]
        var animButtonIds: [Int] = []

        switch currentMode {
        case .sessionList:
            let (s, anim) = D200hRenderer.computeSessionListSlots(
                sessions: allSessions, stateEvent: cachedStateEvent, usageEvent: cachedUsageEvent,
                page: sessionPage, animFrame: animFrame
            )
            slots = s
            updateAnimationTimer(needsAnimation: anim)
            // Track which buttons have border animation
            let startIdx = sessionPage * 13
            for i in 0..<13 {
                let sessionIdx = startIdx + i
                guard sessionIdx < allSessions.count else { break }
                if allSessions[sessionIdx].isAwaiting || allSessions[sessionIdx].isProcessing {
                    animButtonIds.append(i)
                }
            }

        case .optionSelect:
            if let focusId = focusedSessionId,
               let session = allSessions.first(where: { $0.id == focusId }) {
                slots = D200hRenderer.computeOptionSelectSlots(session: session, page: optionPage)
            } else {
                // Session disappeared — stay in option view with last known state
                // User must press BACK to return to session list
                slots = [ButtonSlot](repeating: .dim, count: 13)
                slots[0] = ButtonSlot(title: "← BACK", subtitle: "", bg: D200hRenderer.cDark, enabled: true, borderStyle: .none)
                slots[10] = ButtonSlot(title: "✖ ESC", subtitle: "", bg: D200hRenderer.cEscActive, enabled: true, borderStyle: .none)
            }
        }

        animatedButtonIds = animButtonIds

        // Decide: full update or partial animation
        if animationOnly && partialUpdateSupported && !animatedButtonIds.isEmpty && !lastFullSlots.isEmpty {
            // PARTIAL_UPDATE — only re-render animated buttons
            let zip = D200hRenderer.renderPartialZip(slots: slots, buttonIds: animatedButtonIds)
            let packets = buildZipPackets(zip, command: CMD_PARTIAL_UPDATE)
            for packet in packets { writePacket(packet) }
        } else {
            // Skip if content unchanged (prevents flooding device with repeated ZIPs)
            let modeKey = currentMode == .sessionList ? "L" : "O"
            let contentKey = "\(modeKey)|\(slots.map { $0.title }.joined(separator: ","))"
            if contentKey == lastStateHash { return }
            lastStateHash = contentKey

            let zip = D200hRenderer.renderFullZip(
                slots: slots, sessions: allSessions,
                stateEvent: cachedStateEvent, usageEvent: cachedUsageEvent
            )
            let packets = buildZipPackets(zip)
            for packet in packets { writePacket(packet) }
            lastFullSlots = slots
            debugLog("SENT \(zip.count)b \(packets.count)pkt mode=\(modeKey) slot0=\(slots[0].title)")
        }
    }

    private func buildSessionList() -> [D200hSessionInfo] {
        // sessions_list from daemon already includes all sessions — no manual insertion needed
        cachedSessionsList.map { D200hSessionInfo.parse($0) }
    }

    // MARK: - Animation Timer

    private func updateAnimationTimer(needsAnimation: Bool) {
        self.needsAnimation = needsAnimation
        if needsAnimation && animationTask == nil {
            animationTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: ANIM_INTERVAL)
                    guard let self, self.needsAnimation, self.connected else { continue }
                    self.animFrame += 1
                    self.updateDisplay(animationOnly: true)  // partial update for animation frames
                }
            }
        } else if !needsAnimation {
            animationTask?.cancel()
            animationTask = nil
        }
    }

    // MARK: - Keep-alive

    private func sendKeepAlive() {
        guard connected, managerOpened else { return }
        // Keep-alive via small window update
        let pct5h = cachedUsageEvent?["fiveHourPercent"] as? Double ?? cachedStateEvent?["fiveHourPercent"] as? Double ?? 0
        let pct7d = cachedUsageEvent?["sevenDayPercent"] as? Double ?? cachedStateEvent?["sevenDayPercent"] as? Double ?? 0
        let sessions = cachedSessionsList.count
        let text: String
        if pct5h >= 90 { text = "⚡ 5h:\(Int(pct5h))%" }
        else if pct5h > 0 { text = "5h:\(Int(pct5h))% 7d:\(Int(pct7d))%" }
        else { text = "\(sessions) agents" }
        writePacket(buildSmallWindowPacket(mode: 1, cpu: 0, mem: 0, time: text, gpu: 0))
    }

    // MARK: - HID Write

    private func writePacket(_ data: Data) {
        guard let device = consumerDevice else { return }

        // IOKit HID setReport for output
        let result = data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> IOReturn in
            guard let base = ptr.baseAddress else { return kIOReturnBadArgument }
            return IOHIDDeviceSetReport(
                device,
                kIOHIDReportTypeOutput,
                0,  // report ID
                base.assumingMemoryBound(to: UInt8.self),
                data.count
            )
        }

        if result == kIOReturnSuccess || result == kIOReturnUnderrun {
            writeSuccessCount += 1
        } else {
            writeFailCount += 1
            lastWriteError = result
        }
    }

    private func disconnect() {
        if let dev = consumerDevice { IOHIDDeviceClose(dev, IOOptionBits(kIOHIDOptionsTypeNone)) }
        if let dev = keyboardDevice { IOHIDDeviceClose(dev, IOOptionBits(kIOHIDOptionsTypeNone)) }
        consumerDevice = nil
        keyboardDevice = nil
        connected = false
        lastStateHash = ""
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }
}

// MARK: - HID Packet Building

private func buildPacket(command: UInt16, payload: Data, totalLength: UInt32? = nil) -> Data {
    var pkt = Data(count: PACKET_SIZE)
    // Header
    pkt[0] = 0x7C
    pkt[1] = 0x7C
    // Command (big-endian uint16)
    pkt[2] = UInt8(command >> 8)
    pkt[3] = UInt8(command & 0xFF)
    // Length (little-endian uint32)
    let len = totalLength ?? UInt32(payload.count)
    pkt[4] = UInt8(len & 0xFF)
    pkt[5] = UInt8((len >> 8) & 0xFF)
    pkt[6] = UInt8((len >> 16) & 0xFF)
    pkt[7] = UInt8((len >> 24) & 0xFF)
    // Payload
    let copyLen = min(payload.count, PACKET_SIZE - 8)
    if copyLen > 0 {
        pkt.replaceSubrange(8..<(8 + copyLen), with: payload[0..<copyLen])
    }
    return pkt
}

private func buildZipPackets(_ zipData: Data, command: UInt16 = CMD_SET_BUTTONS) -> [Data] {
    var packets: [Data] = []
    let fileSize = UInt32(zipData.count)

    // First packet: header(8) + first chunk
    let firstChunkSize = PACKET_SIZE - 8
    let firstChunk = zipData.prefix(firstChunkSize)
    packets.append(buildPacket(command: command, payload: firstChunk, totalLength: fileSize))

    // Remaining chunks (raw, no header)
    var offset = firstChunkSize
    while offset < zipData.count {
        var chunk = Data(count: PACKET_SIZE)
        let remaining = min(PACKET_SIZE, zipData.count - offset)
        chunk.replaceSubrange(0..<remaining, with: zipData[offset..<(offset + remaining)])
        packets.append(chunk)
        offset += PACKET_SIZE
    }

    return packets
}

private func buildBrightnessPacket(_ brightness: Int) -> Data {
    let val = max(0, min(100, brightness))
    let payload = Data(String(val).utf8)
    return buildPacket(command: CMD_SET_BRIGHTNESS, payload: payload)
}

private let CMD_SET_LABEL_STYLE: UInt16 = 0x000b

private func buildLabelStylePacket() -> Data {
    let style: [String: Any] = [
        "Align": "bottom",
        "Color": 0xFFFFFF,
        "FontName": "Roboto",
        "ShowTitle": 1,
        "Size": 16,
        "Weight": 80,
    ]
    guard let json = try? JSONSerialization.data(withJSONObject: style) else { return Data() }
    return buildPacket(command: CMD_SET_LABEL_STYLE, payload: json)
}

private func buildSmallWindowPacket(mode: Int, cpu: Int, mem: Int, time: String, gpu: Int) -> Data {
    let str = "\(mode)|\(cpu)|\(mem)|\(time)|\(gpu)"
    return buildPacket(command: CMD_SET_SMALL_WINDOW, payload: Data(str.utf8))
}

// MARK: - Session Data

private struct D200hSessionInfo {
    let id: String
    let projectName: String
    let agentType: String
    let state: String
    let port: Int
    let currentTool: String
    let options: [[String: Any]]
    let navigable: Bool

    var isIdle: Bool { state == "idle" }
    var isProcessing: Bool { state == "processing" }
    var isAwaiting: Bool { state.hasPrefix("awaiting") }

    static func parse(_ dict: [String: Any]) -> D200hSessionInfo {
        D200hSessionInfo(
            id: dict["id"] as? String ?? "",
            projectName: dict["projectName"] as? String ?? dict["agentType"] as? String ?? "",
            agentType: dict["agentType"] as? String ?? "",
            state: dict["state"] as? String ?? "idle",
            port: dict["port"] as? Int ?? 0,
            currentTool: dict["currentTool"] as? String ?? "",
            options: dict["options"] as? [[String: Any]] ?? [],
            navigable: dict["navigable"] as? Bool ?? false
        )
    }
}

// MARK: - Button Slot Definition

private struct ButtonSlot {
    let title: String
    let subtitle: String
    let bg: CGColor
    let enabled: Bool
    let borderStyle: BorderStyle

    enum BorderStyle {
        case none
        case awaitingPulse(color: CGColor, frame: Int)    // glow pulse
        case processingDash(color: CGColor, frame: Int)   // flowing dash
        case solid(color: CGColor)                        // static border
    }

    static let dim = ButtonSlot(title: "", subtitle: "", bg: rgb(17, 17, 17), enabled: false, borderStyle: .none)
}

// MARK: - Agent Controller Renderer (SD+ Style)

private enum D200hRenderer {
    // === SD+ Exact Color Palette ===
    // Backgrounds
    static let cEmpty       = rgb(17, 17, 17)      // #111111 empty slot
    static let cSessionDef  = rgb(26, 26, 46)       // #1a1a2e session default
    static let cSessionAct  = rgb(30, 58, 95)       // #1e3a5f active session
    static let cSessionAwt  = rgb(45, 24, 16)       // #2d1810 awaiting session
    static let cDetailBg    = rgb(15, 23, 42)       // #0f172a detail/info bg
    static let cDark        = rgb(26, 26, 26)       // #1a1a1a nav buttons

    // State indicator colors
    static let cStateIdle   = rgb(34, 197, 94)      // #22c55e green-500
    static let cStateProc   = rgb(234, 179, 8)       // #eab308 yellow-500
    static let cStateAwait  = rgb(249, 115, 22)      // #f97316 orange-500
    static let cStatePerm   = rgb(239, 68, 68)       // #ef4444 red-500
    static let cStateDisco  = rgb(107, 114, 128)     // #6b7280 gray-500

    // UI elements
    static let cActiveBar   = rgb(59, 130, 246)      // #3b82f6 blue-500 left indicator
    static let cPageNav     = rgb(96, 165, 250)      // #60a5fa blue-400

    // Option buttons
    static let cOptBlue     = rgb(30, 64, 175)       // #1e40af blue-800
    static let cOptRed      = rgb(153, 27, 27)       // #991b1b red-900
    static let cOptGreen    = rgb(22, 101, 52)       // #166534 green-700
    static let cOptTeal     = rgb(30, 58, 95)        // #1e3a5f blue-900

    // Control buttons
    static let cStopActive  = rgb(45, 16, 16)        // #2d1010
    static let cStopInact   = rgb(26, 10, 10)        // #1a0a0a
    static let cEscActive   = rgb(45, 24, 16)        // #2d1810
    static let cEscInact    = rgb(26, 19, 8)         // #1a1308

    // State → indicator color
    static func stateColor(_ state: String, agent: String = "") -> CGColor {
        if agent == "openclaw" {
            switch state {
            case "idle": return rgb(6, 182, 212)     // #06b6d4 cyan-400
            case "processing": return cStateIdle
            default: break
            }
        }
        switch state {
        case "idle": return cStateIdle
        case "processing": return cStateProc
        case "awaiting_permission": return cStatePerm
        case "awaiting_option", "awaiting_diff": return cStateAwait
        default: return cStateDisco
        }
    }

    // State → session button background
    static func sessionBg(_ state: String) -> CGColor {
        switch state {
        case "idle", "processing": return cSessionAct
        case _ where state.hasPrefix("awaiting"): return cSessionAwt
        default: return cSessionDef
        }
    }

    // Option label → background color
    static func optionBgColor(label: String, shortcut: String) -> CGColor {
        let lower = label.lowercased()
        let sc = shortcut.lowercased()
        if lower.hasPrefix("always") || lower.contains("don't ask") || lower.contains("allow all") { return cOptBlue }
        if sc == "n" || sc == "d" || lower.hasPrefix("no") || lower.hasPrefix("deny") { return cOptRed }
        if sc == "y" || sc == "a" || lower.hasPrefix("yes") || lower.hasPrefix("apply") { return cOptGreen }
        return cOptTeal
    }

    // Cycling option background colors (SD+ pattern)
    static let optionBgCycle: [CGColor] = [
        rgb(30, 58, 95), rgb(30, 58, 74), rgb(42, 30, 74), rgb(30, 74, 58), rgb(58, 30, 42),
    ]

    struct KeyDef { let id: Int; let col: Int; let row: Int }
    static let keyDefs: [KeyDef] = [
        KeyDef(id: 0, col: 0, row: 0), KeyDef(id: 1, col: 1, row: 0),
        KeyDef(id: 2, col: 2, row: 0), KeyDef(id: 3, col: 3, row: 0),
        KeyDef(id: 4, col: 4, row: 0), KeyDef(id: 5, col: 0, row: 1),
        KeyDef(id: 6, col: 1, row: 1), KeyDef(id: 7, col: 2, row: 1),
        KeyDef(id: 8, col: 3, row: 1), KeyDef(id: 9, col: 4, row: 1),
        KeyDef(id: 10, col: 0, row: 2), KeyDef(id: 11, col: 1, row: 2),
        KeyDef(id: 12, col: 2, row: 2),
    ]

    // MARK: - Mode A: Session List

    static func computeSessionListSlots(
        sessions: [D200hSessionInfo], stateEvent: [String: Any]?, usageEvent: [String: Any]?,
        page: Int, animFrame: Int
    ) -> ([ButtonSlot], Bool) {
        var slots = [ButtonSlot](repeating: .dim, count: 13)
        var needsAnim = false

        // All 13 slots for sessions (13 per page, no control buttons)
        let startIdx = page * 13
        for i in 0..<13 {
            let sessionIdx = startIdx + i
            guard sessionIdx < sessions.count else { break }
            let session = sessions[sessionIdx]

            let bg = sessionBg(session.state)
            let sColor = stateColor(session.state, agent: session.agentType)
            let typeLabel = session.agentType == "openclaw" ? "OC" : "CC"
            let projName = session.projectName.isEmpty ? session.agentType : String(session.projectName.prefix(10))
            let name = "[\(typeLabel)] \(projName)"

            let border: ButtonSlot.BorderStyle
            if session.isAwaiting {
                border = .awaitingPulse(color: sColor, frame: animFrame)
                needsAnim = true
            } else if session.isProcessing {
                border = .processingDash(color: sColor, frame: animFrame)
                needsAnim = true
            } else {
                border = .none
            }

            let stateLabel: String
            switch session.state {
            case "processing":
                stateLabel = session.agentType == "openclaw" ? "● ROUTING" : "● WORKING"
            case "awaiting_permission", "awaiting_option", "awaiting_diff":
                stateLabel = "● AWAITING"
            case "idle":
                stateLabel = session.agentType == "openclaw" ? "● STANDBY" : "● IDLE"
            default: stateLabel = ""
            }

            slots[i] = ButtonSlot(
                title: name, subtitle: stateLabel,
                bg: bg, enabled: true, borderStyle: border
            )
        }

        return (slots, needsAnim)
    }

    // MARK: - Mode B: Option Select

    static func computeOptionSelectSlots(
        session: D200hSessionInfo, page: Int
    ) -> [ButtonSlot] {
        var slots = [ButtonSlot](repeating: .dim, count: 13)

        // Slot 0: ← BACK
        slots[0] = ButtonSlot(title: "← BACK", subtitle: "", bg: cDark, enabled: true, borderStyle: .none)

        // Slot 1: Session info
        let name = session.projectName.isEmpty ? session.agentType : String(session.projectName.prefix(12))
        let sColor = stateColor(session.state, agent: session.agentType)
        let tool = session.currentTool.isEmpty ? "" : "▶ \(session.currentTool)"
        slots[1] = ButtonSlot(title: name, subtitle: tool,
                              bg: cDetailBg, enabled: false,
                              borderStyle: .solid(color: sColor))

        // Slots 2-9: Options or Quick Actions
        let options = session.options
        if options.isEmpty && session.isIdle {
            // IDLE: show default quick actions
            let quickActions: [(title: String, bg: CGColor)] = [
                ("GO ON",   rgb(30, 58, 47)),    // green-dark
                ("REVIEW",  cSessionAct),
                ("COMMIT",  cSessionAct),
                ("CLEAR",   cSessionAct),
            ]
            for (i, qa) in quickActions.enumerated() {
                slots[2 + i] = ButtonSlot(title: qa.title, subtitle: "", bg: qa.bg, enabled: true, borderStyle: .none)
            }
        } else if options.isEmpty && session.isProcessing {
            // PROCESSING: show current tool info, no actions
            if !session.currentTool.isEmpty {
                slots[2] = ButtonSlot(title: "▶ \(session.currentTool)", subtitle: "", bg: cSessionAct, enabled: false, borderStyle: .none)
            }
        } else {
            // AWAITING: show actual options
            let startIdx = page * 8
            for i in 0..<8 {
                let optIdx = startIdx + i
                guard optIdx < options.count else { break }
                let opt = options[optIdx]
                let label = opt["label"] as? String ?? ""
                let shortcut = opt["shortcut"] as? String ?? ""
                let recommended = opt["recommended"] as? Bool ?? false
                let bg = optionBgColor(label: label, shortcut: shortcut)
                let displayLabel = label.count <= 12 ? label.uppercased() : String(label.prefix(14))
                let badge = recommended ? "★ " : ""

                slots[2 + i] = ButtonSlot(
                    title: "\(badge)\(displayLabel)", subtitle: "",
                    bg: bg, enabled: true, borderStyle: .none
                )
            }
        }

        // Slot 10: STOP/ESC combined (bottom-left)
        if session.isProcessing {
            slots[10] = ButtonSlot(title: "■ STOP", subtitle: "", bg: cStopActive, enabled: true, borderStyle: .none)
        } else {
            slots[10] = ButtonSlot(title: "✖ ESC", subtitle: "", bg: cEscActive, enabled: true, borderStyle: .none)
        }

        // Slot 11: MORE (if overflow)
        if options.count > (page + 1) * 8 {
            slots[11] = ButtonSlot(title: "▶ MORE", subtitle: "", bg: cSessionDef, enabled: true, borderStyle: .none)
        }

        // Slot 12: ← BACK
        slots[12] = ButtonSlot(title: "← BACK", subtitle: "", bg: cDark, enabled: true, borderStyle: .none)

        return slots
    }

    // MARK: - Render ZIP

    /// Full dashboard ZIP (all 13 buttons) — used for layout changes
    static func renderFullZip(
        slots: [ButtonSlot], sessions: [D200hSessionInfo],
        stateEvent: [String: Any]?, usageEvent: [String: Any]?
    ) -> Data {
        var manifest: [String: Any] = [:]
        var files: [(name: String, data: Data)] = []

        for (i, key) in keyDefs.enumerated() {
            let slot = slots[i]
            let iconPath = "icons/btn\(key.id).png"
            let colRow = "\(key.col)_\(key.row)"
            let png = renderButtonPng(slot)
            let label = slot.subtitle.isEmpty ? slot.title
                : (slot.title.isEmpty ? slot.subtitle : "\(slot.title)\n\(slot.subtitle)")
            manifest[colRow] = [
                "State": 0,
                "ViewParam": [["Text": label, "Icon": iconPath]],
            ] as [String: Any]
            files.append((iconPath, png))
        }

        // Small window: Usage visualization
        let pct5h = usageEvent?["fiveHourPercent"] as? Double ?? stateEvent?["fiveHourPercent"] as? Double ?? 0
        let pct7d = usageEvent?["sevenDayPercent"] as? Double ?? stateEvent?["sevenDayPercent"] as? Double ?? 0
        let usageText: String
        if pct5h >= 90 { usageText = "⚡5h:\(Int(pct5h))%" }
        else if pct5h > 0 || pct7d > 0 { usageText = "5h:\(Int(pct5h))% 7d:\(Int(pct7d))%" }
        else { usageText = "\(sessions.count) agents" }

        manifest["3_2"] = [
            "Action": "com.ulanzi.ulanzideck.smallwindow.window",
            "ActionParam": [:] as [String: Any],
            "State": 0,
            "ViewParam": [["Text": usageText]],
        ] as [String: Any]

        if let manifestData = try? JSONSerialization.data(withJSONObject: manifest) {
            files.append(("manifest.json", manifestData))
        }
        return buildValidatedZip(files)
    }

    /// Partial ZIP (only specified buttons) — used for animation frames
    static func renderPartialZip(slots: [ButtonSlot], buttonIds: [Int]) -> Data {
        var manifest: [String: Any] = [:]
        var files: [(name: String, data: Data)] = []

        for btnId in buttonIds {
            guard btnId < keyDefs.count, btnId < slots.count else { continue }
            let key = keyDefs[btnId]
            let slot = slots[btnId]
            let iconPath = "icons/btn\(key.id).png"
            let colRow = "\(key.col)_\(key.row)"
            let png = renderButtonPng(slot)
            let label = slot.subtitle.isEmpty ? slot.title
                : (slot.title.isEmpty ? slot.subtitle : "\(slot.title)\n\(slot.subtitle)")
            manifest[colRow] = [
                "State": 0,
                "ViewParam": [["Text": label, "Icon": iconPath]],
            ] as [String: Any]
            files.append((iconPath, png))
        }

        if let manifestData = try? JSONSerialization.data(withJSONObject: manifest) {
            files.append(("manifest.json", manifestData))
        }
        return buildValidatedZip(files)
    }

    private static func buildValidatedZip(_ files: [(name: String, data: Data)]) -> Data {
        for attempt in 0..<20 {
            var allFiles = files
            if attempt > 0 {
                let dummy = "AgentDeck " + UUID().uuidString + String(repeating: "x", count: attempt * 8)
                allFiles.append(("dummy.txt", Data(dummy.utf8)))
            }
            let zip = createZipInMemory(allFiles)
            if validateZipBoundaries(zip) { return zip }
        }
        return createZipInMemory(files)
    }
}

// MARK: - Color Helper

private func rgb(_ r: Int, _ g: Int, _ b: Int) -> CGColor {
    CGColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1.0)
}

// MARK: - SD+ Style Rich Button PNG Rendering

private func renderButtonPng(_ slot: ButtonSlot) -> Data {
    let size = ICON_SIZE  // 196
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil, width: size, height: size,
        bitsPerComponent: 8, bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { return Data() }

    let s = CGFloat(size)
    let pad: CGFloat = 4
    let cornerR: CGFloat = 16
    let innerRect = CGRect(x: pad, y: pad, width: s - pad * 2, height: s - pad * 2)
    let innerPath = CGPath(roundedRect: innerRect, cornerWidth: cornerR, cornerHeight: cornerR, transform: nil)

    // 1. Dark canvas background
    ctx.setFillColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

    // 2. Rounded rect button background (solid fill, no gradient — keeps PNG small)
    ctx.saveGState()
    ctx.addPath(innerPath)
    ctx.clip()
    ctx.setFillColor(slot.bg)
    ctx.fill(innerRect)
    ctx.restoreGState()

    // 3. Border animation
    switch slot.borderStyle {
    case .awaitingPulse(let color, let frame):
        let opacity = 0.3 + 0.65 * abs(sin(Double(frame) * 0.3))
        ctx.setStrokeColor(color)
        ctx.setAlpha(CGFloat(opacity))
        ctx.setLineWidth(5)
        ctx.addPath(innerPath)
        ctx.strokePath()
        ctx.setAlpha(1.0)

    case .processingDash(let color, let frame):
        let perim = 2 * (s - pad * 2) + 2 * (s - pad * 2)
        let offset = CGFloat((frame * 25) % Int(perim))
        ctx.setStrokeColor(color)
        ctx.setAlpha(0.75)
        ctx.setLineWidth(3)
        ctx.setLineDash(phase: offset, lengths: [50, 70])
        ctx.addPath(innerPath)
        ctx.strokePath()
        ctx.setAlpha(1.0)
        ctx.setLineDash(phase: 0, lengths: [])

    case .solid(let color):
        ctx.setStrokeColor(color)
        ctx.setAlpha(0.6)
        ctx.setLineWidth(2)
        ctx.addPath(innerPath)
        ctx.strokePath()
        ctx.setAlpha(1.0)

    case .none:
        break
    }

    // 4. Active indicator bar (SD+ left blue bar)
    if slot.enabled {
        switch slot.borderStyle {
        case .awaitingPulse, .processingDash, .solid:
            ctx.setFillColor(rgb(59, 130, 246))  // #3b82f6
            ctx.setAlpha(0.8)
            ctx.fill(CGRect(x: pad + 1, y: pad + 24, width: 5, height: s - pad * 2 - 48))
            ctx.setAlpha(1.0)
        case .none: break
        }
    }

    // Text via device native renderer (manifest Text field) — CoreText PNGs too large for D200H

    // 6. Status dot indicator (top-left corner for session buttons)
    if slot.enabled {
        let dotR: CGFloat = 5
        let dotX: CGFloat = pad + 12
        let dotY: CGFloat = s - pad - 16
        switch slot.borderStyle {
        case .awaitingPulse(let color, _), .processingDash(let color, _):
            ctx.setFillColor(color)
            ctx.fillEllipse(in: CGRect(x: dotX - dotR, y: dotY - dotR, width: dotR * 2, height: dotR * 2))
        case .solid, .none: break
        }
    }

    guard let image = ctx.makeImage() else { return Data() }

    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, UTType.png.identifier as CFString, 1, nil) else { return Data() }
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)

    // Debug: save first non-empty button PNG to /tmp for inspection
    if !slot.title.isEmpty {
        struct DebugOnce { nonisolated(unsafe) static var saved = false }
        if !DebugOnce.saved {
            DebugOnce.saved = true
            try? (data as Data).write(to: URL(fileURLWithPath: "/tmp/d200h_app_button.png"))
        }
    }

    return data as Data
}

// MARK: - ZIP Creation (in-memory, Store compression)

private func createZipInMemory(_ files: [(name: String, data: Data)]) -> Data {
    var localParts = Data()
    var centralDir = Data()
    var offset: UInt32 = 0

    for (name, fileData) in files {
        let nameBytes = Data(name.utf8)
        let crc = crc32(fileData)

        // Local file header (30 + name length)
        var local = Data(count: 30 + nameBytes.count)
        local.writeUInt32LE(0x04034b50, at: 0)  // signature
        local.writeUInt16LE(20, at: 4)            // version needed
        local.writeUInt16LE(0, at: 6)             // flags
        local.writeUInt16LE(0, at: 8)             // compression: store
        local.writeUInt16LE(0, at: 10)            // mod time
        local.writeUInt16LE(0, at: 12)            // mod date
        local.writeUInt32LE(crc, at: 14)
        local.writeUInt32LE(UInt32(fileData.count), at: 18)  // compressed
        local.writeUInt32LE(UInt32(fileData.count), at: 22)  // uncompressed
        local.writeUInt16LE(UInt16(nameBytes.count), at: 26)
        local.writeUInt16LE(0, at: 28)            // extra field
        local.replaceSubrange(30..<(30 + nameBytes.count), with: nameBytes)

        // Central directory header (46 + name length)
        var central = Data(count: 46 + nameBytes.count)
        central.writeUInt32LE(0x02014b50, at: 0)
        central.writeUInt16LE(20, at: 4)
        central.writeUInt16LE(20, at: 6)
        central.writeUInt16LE(0, at: 8)
        central.writeUInt16LE(0, at: 10)
        central.writeUInt16LE(0, at: 12)
        central.writeUInt16LE(0, at: 14)
        central.writeUInt32LE(crc, at: 16)
        central.writeUInt32LE(UInt32(fileData.count), at: 20)
        central.writeUInt32LE(UInt32(fileData.count), at: 24)
        central.writeUInt16LE(UInt16(nameBytes.count), at: 28)
        central.writeUInt16LE(0, at: 30)
        central.writeUInt16LE(0, at: 32)
        central.writeUInt16LE(0, at: 34)
        central.writeUInt16LE(0, at: 36)
        central.writeUInt32LE(0, at: 38)
        central.writeUInt32LE(offset, at: 42)
        central.replaceSubrange(46..<(46 + nameBytes.count), with: nameBytes)

        localParts.append(local)
        localParts.append(fileData)
        centralDir.append(central)
        offset += UInt32(local.count + fileData.count)
    }

    // End of central directory
    var eocd = Data(count: 22)
    eocd.writeUInt32LE(0x06054b50, at: 0)
    eocd.writeUInt16LE(0, at: 4)
    eocd.writeUInt16LE(0, at: 6)
    eocd.writeUInt16LE(UInt16(files.count), at: 8)
    eocd.writeUInt16LE(UInt16(files.count), at: 10)
    eocd.writeUInt32LE(UInt32(centralDir.count), at: 12)
    eocd.writeUInt32LE(offset, at: 16)
    eocd.writeUInt16LE(0, at: 20)

    var result = localParts
    result.append(centralDir)
    result.append(eocd)
    return result
}

/// Validate ZIP boundary bytes (offsets 1016, 2040, 3064... must not be 0x00 or 0x7C)
private func validateZipBoundaries(_ data: Data) -> Bool {
    var i = 1016
    while i < data.count {
        let byte = data[i]
        if byte == 0x00 || byte == 0x7C { return false }
        i += PACKET_SIZE
    }
    return true
}

// MARK: - CRC32

private let crcTable: [UInt32] = {
    var table = [UInt32](repeating: 0, count: 256)
    for n in 0..<256 {
        var c = UInt32(n)
        for _ in 0..<8 {
            if c & 1 != 0 {
                c = 0xEDB88320 ^ (c >> 1)
            } else {
                c = c >> 1
            }
        }
        table[n] = c
    }
    return table
}()

private func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFFFFFF
    for byte in data {
        crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
    }
    return crc ^ 0xFFFFFFFF
}

// MARK: - Data Extensions (LE writes)

private extension Data {
    mutating func writeUInt16LE(_ value: UInt16, at offset: Int) {
        self[offset] = UInt8(value & 0xFF)
        self[offset + 1] = UInt8((value >> 8) & 0xFF)
    }

    mutating func writeUInt32LE(_ value: UInt32, at offset: Int) {
        self[offset] = UInt8(value & 0xFF)
        self[offset + 1] = UInt8((value >> 8) & 0xFF)
        self[offset + 2] = UInt8((value >> 16) & 0xFF)
        self[offset + 3] = UInt8((value >> 24) & 0xFF)
    }
}
#else
/// No-op stub for non-macOS targets so shared references remain resolvable in Xcode.
final class D200hHidModule {
    init() {}
}
#endif
