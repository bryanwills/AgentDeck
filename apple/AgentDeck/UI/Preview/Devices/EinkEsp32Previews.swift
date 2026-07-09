// EinkEsp32Previews.swift — E-ink readers + ESP32 display boards.
//
// E-ink previews deliberately use a cream/paper-white canvas with near-black
// creature outlines — this mirrors the CremaS / Kobo rendering pipeline which
// forces the drawable into 2-bit or 4-bit greyscale. The color e-ink variant
// (Pantone6) tints the creature with the agent brand because the device
// actually supports ~6 colours.
//
// ESP32 previews are all framed device bodies with a creature + HUD. The real
// firmware is LVGL + custom draw routines that we don't try to port here.

import SwiftUI

// MARK: - E-ink Mono

struct EinkMonoPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(
                cornerRadius: 14,
                bezelWidth: 16,
                bezelColor: Color(white: 0.85),
                screenColor: Color(red: 0.95, green: 0.94, blue: 0.90)
            ) {
                EinkScreenLayout(selection: selection, isColor: false)
            }
            .frame(width: 240, height: 320)
            Text("E-ink mono • CremaS / Kobo")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - E-ink Color (Pantone6)

struct EinkColorPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(
                cornerRadius: 14,
                bezelWidth: 16,
                bezelColor: Color(white: 0.88),
                screenColor: Color(red: 0.96, green: 0.95, blue: 0.88)
            ) {
                EinkScreenLayout(selection: selection, isColor: true)
            }
            .frame(width: 240, height: 320)
            Text("E-ink color • Pantone6")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

private struct EinkScreenLayout: View {
    let selection: DevicePreviewSelection
    let isColor: Bool

