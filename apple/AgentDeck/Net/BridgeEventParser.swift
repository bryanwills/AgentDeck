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

        do {
            switch type {
            case "state_update":
                return .stateUpdate(try lenient.decode(StateUpdateEvent.self, from: data))
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
}
