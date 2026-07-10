#if os(macOS)
// TimeboxBLE.swift — Native CoreBluetooth transport for the Divoom Timebox Mini (BLE variant).
//
// Some Timebox Mini revisions expose the 11×11 LED screen over BLE GATT using an ISSC
// transparent-UART service, NOT Bluetooth Classic SPP. The peripheral advertises as
// "TimeBox-mini-light" and shares its BD_ADDR with the Classic audio endpoint
// "TimeBox-mini-audio". This driver tunnels the SAME Divoom static-image packet that
// the Node CLI's sync_ble.py (bleak) sends — built here by TimeboxDivoomPacket — through
// write-without-response GATT writes, so the App Store macOS build needs NO subprocess
// and NO bundled interpreter (App Review 2.5.2). CoreBluetooth is gated by
// `com.apple.security.device.bluetooth` + NSBluetoothAlwaysUsageDescription.
//
// Structure mirrors IDotMatrixBLE (same queue-confined central, timeout-wrapped awaits,
// write-without-response flow control). Differences: the ISSC transparent-UART UUIDs,
// fixed 20-byte ATT chunks (matching sync_ble.py CHUNK_SIZE), and no mode/brightness
// commands — Timebox brightness is applied in software during encoding.

import Foundation
@preconcurrency import CoreBluetooth

enum TimeboxBLEError: Error, CustomStringConvertible {
    case bluetoothUnavailable(String)
    case connectTimeout
    case writeTimeout
    case notConnected
    case characteristicMissing
    case peripheralNotFound

    var description: String {
        switch self {
        case .bluetoothUnavailable(let s): return "Bluetooth unavailable: \(s)"
        case .connectTimeout: return "BLE connect timed out"
        case .writeTimeout: return "BLE write timed out"
        case .notConnected: return "Timebox not connected"
        case .characteristicMissing: return "Timebox write characteristic not found"
        case .peripheralNotFound: return "Timebox peripheral not found"
        }
    }
}

struct TimeboxDiscovered: Sendable, Equatable {
    let id: UUID
    let name: String
}

/// CoreBluetooth central confined to a private serial queue; all mutable state is
/// touched only on `queue`, so the type is `@unchecked Sendable`.
final class TimeboxBLE: NSObject, @unchecked Sendable {
    // ISSC transparent-UART service + TX characteristic (discovered on Timebox Mini BLE).
    static let serviceUUID = CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455")
    static let writeCharUUID = CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3")
    /// Advertised name substring (lowercased) of the LED screen endpoint.
    static let nameMatch = "timebox-mini-light"
    /// Safe ATT payload for write-without-response (matches sync_ble.py CHUNK_SIZE).
    static let chunkSize = 20

    private let queue = DispatchQueue(label: "dev.agentdeck.timebox.ble")
    private var central: CBCentralManager!

    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?

    // Every continuation below MUST also resume on task cancellation: `withTimeout`
    // runs work + timer in a task group, and the group cannot return — even after
    // the timer child throws — until the work child finishes. A continuation that
    // only a CB delegate callback can resume turns "timeout" into a permanent hang
    // when that callback never arrives (Bluetooth permission undecided, device
    // powered off mid-connect). The *CancelPending flags close the race where
    // onCancel fires before the queue-confined registration block has run.
    private var stateContinuations: [UUID: CheckedContinuation<Void, Error>] = [:]
    private var cancelledStateWaiters: Set<UUID> = []
    private var connectContinuation: CheckedContinuation<Void, Error>?
    private var connectCancelPending = false
    private var writeReadyContinuation: CheckedContinuation<Void, Error>?
    private var writeReadyCancelPending = false

    private var scanResults: [UUID: String] = [:]
    private var scanContinuation: CheckedContinuation<[TimeboxDiscovered], Never>?