    var body: some View {
        ZStack {
            background
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("AgentDeck")
                        .font(.system(size: 11, weight: .semibold, design: .serif))
                    Spacer()
                    Text(isColor ? "PANTONE6" : "CREMAS")
                        .font(.system(size: 8, weight: .medium, design: .monospaced))
                        .opacity(0.55)
                }
                .foregroundStyle(.black.opacity(0.86))

                HStack(alignment: .top, spacing: 7) {
                    PreviewMiniSessionList(selection: selection, dark: false, compact: true)
                        .frame(width: 70, height: 112)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .center, spacing: 5) {
                            PreviewCreatureGlyph(
                                agent: selection.agent,
                                state: selection.state,
                                size: 54,
                                tintOverride: creatureTint
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(selection.agent.displayName)
                                    .font(.system(size: 13, weight: .bold, design: .serif))
                                    .foregroundStyle(creatureTint)
                                Text("STATE \(selection.state.displayName.uppercased())")
                                    .font(.system(size: 7, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(.black.opacity(0.58))
                                Text("\(selection.sessionCount) SESSION\(selection.sessionCount == 1 ? "" : "S")")
                                    .font(.system(size: 7, design: .monospaced))
                                    .foregroundStyle(.black.opacity(0.45))
                            }
                            Spacer(minLength: 0)
                        }
                        usageStrip
                    }
                }

                Divider()
                    .overlay(Color.black.opacity(0.28))

                PreviewTimelineMini(selection: selection, dark: false, compact: true)
                Spacer(minLength: 0)
            }
            .padding(9)
        }
    }

    private var background: some View {
        LinearGradient(
            colors: isColor
                ? [
                    Color(red: 0.82, green: 0.87, blue: 0.89),
                    Color(red: 0.92, green: 0.93, blue: 0.91),
                    Color(red: 0.96, green: 0.95, blue: 0.88),
                ]
                : [Color(white: 0.84), Color(white: 0.90), Color(white: 0.95)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var creatureTint: Color {
        isColor ? StateColors.brand(agent: selection.agent.rawValue) : .black.opacity(0.82)
    }

    private var usageStrip: some View {
        HStack(spacing: 4) {
            einkGauge("5h", fill: 0.42)
            einkGauge("7d", fill: 0.68)
        }
    }

    private func einkGauge(_ label: String, fill: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .stroke(Color.black.opacity(0.32), lineWidth: 0.8)
            RoundedRectangle(cornerRadius: 2)
                .fill((isColor ? TerrariumHUD.ledGreen : Color.black).opacity(isColor ? 0.55 : 0.18))
                .frame(width: 42 * fill)
            Text(label)
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundStyle(.black.opacity(0.62))
                .padding(.leading, 4)
        }
        .frame(width: 42, height: 12)
    }
}

// MARK: - ESP32 terrarium scene (shared across boards)
//
// Real ESP32 firmware renders a full terrarium (deepSea → shallowWater
// gradient, creatures swimming, kelp, particles) with a HUD bar at the
// bottom carrying the AgentDeck wordmark + session name on the left and
// 5h / 7d water-fill gauges on the right. See esp32/src/ui/widgets/
// hud_bar.cpp for the reference layout and esp32/src/ui/terrarium/* for
// the scene renderer. We don't port the LVGL renderer — instead we
// reproduce its visual signature (water gradient, subtle creature
// silhouette, HUD bar with gauges) so the preview reads as the same
// artifact the user will see on-device.

private struct Esp32TerrariumScene<Content: View>: View {
    let selection: DevicePreviewSelection
    let isRound: Bool
    let hudHeight: CGFloat
    @ViewBuilder let overlay: () -> Content

    init(
        selection: DevicePreviewSelection,
        isRound: Bool = false,
        hudHeight: CGFloat = 58,
        @ViewBuilder overlay: @escaping () -> Content = { EmptyView() }
    ) {
        self.selection = selection
        self.isRound = isRound
        self.hudHeight = hudHeight
        self.overlay = overlay
    }

    var body: some View {
        ZStack {
            // Water gradient background — the terrarium renderer's base layer.
            LinearGradient(
                colors: [TerrariumColors.deepSea, TerrariumColors.midWater, TerrariumColors.shallowWater],
                startPoint: .top,
                endPoint: .bottom
            )

            // Water surface highlight at y ≈ 14% — echoes the bright
            // caustic band the firmware draws just below the top edge.
            GeometryReader { geo in
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color.white.opacity(0.0), Color.white.opacity(0.05), Color.white.opacity(0.0)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: max(6, geo.size.height * 0.08))
                    .offset(y: geo.size.height * 0.12)
            }

            // Background swimming creature — small and off-center, so
            // it reads as "a creature is in the scene" instead of the
            // giant dashboard-style icon the old preview used.
            GeometryReader { geo in
                PreviewCreatureGlyph(
                    agent: selection.agent,
                    state: selection.state,
                    size: min(geo.size.width, geo.size.height) * 0.26
                )
                .position(
                    x: geo.size.width * 0.55,
                    y: geo.size.height * (isRound ? 0.46 : 0.40)
                )
            }

            // Bottom HUD bar — matches hud_bar.cpp layout direction.
            VStack {
                Spacer()
                Esp32HudBar(selection: selection, isRound: isRound)
                    .frame(height: hudHeight)
            }

            overlay()
        }
    }
}

