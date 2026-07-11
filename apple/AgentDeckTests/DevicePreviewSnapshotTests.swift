// DevicePreviewSnapshotTests.swift — render Device Preview views to PNGs.
//
// Opt-in visual QA harness: set AGENTDECK_PREVIEW_SNAPSHOT_DIR to a writable
// directory and run this test to get one PNG per device preview (a few state
// variants for the drift-prone ones). Used to eyeball firmware-fidelity after
// editing a preview or one of the hand-maintained SSOT ports — see
// memory: device-preview-firmware-fidelity-ports. Skips (cleanly) when the
// env var is absent so CI never produces artifacts.

import XCTest
import SwiftUI
@testable import AgentDeck

@MainActor
final class DevicePreviewSnapshotTests: XCTestCase {

    private var outputDir: URL?

    override func setUp() {
        super.setUp()
        // Sandbox note: the test host is the sandboxed app, so arbitrary paths
        // are not writable. Snapshots always land in the container's temp dir
        // (…/Data/tmp/agentdeck-previews); the env var only opts the run in.
        // Run via: TEST_RUNNER_AGENTDECK_PREVIEW_SNAPSHOTS=1 xcodebuild … test
        if ProcessInfo.processInfo.environment["AGENTDECK_PREVIEW_SNAPSHOTS"] != nil {
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("agentdeck-previews", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            outputDir = dir
            NSLog("[DevicePreviewSnapshotTests] writing snapshots to %@", dir.path)
        }
    }

    private func snapshot<V: View>(_ view: V, name: String, scale: CGFloat = 2) throws {
        guard let outputDir else {
            throw XCTSkip("AGENTDECK_PREVIEW_SNAPSHOTS not set — snapshot rendering skipped")
        }
        let renderer = ImageRenderer(content: view.background(Color.black))
        renderer.scale = scale
        guard let cgImage = renderer.cgImage else {
            XCTFail("ImageRenderer produced no image for \(name)")
            return
        }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            XCTFail("PNG encode failed for \(name)")
            return
        }
        try png.write(to: outputDir.appendingPathComponent("\(name).png"))
    }

    // Note: `AgentDeck.PreviewDevice` must be fully qualified — SwiftUI ships
    // its own `PreviewDevice` type that otherwise wins the name lookup here.
    private func selection(
        _ device: AgentDeck.PreviewDevice,
        agent: PixooPreviewAgent = .claudeCode,
        state: PixooPreviewState = .processing,
        sessions: Int = 2
    ) -> DevicePreviewSelection {
        DevicePreviewSelection(agent: agent, state: state, sessionCount: sessions, device: device, animationFrame: 12)
    }

    func testRenderDevicePreviewSnapshots() throws {
        // ESP32 boards — the recently re-ported ones get state variants.
        try snapshot(Esp32Ips10Preview(selection: selection(.esp32Ips10, sessions: 4)), name: "ips10-4sess")
        try snapshot(Esp32Ips10Preview(selection: selection(.esp32Ips10, agent: .codex, sessions: 1)), name: "ips10-codex-1sess")
        try snapshot(Esp32TtgoPreview(selection: selection(.esp32Ttgo, state: .awaitingPrompt, sessions: 1)), name: "ttgo-awaiting")
        try snapshot(Esp3286BoxPreview(selection: selection(.esp32_86box, sessions: 1)), name: "86box")
        try snapshot(Esp32RoundPreview(selection: selection(.esp32Round, sessions: 1)), name: "round-amoled")
        try snapshot(Esp3235LandscapePreview(selection: selection(.esp32_35Landscape, sessions: 1)), name: "ips35-landscape")

        // InkDeck — adaptive usage band (0/1/2 provider rows).
        try snapshot(InkDeckPreview(selection: selection(.inkDeck, sessions: 2)), name: "inkdeck-2sess")
        try snapshot(InkDeckPreview(selection: selection(.inkDeck, agent: .codex, sessions: 1)), name: "inkdeck-codex-only")
        try snapshot(InkDeckPreview(selection: selection(.inkDeck, state: .disconnected, sessions: 0)), name: "inkdeck-offline")

        // Stream Deck slot — RUNNING teal vs PERM amber split.
        try snapshot(StreamDeckPlusPreview(selection: selection(.streamDeckPlus, state: .processing, sessions: 1)), name: "sdplus-running")
        try snapshot(StreamDeckPlusPreview(selection: selection(.streamDeckPlus, state: .awaitingPrompt, sessions: 1)), name: "sdplus-perm")
        try snapshot(StreamDeckPlusPreview(selection: selection(.streamDeckPlus, state: .idle, sessions: 1)), name: "sdplus-idle")

        // D200H deck — hide-if-absent usage tiles.
        try snapshot(D200HDeckPreview(selection: selection(.d200hDeck, agent: .codex, sessions: 1)), name: "d200h-codex-only")
        try snapshot(D200HDeckPreview(selection: selection(.d200hDeck, sessions: 2)), name: "d200h-2sess")
    }

    // MARK: - Live-follow mapping

    func testLiveSelectionInputsMapping() {
        var state = DashboardState()
        state.bridgeConnected = false
        let offline = DevicePreviewScreen.liveSelectionInputs(from: state)
        XCTAssertEqual(offline.state, .disconnected)
        XCTAssertEqual(offline.sessionCount, 0)

        state.bridgeConnected = true
        state.agentType = "codex-cli"
        state.state = .idle
        state.siblingSessions = [
            SessionInfo(id: "a", port: 9121, projectName: "p1", agentType: "codex-cli", alive: true, state: "processing"),
            SessionInfo(id: "b", port: 9122, projectName: "p2", agentType: "claude-code", alive: true, state: "awaiting_permission"),
            SessionInfo(id: "c", port: 9123, projectName: "p3", agentType: "claude-code", alive: false, state: "idle"),
        ]
        let mixed = DevicePreviewScreen.liveSelectionInputs(from: state)
        XCTAssertEqual(mixed.agent, .codex)
        // Awaiting wins over processing — attention beats motion.
        XCTAssertEqual(mixed.state, .awaitingPrompt)
        // Dead session excluded → 2 alive.
        XCTAssertEqual(mixed.sessionCount, 2)

        // 3 alive clamps down to the 2-bucket; 5 alive clamps to 4.
        state.siblingSessions = (0..<3).map {
            SessionInfo(id: "s\($0)", port: 9121 + $0, projectName: "p", agentType: "claude-code", alive: true, state: "idle")
        }
        XCTAssertEqual(DevicePreviewScreen.liveSelectionInputs(from: state).sessionCount, 2)
        state.siblingSessions = (0..<5).map {
            SessionInfo(id: "s\($0)", port: 9121 + $0, projectName: "p", agentType: "claude-code", alive: true, state: "idle")
        }
        XCTAssertEqual(DevicePreviewScreen.liveSelectionInputs(from: state).sessionCount, 4)
    }
}
