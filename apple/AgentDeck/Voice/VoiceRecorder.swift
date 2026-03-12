// VoiceRecorder.swift — AVAudioEngine recording → WAV → HTTP POST
// Phase 5 full implementation, Phase 1 stub

import Foundation
import AVFoundation

@Observable
final class VoiceRecorder: @unchecked Sendable {
    enum State: Sendable {
        case idle
        case recording
        case transcribing
        case error(String)
    }

    private(set) var state: State = .idle
    private(set) var transcription: String?
    private(set) var recordingDuration: TimeInterval = 0

    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var tempFileURL: URL?
    private var startTime: Date?

    // MARK: - Record

    func startRecording() {
        // Phase 5: Full AVAudioEngine implementation
        state = .recording
        startTime = Date()
    }

    func stopRecording() -> URL? {
        guard case .recording = state else { return nil }

        recordingDuration = Date().timeIntervalSince(startTime ?? Date())
        state = .transcribing

        // Phase 5: Stop audio engine, return WAV file
        return tempFileURL
    }

    func cancel() {
        audioEngine?.stop()
        audioEngine = nil
        state = .idle
        transcription = nil
    }

    // MARK: - Transcribe

    func transcribe(fileURL: URL, bridgeHost: String, bridgePort: Int) async throws -> String {
        state = .transcribing

        let url = URL(string: "http://\(bridgeHost):\(bridgePort)/voice/transcribe")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Data(contentsOf: fileURL)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            state = .error(errorText)
            throw NSError(domain: "VoiceRecorder", code: -1, userInfo: [NSLocalizedDescriptionKey: errorText])
        }

        let text = String(data: data, encoding: .utf8) ?? ""
        transcription = text
        state = .idle
        return text
    }
}