/// Mini HUD bar that mirrors the real firmware's bottom panel: left
/// side carries the AgentDeck wordmark + accent underline + session
/// line; right side carries two water-fill gauges (5h / 7d). Values are
/// placeholders — the real firmware drives them from the usage relay.
private struct Esp32HudBar: View {
    let selection: DevicePreviewSelection
    let isRound: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Left panel: logo + underline + session line
            VStack(alignment: .leading, spacing: 3) {
                Text("AgentDeck")
                    .font(.system(size: 11, weight: .heavy, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.text)
                Rectangle()
                    .fill(TerrariumColors.tetraNeon.opacity(0.55))
                    .frame(width: 46, height: 1)
                HStack(spacing: 4) {
                    PreviewStateDot(state: selection.state, size: 6)
                    Text(sessionLine)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.text.opacity(0.88))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: 4)

            // Right panel: 5h + 7d water-fill gauges
            HStack(spacing: 6) {
                waterGauge(period: "5h", percent: 0.42)
                waterGauge(period: "7d", percent: 0.68)
            }
        }
        .padding(.horizontal, isRound ? 30 : 10)
        .padding(.vertical, 6)
        .background(
            Rectangle()
                .fill(Color.black.opacity(isRound ? 0.0 : 0.35))
        )
    }

    private var sessionLine: String {
        let base = selection.sessionCount == 1 ? "1 session" : "\(selection.sessionCount) sessions"
        return "\(base) · \(selection.state.displayName)"
    }

    /// Water-fill gauge — mirrors the firmware's `createGauge`: glass
    /// background, bottom-aligned tinted fill, period label at top,
    /// percentage in the center.
    private func waterGauge(period: String, percent: CGFloat) -> some View {
        let size: CGFloat = 36
        let color = percent >= 0.9 ? TerrariumHUD.ledRed
            : percent >= 0.7 ? TerrariumHUD.ledAmber
            : TerrariumHUD.ledGreen
        return ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 5)
                .fill(Color.white.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .stroke(Color.white.opacity(0.22), lineWidth: 0.5)
                )
            RoundedRectangle(cornerRadius: 5)
                .fill(color.opacity(0.55))
                .frame(height: size * percent)
            VStack(spacing: 0) {
                Text(period)
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext)
                    .padding(.top, 3)
                Spacer(minLength: 0)
                Text("\(Int(percent * 100))%")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.text)
                    .padding(.bottom, 3)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - ESP32 86Box (1.28" round)

struct Esp3286BoxPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            Esp32TerrariumScene(
                selection: selection,
                isRound: true,
                hudHeight: 46
            )
            .frame(width: 240, height: 240)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .stroke(Color(white: 0.12), lineWidth: 6)
            )
            Text("ESP32 86Box • 1.28\" round")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ESP32 IPS 3.5" Landscape

struct Esp3235LandscapePreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 14, bezelWidth: 10) {
                Esp32TerrariumScene(selection: selection)
            }
            .frame(width: 400, height: 240)
            Text("ESP32 IPS 3.5\" landscape")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ESP32 IPS 3.5" Portrait

struct Esp3235PortraitPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 14, bezelWidth: 10) {
                Esp32TerrariumScene(selection: selection, hudHeight: 64)
            }
            .frame(width: 240, height: 360)
            Text("ESP32 IPS 3.5\" portrait")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ESP32 Round AMOLED 1.6"

struct Esp32RoundPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            Esp32TerrariumScene(
                selection: selection,
                isRound: true,
                hudHeight: 44
            )
            .frame(width: 230, height: 230)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .stroke(Color(white: 0.14), lineWidth: 10)
            )
            Text("ESP32 round AMOLED 1.6\"")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ESP32 TTGO T-Display 1.14" (135×240 portrait)
//
// The smallest LCD terrarium — same firmware scene as the other boards
// but on a narrow 135×240 portrait strip. Preview scales the panel
// 1.5× so the HUD text stays legible.

struct Esp32TtgoPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 12, bezelWidth: 12, bezelColor: Color(white: 0.10)) {
                Esp32TerrariumScene(selection: selection, hudHeight: 46)
            }
            .frame(width: 135 * 1.5, height: 240 * 1.5)
            Text("ESP32 TTGO T-Display • 135×240")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - ESP32 IPS 10.1" (JC8012P4A1C, logical 1280×800 landscape)
//
// The largest LVGL board — an ESP32-P4 with a 10.1" MIPI-DSI panel. The
// firmware renders a logical 1280×800 landscape scene (PPA hardware
// rotation into the physical 800×1280 portrait panel), so the preview
// is a wide landscape terrarium at 0.45× scale.

struct Esp32Ips10Preview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(cornerRadius: 16, bezelWidth: 12, bezelColor: Color(white: 0.08)) {
                Esp32TerrariumScene(selection: selection, hudHeight: 66)
            }
            .frame(width: 1280 * 0.45, height: 800 * 0.45)
            Text("ESP32 IPS 10.1\" • 1280×800 (P4 + PPA rotate)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
