// MatrixTerminalPreviews.swift — Ulanzi TC001/TC100 8×32 LED matrix + TUI terrarium.
//
// The matrix preview draws the Pixoo-style 64×64 frame from PixooPreview,
// then crops the top 8 rows and the middle 32 columns so the result has the
// correct 8×32 aspect. This reuses the real renderer pipeline for visual
// parity with the actual WS2812B hardware. Note: the production matrix code
// path lives in the bridge/ESP32 firmware — this is a *visual approximation*
// sufficient for the "what does it look like" preview, not a driver test.
//
// The terminal preview uses TUITerrariumRenderer directly.

import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - Pixoo 64

struct Pixoo64Preview: View {
    let selection: DevicePreviewSelection
    #if os(macOS)
    @EnvironmentObject private var daemonService: DaemonService
    #endif

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 16, bezelWidth: 12, bezelColor: Color(white: 0.12)) {
                let config = PixooPreviewConfig(
                    agent: selection.agent,
                    state: selection.state,
                    sessionCount: selection.sessionCount,
                    fiveHourPercent: nil,
                    gatewayAvailable: false
                )
                #if os(macOS)
                PixooDeviceFrameView(config: config, port: daemonService.port)
                    .frame(width: 320, height: 320)
                #else
                PixooStaticFrameView(config: config)
                    .frame(width: 320, height: 320)
                #endif
            }
            .frame(width: 380, height: 380)
            
            Text("Pixoo 64 • 64×64 LED Matrix")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

private struct PixooStaticFrameView: View {
    let config: PixooPreviewConfig

    var body: some View {
        PixooPreview.previewImage(config)
            .resizable()
            .interpolation(.none)
            .aspectRatio(1, contentMode: .fill)
            .cornerRadius(4)
            .overlay(PixooPixelGrid())
    }
}

#if os(macOS)
private struct PixooDeviceFrameView: View {
    let config: PixooPreviewConfig
    let port: UInt16

    @State private var frameImage: NSImage?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let frameImage {
                Image(nsImage: frameImage)
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(1, contentMode: .fill)
            } else {
                PixooPreview.previewImage(config)
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(1, contentMode: .fill)
            }

