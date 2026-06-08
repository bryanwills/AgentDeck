// BridgeEventParser.swift — JSON type discriminator for bridge messages

import Foundation

enum BridgeEventParser {
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    /// Parse raw JSON text into a typed BridgeEvent
    static func parse(_ text: String) -> BridgeEvent? {
        guard let data = text.data(using: .utf8) else { return nil }

        // Extract "type" field first
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return nil
        }

        // Use a lenient decoder that ignores unknown keys
        let lenient = JSONDecoder()
        lenient.keyDecodingStrategy = .convertFromSnakeCase

        do {
            switch type {
            case "state_update":
                var event = try lenient.decode(StateUpdateEvent.self, from: data)
                event.moduleHealth = parseModuleHealth(json["moduleHealth"] as? [String: Any] ?? json["module_health"] as? [String: Any])
                return .stateUpdate(event)
            case "usage_update":
                return .usageUpdate(try lenient.decode(UsageEvent.self, from: data))
            case "connection":
                return .connection(try lenient.decode(ConnectionEvent.self, from: data))
            case "voice_state":
                return .voiceState(try lenient.decode(VoiceStateEvent.self, from: data))
            case "display_state":
                return .displayState(try lenient.decode(DisplayStateEvent.self, from: data))
            case "sessions_list":
                return .sessionsList(try lenient.decode(SessionsListEvent.self, from: data))
            case "prompt_options":
                return .promptOptions(try lenient.decode(PromptOptionsEvent.self, from: data))
            case "button_state":
                return .buttonState(try lenient.decode(ButtonStateEvent.self, from: data))
            case "encoder_state":
                return .encoderState(try lenient.decode(EncoderStateEvent.self, from: data))
            case "deck_slot_map":
                return .deckSlotMap(try lenient.decode(DeckSlotMapEvent.self, from: data))
            case "user_prompt":
                return .userPrompt(try lenient.decode(UserPromptEvent.self, from: data))
            case "timeline_event":
                return .timelineEvent(try lenient.decode(TimelineEventMsg.self, from: data))
            case "timeline_history":
                return .timelineHistory(try lenient.decode(TimelineHistoryMsg.self, from: data))
            default:
                print("[BridgeEventParser] Unknown event type: \(type)")
                return nil
            }
        } catch {
            print("[BridgeEventParser] Decode error for \(type): \(error)")
            return nil
        }
    }

    // MARK: - Module Health Parser

    private static func parseModuleHealth(_ raw: [String: Any]?) -> ModuleHealthState? {
        guard let raw else { return nil }
        var health = ModuleHealthState()

        if let adb = raw["adb"] as? [String: Any] {
            var classified: [ClassifiedDevice] = []
            let arr = adb["classifiedDevices"] as? [[String: Any]] ?? adb["classified_devices"] as? [[String: Any]]
            if let arr {
                for entry in arr {
                    guard let serial = entry["serial"] as? String else { continue }
                    classified.append(ClassifiedDevice(
                        serial: serial,
                        manufacturer: entry["manufacturer"] as? String,
                        model: entry["model"] as? String,
                        deviceClass: (entry["class"] as? String) ?? "android.tablet"
                    ))
                }
            }
            health.adb = AdbHealth(
                available: adb["available"] as? Bool ?? false,
                devices: adb["devices"] as? [String] ?? [],
                classifiedDevices: classified,
                reverseReadyCount: adb["reverseReadyCount"] as? Int ?? adb["reverse_ready_count"] as? Int ?? 0,
                lastError: adb["lastError"] as? String ?? adb["last_error"] as? String
            )
        }

        if let d200h = raw["d200h"] as? [String: Any] {
            health.d200h = D200hHealth(
                connected: d200h["connected"] as? Bool ?? false,
                managerOpened: d200h["managerOpened"] as? Bool ?? d200h["manager_opened"] as? Bool ?? false,
                sandboxEnabled: d200h["sandboxEnabled"] as? Bool ?? d200h["sandbox_enabled"] as? Bool ?? false,
                usbEntitlementPresent: d200h["usbEntitlementPresent"] as? Bool ?? d200h["usb_entitlement_present"] as? Bool ?? false,
                buttonPressCount: d200h["buttonPressCount"] as? Int ?? d200h["button_press_count"] as? Int ?? 0,
                hidReportCount: d200h["hidReportCount"] as? Int ?? d200h["hid_report_count"] as? Int ?? 0,
                writeOK: d200h["writeOK"] as? Int ?? d200h["write_ok"] as? Int ?? 0,
                writeFail: d200h["writeFail"] as? Int ?? d200h["write_fail"] as? Int ?? 0,
                lastWriteError: d200h["lastWriteError"] as? String ?? d200h["last_write_error"] as? String,
                lastOpenError: d200h["lastOpenError"] as? String ?? d200h["last_open_error"] as? String
            )
        }

        if let pixoo = raw["pixoo"] as? [String: Any] {
            var pixooDevices: [PixooDeviceHealth] = []
            let devArr = pixoo["devices"] as? [[String: Any]]
            if let devArr {
                for dev in devArr {
                    pixooDevices.append(PixooDeviceHealth(
                        ip: dev["ip"] as? String ?? "",
                        online: dev["online"] as? Bool ?? false,
                        failures: dev["failures"] as? Int ?? 0,
                        backedOff: dev["backedOff"] as? Bool ?? dev["backed_off"] as? Bool ?? false
                    ))
                }
            }
            health.pixoo = PixooHealth(
                configuredDeviceCount: pixoo["configuredDeviceCount"] as? Int ?? pixoo["configured_device_count"] as? Int ?? 0,
                deviceIps: pixoo["deviceIps"] as? [String] ?? pixoo["device_ips"] as? [String] ?? [],
                hasFrame: pixoo["hasFrame"] as? Bool ?? pixoo["has_frame"] as? Bool ?? false,
                displayDimmed: pixoo["displayDimmed"] as? Bool ?? pixoo["display_dimmed"] as? Bool ?? false,
                lastPushError: pixoo["lastPushError"] as? String ?? pixoo["last_push_error"] as? String,
                devices: pixooDevices
            )
        }

        if let sd = raw["streamDeck"] as? [String: Any] ?? raw["stream_deck"] as? [String: Any] {
            var sdDevices: [StreamDeckDeviceInfo] = []
            let arr = sd["devices"] as? [[String: Any]]
            if let arr {
                for d in arr {
                    sdDevices.append(StreamDeckDeviceInfo(
                        id: d["id"] as? String ?? "",
                        name: d["name"] as? String ?? "",
                        family: d["family"] as? String,
                        columns: d["columns"] as? Int,
                        rows: d["rows"] as? Int
                    ))
                }
            }
            health.streamDeck = StreamDeckHealth(devices: sdDevices)
        }

        if let serial = raw["serial"] as? [String: Any] {
            var boards: [SerialPortInfo] = []
            var ports: [String] = []
            let connections = serial["connections"] as? [[String: Any]]
            if let connections {
                for conn in connections {
                    guard conn["connected"] as? Bool == true,
                          let port = conn["port"] as? String else { continue }
                    let info = conn["deviceInfo"] as? [String: Any] ?? conn["device_info"] as? [String: Any]
                    boards.append(SerialPortInfo(
                        port: port,
                        board: info?["board"] as? String,
                        firmwareVersion: info?["version"] as? String ?? info?["firmwareVersion"] as? String
                    ))
                    ports.append(port)
                }
            }
            if ports.isEmpty {
                let legacy = serial["connectedPorts"] as? [String] ?? serial["connected_ports"] as? [String]
                if let legacy {
                    ports = legacy
                    boards = legacy.map { SerialPortInfo(port: $0, board: nil, firmwareVersion: nil) }
                }
            }
            health.serial = SerialHealth(
                connectedPorts: ports,
                connectedBoards: boards,
                lastError: serial["lastError"] as? String ?? serial["last_error"] as? String
            )
        }

        return health
    }
}
