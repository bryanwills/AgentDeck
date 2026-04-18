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

// MARK: - Pixoo 64

struct Pixoo64Preview: View {
    let selection: DevicePreviewSelection

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
                PixooPreview.previewImage(config)
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(1, contentMode: .fill)
                    .frame(width: 320, height: 320)
                    .cornerRadius(4)
                    .overlay(
                        // Faint pixel grid to evoke the LED look
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
                    )
            }
            .frame(width: 380, height: 380)
            
            Text("Pixoo 64 • 64×64 LED Matrix")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("Renderer uses exact pixel-art coordinate generation.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Ulanzi matrix

struct UlanziMatrixPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 10, bezelWidth: 8, bezelColor: Color(white: 0.12)) {
                // Reuse the Pixoo renderer as the source of truth for how the
                // creature should look on a low-res LED surface, then crop a
                // wide strip out of the middle for the 8x32 aspect.
                let config = PixooPreviewConfig(
                    agent: selection.agent,
                    state: selection.state,
                    sessionCount: selection.sessionCount,
                    fiveHourPercent: nil,
                    gatewayAvailable: false
                )
                PixooPreview.previewImage(config)
                    .resizable()
                    .interpolation(.none)
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 320, height: 80)
                    .clipped()
                    .overlay(
                        // Faint pixel grid to evoke the LED look
                        GeometryReader { geo in
                            Path { p in
                                let stepX = geo.size.width / 32
                                let stepY = geo.size.height / 8
                                for i in 0...32 {
                                    let x = CGFloat(i) * stepX
                                    p.move(to: CGPoint(x: x, y: 0))
                                    p.addLine(to: CGPoint(x: x, y: geo.size.height))
                                }
                                for i in 0...8 {
                                    let y = CGFloat(i) * stepY
                                    p.move(to: CGPoint(x: 0, y: y))
                                    p.addLine(to: CGPoint(x: geo.size.width, y: y))
                                }
                            }
                            .stroke(Color.black.opacity(0.35), lineWidth: 0.5)
                        }
                    )
                    .cornerRadius(6)
            }
            .frame(width: 380, height: 120)
            Text("Ulanzi TC001/TC100 • 8×32 WS2812B")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("Matrix firmware renders on-device; this is a cropped Pixoo-renderer sample.")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
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