            Text(frameImage == nil ? "SIM" : "LIVE")
                .font(.system(size: 8, weight: .heavy, design: .monospaced))
                .foregroundStyle(.white.opacity(0.86))
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 4))
                .padding(5)
        }
        .cornerRadius(4)
        .overlay(PixooPixelGrid())
        .task(id: Int(port)) {
            await pollCurrentFrame()
        }
    }

    private func pollCurrentFrame() async {
        guard port > 0 else { return }
        while !Task.isCancelled {
            await refreshCurrentFrame()
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    private func refreshCurrentFrame() async {
        guard let url = URL(string: "http://127.0.0.1:\(port)/pixoo/frame?ts=\(Int(Date().timeIntervalSince1970 * 1000))") else {
            return
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 1.5

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard
                let http = response as? HTTPURLResponse,
                http.statusCode == 200,
                let image = NSImage(data: data)
            else {
                return
            }
            await MainActor.run {
                self.frameImage = image
            }
        } catch {
            // Keep the last good frame; if none exists, the simulated frame remains visible.
        }
    }
}
#endif

private struct PixooPixelGrid: View {
    var body: some View {
        GeometryReader { geo in
            Path { p in
                let stepXY = geo.size.width / 64
                for i in 0...64 {
                    let pos = CGFloat(i) * stepXY
                    p.move(to: CGPoint(x: pos, y: 0))
                    p.addLine(to: CGPoint(x: pos, y: geo.size.height))
                    p.move(to: CGPoint(x: 0, y: pos))
                    p.addLine(to: CGPoint(x: geo.size.width, y: pos))
                }
            }
            .stroke(Color.black.opacity(0.35), lineWidth: 0.3)
        }
    }
}

// MARK: - Ulanzi TC001 matrix
//
// Real firmware (esp32/src/ui/matrix/matrix_pages.cpp) rotates through
// pages: AGENTS (creature sprites), USAGE (horizontal battery gauges),
// and a disconnect breathing pulse. The preview reproduces the AGENTS
// page with the firmware's EXACT 5×6 sprite masks (SPR_OCTOPUS /
// SPR_JELLYFISH / SPR_OPENCODE / SPR_CRAYFISH + their *_ACC accent
// overlays) and its color model: body in the per-kind state color,
// accent as a lit detail (OpenCode's inner is a dim shadow). Static
// preview — no page cycling or text scroller.

struct UlanziMatrixPreview: View {
    let selection: DevicePreviewSelection

    // 8x32 WS2812B LED grid rendered as a CSS-style dot matrix. Pixel
    // size controls how big each LED appears in the preview; keep it
    // generous so the shape of the creature is legible.
    private let ledPixel: CGFloat = 10
    private let matrixW = 32
    private let matrixH = 8

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 10, bezelWidth: 8, bezelColor: Color(white: 0.12)) {
                GeometryReader { _ in
                    ZStack {
                        Color.black
                        Canvas { ctx, size in
                            drawMatrix(ctx: &ctx, size: size)
                        }
                        .padding(2)
                    }
                }
            }
            .frame(width: CGFloat(matrixW) * ledPixel + 28,
                   height: CGFloat(matrixH) * ledPixel + 28)
            Text("Ulanzi TC001 • 8×32 WS2812B")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("AGENTS page — one creature sprite per alive session; OpenClaw crayfish pins to the right edge. Firmware also rotates a USAGE page with 5h/7d bar gauges.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
    }

    // Draw the AGENTS page directly into a Canvas using one filled rect
    // per "lit" LED. Mirrors matrix_pages.cpp: agents left-to-right with
    // a 7px stride, crayfish at x=27 when OpenClaw is in the mix.
    private func drawMatrix(ctx: inout GraphicsContext, size: CGSize) {
        let cellW = size.width / CGFloat(matrixW)
        let cellH = size.height / CGFloat(matrixH)

        // Off-LED fill — very dim grey so the grid is visible without
        // drawing a separate overlay.
        let offColor = Color(red: 0.06, green: 0.06, blue: 0.08)
        for y in 0..<matrixH {
            for x in 0..<matrixW {
                let rect = CGRect(
                    x: CGFloat(x) * cellW + 1,
                    y: CGFloat(y) * cellH + 1,
                    width: cellW - 2,
                    height: cellH - 2
                )
                ctx.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(offColor))
            }
        }

        let agents = selection.previewAgents
        let hasOpenClaw = agents.contains(.openclaw)
        let crayfishX = 27
        let agentMaxX = hasOpenClaw ? crayfishX - 7 : matrixW - 7

        // Non-OpenClaw agents march left → right, 7px stride (5px sprite
        // + 2px gap), exactly like the firmware's agents area.
        var cursorX = 1
        for (index, agent) in agents.enumerated() where agent != .openclaw {
            guard cursorX <= agentMaxX else { break }
            let state = selection.previewState(for: index)
            drawSprite(
                ctx: &ctx, atX: cursorX, y: 1,
                body: Tc001Sprites.body(for: agent),
                accent: Tc001Sprites.accent(for: agent),
                bodyColor: Tc001Sprites.bodyColor(agent: agent, state: state, instanceIdx: index),
                accentColor: Tc001Sprites.accentColor(agent: agent, state: state),
                cellW: cellW, cellH: cellH
            )
            cursorX += 7
        }

        // OpenClaw crayfish pinned at the right edge — the firmware's
        // Gateway-presence signal.
        if hasOpenClaw {
            drawSprite(
                ctx: &ctx, atX: crayfishX, y: 1,
                body: Tc001Sprites.body(for: .openclaw),
                accent: Tc001Sprites.accent(for: .openclaw),
                bodyColor: Tc001Sprites.bodyColor(agent: .openclaw, state: selection.state, instanceIdx: 0),
                accentColor: Tc001Sprites.accentColor(agent: .openclaw, state: selection.state),
                cellW: cellW, cellH: cellH
            )
        }

        // Empty aquarium → idle breathing octopus, matching the firmware's
        // agentCount == 0 branch (dim terracotta, mid-breath).
        if agents.isEmpty {
            drawSprite(
                ctx: &ctx, atX: 8, y: 1,
                body: Tc001Sprites.body(for: .claudeCode),
                accent: Tc001Sprites.accent(for: .claudeCode),
                bodyColor: Color(red: 64 / 255, green: 38 / 255, blue: 29 / 255),
                accentColor: Color(red: 188 / 255, green: 120 / 255, blue: 88 / 255),
                cellW: cellW, cellH: cellH
            )
        }
    }

    private func drawSprite(
        ctx: inout GraphicsContext,
        atX x: Int, y: Int,
        body: [UInt8], accent: [UInt8],
        bodyColor: Color, accentColor: Color,
        cellW: CGFloat, cellH: CGFloat
    ) {
        for row in 0..<6 {
            for col in 0..<5 {
                let lit = (body[row] >> (4 - col)) & 1 == 1
                let acc = (accent[row] >> (4 - col)) & 1 == 1
                guard lit || acc else { continue }
                drawLED(ctx: &ctx, x: x + col, y: y + row,
                        color: acc ? accentColor : bodyColor,
                        cellW: cellW, cellH: cellH)
            }
        }
    }

    private func drawLED(
        ctx: inout GraphicsContext,
        x: Int, y: Int,
        color: Color,
        cellW: CGFloat, cellH: CGFloat
    ) {
        guard x >= 0, x < matrixW, y >= 0, y < matrixH else { return }
        let rect = CGRect(
            x: CGFloat(x) * cellW + 1,
            y: CGFloat(y) * cellH + 1,
            width: cellW - 2,
            height: cellH - 2
        )
        // Slight glow to suggest an LED lens on top of an LED die.
        ctx.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(color.opacity(0.92)))
        ctx.fill(
            Path(ellipseIn: rect.insetBy(dx: rect.width * 0.18, dy: rect.height * 0.18)),
            with: .color(color)
        )
    }
}