    private let connectTimeoutSec: TimeInterval = 10
    private let writeTimeoutSec: TimeInterval = 6

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: queue,
                                   options: [CBCentralManagerOptionShowPowerAlertKey: false])
        DaemonLogger.shared.debug("TimeboxBLE", "central created — authorization=\(Self.describeAuthorization())")
    }

    static func describeAuthorization() -> String {
        switch CBManager.authorization {
        case .allowedAlways: return "allowedAlways"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown(\(CBManager.authorization.rawValue))"
        }
    }

    static func describeState(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .resetting: return "resetting"
        case .unknown: return "unknown"
        @unknown default: return "raw(\(state.rawValue))"
        }
    }

    // MARK: - Public async API

    func waitUntilReady(timeout: TimeInterval = 5) async throws {
        try await withTimeout(timeout, onTimeout: { .bluetoothUnavailable("powered-on wait timed out") }) {
            let waiterId = UUID()
            defer { self.queue.async { _ = self.cancelledStateWaiters.remove(waiterId) } }
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                    self.queue.async {
                        if self.cancelledStateWaiters.remove(waiterId) != nil {
                            cont.resume(throwing: CancellationError())
                            return
                        }
                        switch self.central.state {
                        case .poweredOn: cont.resume()
                        case .poweredOff: cont.resume(throwing: TimeboxBLEError.bluetoothUnavailable("powered off"))
                        case .unauthorized: cont.resume(throwing: TimeboxBLEError.bluetoothUnavailable("unauthorized"))
                        case .unsupported: cont.resume(throwing: TimeboxBLEError.bluetoothUnavailable("unsupported"))
                        default: self.stateContinuations[waiterId] = cont
                        }
                    }
                }
            } onCancel: {
                self.queue.async {
                    if let cont = self.stateContinuations.removeValue(forKey: waiterId) {
                        cont.resume(throwing: CancellationError())
                    } else {
                        self.cancelledStateWaiters.insert(waiterId)
                    }
                }
            }
        }
    }

    /// Scan for TimeBox-mini-light peripherals for `duration` seconds.
    func scan(duration: TimeInterval = 4) async -> [TimeboxDiscovered] {
        try? await waitUntilReady()
        return await withCheckedContinuation { (cont: CheckedContinuation<[TimeboxDiscovered], Never>) in
            queue.async {
                self.scanResults.removeAll()
                self.scanContinuation = cont
                guard self.central.state == .poweredOn else {
                    self.scanContinuation = nil
                    cont.resume(returning: [])
                    return
                }
                self.central.scanForPeripherals(withServices: nil,
                                                options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
                self.queue.asyncAfter(deadline: .now() + duration) { self.finishScan() }
            }
        }
    }

    private func finishScan() {
        guard let cont = scanContinuation else { return }
        scanContinuation = nil
        if central.state == .poweredOn { central.stopScan() }
        let results = scanResults.map { TimeboxDiscovered(id: $0.key, name: $0.value) }
            .sorted { $0.name < $1.name }
        cont.resume(returning: results)
    }

    /// Connect by CBPeripheral.identifier (UUID string in settings), discover the
    /// transparent-UART service/characteristic, and leave the device ready for writes.
    func connect(uuidString: String) async throws {
        guard let uuid = UUID(uuidString: uuidString) else { throw TimeboxBLEError.peripheralNotFound }
        try await waitUntilReady()
        let target = try await resolvePeripheral(uuid: uuid)

        try await withTimeout(connectTimeoutSec, onTimeout: { .connectTimeout }) {
            defer { self.queue.async { self.connectCancelPending = false } }
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                    self.queue.async {
                        if self.connectCancelPending {
                            self.connectCancelPending = false
                            cont.resume(throwing: CancellationError())
                            return
                        }
                        self.peripheral = target
                        target.delegate = self
                        self.writeChar = nil
                        self.connectContinuation = cont
                        self.central.connect(target, options: nil)
                    }
                }
            } onCancel: {
                self.queue.async {
                    if let cont = self.connectContinuation {
                        self.connectContinuation = nil
                        // CB connect attempts never expire on their own — cancel the
                        // pending attempt so it can't complete into a stale delegate.
                        self.central.cancelPeripheralConnection(target)
                        cont.resume(throwing: CancellationError())
                    } else {
                        self.connectCancelPending = true
                    }
                }
            }
        }
    }

    private func resolvePeripheral(uuid: UUID) async throws -> CBPeripheral {
        if let known: CBPeripheral = await withCheckedContinuation({ (cont: CheckedContinuation<CBPeripheral?, Never>) in
            queue.async { cont.resume(returning: self.central.retrievePeripherals(withIdentifiers: [uuid]).first) }
        }) {
            return known
        }
        _ = await scan(duration: 5)
        let again: CBPeripheral? = await withCheckedContinuation { (cont: CheckedContinuation<CBPeripheral?, Never>) in
            queue.async { cont.resume(returning: self.central.retrievePeripherals(withIdentifiers: [uuid]).first) }
        }
        guard let p = again else { throw TimeboxBLEError.peripheralNotFound }
        return p
    }

    func disconnect() async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            queue.async {
                if let p = self.peripheral { self.central.cancelPeripheralConnection(p) }
                self.peripheral = nil
                self.writeChar = nil
                cont.resume()
            }
        }
    }

    var isConnected: Bool {
        queue.sync { peripheral?.state == .connected && writeChar != nil }
    }

    // MARK: - Image upload

    /// Send an 11×11 RGB frame: build the Divoom static-image packet and write it
    /// to the transparent-UART TX characteristic in 20-byte chunks.
    func uploadFrame(rgb11x11: [UInt8]) async throws {
        try await writeRaw(Data(TimeboxDivoomPacket.packet(fromRGB: rgb11x11)))
    }

    private func writeRaw(_ data: Data) async throws {
        try await withTimeout(writeTimeoutSec, onTimeout: { .writeTimeout }) {
            defer { self.queue.async { self.writeReadyCancelPending = false } }
            let (p, ch): (CBPeripheral, CBCharacteristic) = try await withCheckedThrowingContinuation { cont in
                self.queue.async {
                    guard let p = self.peripheral, p.state == .connected else {
                        cont.resume(throwing: TimeboxBLEError.notConnected); return
                    }
                    guard let ch = self.writeChar else {
                        cont.resume(throwing: TimeboxBLEError.characteristicMissing); return
                    }
                    cont.resume(returning: (p, ch))
                }
            }

            // Fixed 20-byte chunks (sync_ble.py CHUNK_SIZE); never exceed the link MTU.
            let mtu = max(20, p.maximumWriteValueLength(for: .withoutResponse))
            let chunk = min(Self.chunkSize, mtu)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunk, data.count)
                try await self.writeChunk(data.subdata(in: offset..<end), to: p, characteristic: ch)
                offset = end
            }
        }
    }

    private func writeChunk(_ slice: Data, to p: CBPeripheral, characteristic ch: CBCharacteristic) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                self.queue.async {
                    if self.writeReadyCancelPending {
                        self.writeReadyCancelPending = false
                        cont.resume(throwing: CancellationError())
                        return
                    }
                    if p.canSendWriteWithoutResponse {
                        cont.resume()
                    } else {
                        self.writeReadyContinuation = cont
                    }
                }
            }
        } onCancel: {
            self.queue.async {
                if let cont = self.writeReadyContinuation {
                    self.writeReadyContinuation = nil
                    cont.resume(throwing: CancellationError())
                } else {
                    self.writeReadyCancelPending = true
                }
            }
        }
        queue.async { p.writeValue(slice, for: ch, type: .withoutResponse) }
    }

    // MARK: - Timeout helper (OpenClawAdapter pattern)

    private func withTimeout<T: Sendable>(
        _ seconds: TimeInterval,
        onTimeout: @escaping @Sendable () -> TimeboxBLEError,
        _ work: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await work() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw onTimeout()
            }
            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension TimeboxBLE: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        DaemonLogger.shared.debug("TimeboxBLE", "central state → \(Self.describeState(central.state)) (auth=\(Self.describeAuthorization()))")
        let waiters = stateContinuations
        stateContinuations.removeAll()
        switch central.state {
        case .poweredOn: waiters.values.forEach { $0.resume() }
        case .poweredOff: waiters.values.forEach { $0.resume(throwing: TimeboxBLEError.bluetoothUnavailable("powered off")) }
        case .unauthorized: waiters.values.forEach { $0.resume(throwing: TimeboxBLEError.bluetoothUnavailable("unauthorized")) }
        case .unsupported: waiters.values.forEach { $0.resume(throwing: TimeboxBLEError.bluetoothUnavailable("unsupported")) }
        default: stateContinuations = waiters
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
        guard advName.lowercased().contains(Self.nameMatch) else { return }
        scanResults[peripheral.identifier] = advName
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        failConnect(TimeboxBLEError.connectTimeout)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if peripheral.identifier == self.peripheral?.identifier {
            writeChar = nil
            failConnect(TimeboxBLEError.connectTimeout)
        }
    }

    private func failConnect(_ error: Error) {
        guard let cont = connectContinuation else { return }
        connectContinuation = nil
        cont.resume(throwing: error)
    }

    private func completeConnect() {
        guard let cont = connectContinuation else { return }
        connectContinuation = nil
        cont.resume()
    }
}

// MARK: - CBPeripheralDelegate

extension TimeboxBLE: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if error != nil { failConnect(TimeboxBLEError.connectTimeout); return }
        guard let svc = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            failConnect(TimeboxBLEError.characteristicMissing); return
        }
        peripheral.discoverCharacteristics([Self.writeCharUUID], for: svc)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if error != nil { failConnect(TimeboxBLEError.connectTimeout); return }
        guard let ch = service.characteristics?.first(where: { $0.uuid == Self.writeCharUUID }) else {
            failConnect(TimeboxBLEError.characteristicMissing); return
        }
        writeChar = ch
        completeConnect()
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard let cont = writeReadyContinuation else { return }
        writeReadyContinuation = nil
        cont.resume()
    }
}
#endif