/// Hand-maintained mirror of the TC001 firmware sprite tables + color model
/// (esp32/src/ui/matrix/matrix_pages.cpp `SPR_*` / `agentColor`). Update this
/// enum when the firmware sprites change.
private enum Tc001Sprites {
    // Body masks — exact firmware bit patterns.
    static func body(for agent: PixooPreviewAgent) -> [UInt8] {
        switch agent {
        case .claudeCode: // SPR_OCTOPUS
            return [0b01110, 0b11111, 0b10101, 0b11111, 0b01110, 0b10101]
        case .codex:      // SPR_JELLYFISH
            return [0b01110, 0b11111, 0b11111, 0b01110, 0b01010, 0b10001]
        case .opencode:   // SPR_OPENCODE — canonical rectangular ring
            return [0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111]
        case .openclaw:   // SPR_CRAYFISH
            return [0b10001, 0b01110, 0b11111, 0b01110, 0b00100, 0b01010]
        }
    }

    // Accent overlays — lit details (OpenCode's is a dim inner shadow).
    static func accent(for agent: PixooPreviewAgent) -> [UInt8] {
        switch agent {
        case .claudeCode: // brighter head highlight
            return [0b01110, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000]
        case .codex:      // ">_" prompt marking (light)
            return [0b00000, 0b00000, 0b00100, 0b00000, 0b00000, 0b00000]
        case .opencode:   // dim inner shadow fill
            return [0b00000, 0b01110, 0b01110, 0b01110, 0b01110, 0b00000]
        case .openclaw:   // teal eyes (OpenClaw signature)
            return [0b00000, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000]
        }
    }

    /// Firmware `agentColor` at mid-pulse: processing pulses the per-kind
    /// brand tone, awaiting pulses amber, idle is the dim brand tone.
    static func bodyColor(agent: PixooPreviewAgent, state: PixooPreviewState, instanceIdx: Int) -> Color {
        var rgb: (Double, Double, Double)
        switch state {
        case .processing:
            switch agent {
            case .codex:    rgb = (65, 65, 160)    // indigo, mid-pulse
            case .opencode: rgb = (140, 132, 132)  // warm light gray, mid-pulse
            default:        rgb = (125, 75, 56)    // terracotta, mid-pulse
            }
        case .awaitingPrompt:
            rgb = (130, 78, 0)                     // amber, mid-pulse
        case .idle:
            switch agent {
            case .codex:    rgb = (30, 30, 80)
            case .opencode: rgb = (72, 67, 67)
            default:        rgb = (80, 45, 35)
            }
        case .disconnected:
            rgb = (25, 25, 25)
        }
        // Firmware dims each additional instance of the same agent kind.
        if instanceIdx > 0 {
            let factor = Double(10 - min(instanceIdx, 4) * 2) / 10
            rgb = (rgb.0 * factor, rgb.1 * factor, rgb.2 * factor)
        }
        return Color(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255)
    }

    static func accentColor(agent: PixooPreviewAgent, state: PixooPreviewState) -> Color {
        switch agent {
        case .opencode:
            // Dim inner shadow — darker than the frame for depth.
            return Color(red: 30 / 255, green: 28 / 255, blue: 28 / 255)
        case .openclaw:
            // Teal eyes.
            return Color(red: 40 / 255, green: 170 / 255, blue: 160 / 255)
        case .codex:
            return Color(red: 200 / 255, green: 205 / 255, blue: 255 / 255)
        case .claudeCode:
            return Color(red: 235 / 255, green: 150 / 255, blue: 110 / 255)
        }
    }
}

// MARK: - Divoom Timebox Mini (11×11)
//
// Renders the EXACT native micro frame the Timebox module pushes over BLE:
// `PixooRenderer.renderMicro` composes the hand-authored 11×11 MicroGlyphs
// creature on its status field. The preview shows the same bytes on a
// dot-matrix grid — no separate drawing code to drift.

struct TimeboxMiniPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 18, bezelWidth: 18, bezelColor: Color(white: 0.16)) {
                let config = PixooPreviewConfig(
                    agent: selection.agent,
                    state: selection.state,
                    sessionCount: selection.sessionCount,
                    fiveHourPercent: nil,
                    gatewayAvailable: false
                )
                MatrixFrameView(cgImage: PixooPreview.previewMicroCGImage(config), gridSide: 11)
                    .frame(width: 286, height: 286)
            }
            .frame(width: 340, height: 340)
            Text("Divoom Timebox Mini • 11×11 BLE")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("Native micro-glyph frame — the same renderMicro output the daemon uploads to the panel.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
    }
}

// MARK: - iDotMatrix 32×32
//
// Renders the EXACT frame pipeline the iDotMatrix module ships over BLE:
// 64×64 PixooRenderer scene → box downscale to 32×32 → the same
// brightness/contrast boost. See PixooPreview.preview32RGB.

struct IDotMatrixPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 14, bezelWidth: 12, bezelColor: Color(white: 0.1)) {
                let config = PixooPreviewConfig(
                    agent: selection.agent,
                    state: selection.state,
                    sessionCount: selection.sessionCount,
                    fiveHourPercent: nil,
                    gatewayAvailable: selection.agent == .openclaw
                )
                MatrixFrameView(cgImage: PixooPreview.preview32CGImage(config), gridSide: 32)
                    .frame(width: 320, height: 320)
            }
            .frame(width: 370, height: 370)
            Text("iDotMatrix • 32×32 BLE LED")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("Downscaled 64×64 aquarium with the device's brightness boost — the exact BLE frame pipeline.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
    }
}

/// Shared LED-matrix frame presenter: nearest-neighbor image + pixel grid.
private struct MatrixFrameView: View {
    let cgImage: CGImage?
    let gridSide: Int

    var body: some View {
        ZStack {
            if let cgImage {
                Image(decorative: cgImage, scale: 1.0, orientation: .up)
                    .resizable()
                    .interpolation(.none)
                    .antialiased(false)
                    .aspectRatio(1, contentMode: .fit)
            } else {
                Color.black
            }
        }
        .overlay(matrixGrid)
        .cornerRadius(4)
    }

    private var matrixGrid: some View {
        GeometryReader { geo in
            Path { p in
                let step = geo.size.width / CGFloat(gridSide)
                for i in 0...gridSide {
                    let pos = CGFloat(i) * step
                    p.move(to: CGPoint(x: pos, y: 0))
                    p.addLine(to: CGPoint(x: pos, y: geo.size.height))
                    p.move(to: CGPoint(x: 0, y: pos))
                    p.addLine(to: CGPoint(x: geo.size.width, y: pos))
                }
            }
            .stroke(Color.black.opacity(0.35), lineWidth: 0.3)
        }
    }
}

// MARK: - Terminal Terrarium

struct TerminalTerrariumPreview: View {
    let selection: DevicePreviewSelection

    private var agentsAndStates: (agents: [String], states: [String]) {
        let count = max(selection.sessionCount, 1)
        let palette: [PixooPreviewAgent] = [selection.agent, .codex, .opencode, .openclaw]
        var agents: [String] = []
        var states: [String] = []
        for i in 0..<min(count, 4) {
            agents.append(palette[i % palette.count].rawValue)
            states.append(i == 0 ? selection.state.sessionStateStringForUI : "idle")
        }
        return (agents, states)
    }

    var body: some View {
        VStack(spacing: 10) {
            let (agents, states) = agentsAndStates
            let config = TerrariumPreviewConfig(
                agents: agents,
                states: states,
                animationFrame: selection.animationFrame,
                width: 60,
                height: 20
            )
            DeviceBezel(cornerRadius: 10, bezelWidth: 10, bezelColor: Color(white: 0.18), screenColor: .black) {
                TUITerrariumRenderer(config: config, cellWidth: 8, cellHeight: 16)
            }
            .frame(width: 540, height: 360)
            Text("Terminal • agentdeck dashboard")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
