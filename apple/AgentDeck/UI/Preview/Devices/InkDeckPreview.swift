// InkDeckPreview.swift — InkDeck 7.5" e-ink (Seeed TRMNL OG DIY Kit) preview.
//
// Hand-maintained mirror of the firmware dashboard layout in
// esp32/src/ui/eink/eink_display.cpp (drawDashboard): a print-style 1-bit
// 800×480 page with
//   - brand header: dome-over-deck mark + "AgentDeck" wordmark, a link
//     chip (filled when connected), session count, double rule at y≈62;
//   - session card grid: double-outline rounded cards with the agent
//     creature glyph + project name + state line; the first awaiting
//     card inverts to solid black with white ink;
//   - adaptive usage band (firmware 208b1afc): provider rows (CLAUDE /
//     CODEX, 5H/7D bar gauges) draw only for providers that actually
//     report usage; with 0 rows the separator rule is omitted and the
//     session grid reclaims the band. The ticker line at the very bottom
//     is pinned regardless.
// Update this view when the firmware layout changes.

import SwiftUI

struct InkDeckPreview: View {
    let selection: DevicePreviewSelection

    // 800×480 panel at 0.62× so the whole page fits the canvas.
    private let panelW: CGFloat = 800 * 0.62
    private let panelH: CGFloat = 480 * 0.62

    private let paper = Color(red: 0.96, green: 0.95, blue: 0.92)
    private let ink = Color.black.opacity(0.88)

    var body: some View {
        VStack(spacing: 10) {
            DeviceBezel(
                cornerRadius: 12,
                bezelWidth: 14,
                bezelColor: Color(white: 0.92),
                screenColor: paper
            ) {
                page
            }
            .frame(width: panelW + 28, height: panelH + 28)
            Text("InkDeck • 800×480 UC8179 e-ink (ESP32-S3)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Page

    private var page: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            sessionGrid
                .frame(maxHeight: .infinity)
            usageFooter
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }

    // MARK: Header — drawBrandHeader

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                AgentDeckLogo(size: 26, color: ink)
                Text("AgentDeck")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(ink)
                Spacer(minLength: 8)
                if selection.sessionCount > 0 {
                    Text("\(selection.sessionCount) session\(selection.sessionCount == 1 ? "" : "s")")
                        .font(.system(size: 9))
                        .foregroundStyle(ink.opacity(0.8))
                }
                linkChip
            }
            // Print-style double rule.
            Rectangle().fill(ink).frame(height: 1.6)
            Rectangle().fill(ink).frame(height: 0.6).padding(.top, 1.2)
        }
        .padding(.top, 2)
    }

    private var linkChip: some View {
        let connected = selection.state != .disconnected
        let label = connected ? "WIFI LINK" : "NO LINK"
        return Text(label)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(connected ? paper : ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(connected ? ink : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(ink, lineWidth: connected ? 0 : 1)
            )
    }

    // MARK: Session grid — drawSessionGrid / drawSessionCard

    private var sessionGrid: some View {
        let agents = selection.previewAgents
        let columns = agents.count <= 1 ? 1 : 2
        return Group {
            if agents.isEmpty {
                // Two distinct empty states, like the firmware: disconnected →
                // drawSearching ("searching for daemon…"); connected with no
                // sessions → drawSessionGrid's rowCount==0 branch ("no active
                // sessions" + workspace hint). Conflating them made a healthy
                // idle daemon read as broken.
                VStack(spacing: 8) {
                    AgentDeckLogo(size: 44, color: ink.opacity(0.7))
                    if selection.state == .disconnected {
                        Text("searching for daemon…")
                            .font(.system(size: 10))
                            .foregroundStyle(ink.opacity(0.6))
                    } else {
                        Text("no active sessions")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(ink.opacity(0.8))
                        Text("start claude / codex / opencode in a workspace")
                            .font(.system(size: 9))
                            .foregroundStyle(ink.opacity(0.55))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let rows = Array(agents.enumerated()).chunked(into: columns)
                VStack(spacing: 6) {
                    ForEach(rows, id: \.first!.offset) { rowEntries in
                        HStack(spacing: 6) {
                            ForEach(rowEntries, id: \.offset) { entry in
                                sessionCard(agent: entry.element, index: entry.offset)
                            }
                        }
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    private func sessionCard(agent: PixooPreviewAgent, index: Int) -> some View {
        let state = selection.previewState(for: index)
        let awaiting = state == .awaitingPrompt
        let cardInk = awaiting ? paper : ink
        return HStack(spacing: 8) {
            PreviewCreatureGlyph(
                agent: agent,
                state: state,
                size: 34,
                tintOverride: cardInk
            )
            VStack(alignment: .leading, spacing: 2) {
                Text("\(agent.displayName.lowercased())-project")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(cardInk)
                    .lineLimit(1)
                Text(Self.firmwareStateLabel(for: state))
                    .font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .foregroundStyle(cardInk.opacity(0.72))
                Text(activityLine(for: state))
                    .font(.system(size: 8))
                    .foregroundStyle(cardInk.opacity(0.6))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(awaiting ? ink : .clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(ink, lineWidth: awaiting ? 0 : 1.4)
        )
    }

    private func activityLine(for state: PixooPreviewState) -> String {
        switch state {
        case .idle:           return "last turn complete"
        case .processing:     return "editing files…"
        case .awaitingPrompt: return "permission requested"
        case .disconnected:   return "offline"
        }
    }

    /// Firmware card state labels (eink_display.cpp stateLabel): the panel
    /// prints PERMISSION / CHOOSE / REVIEW for the awaiting states — never
    /// "AWAITING" — and OFFLINE for anything unknown. The preview's coarse
    /// state model maps awaitingPrompt to the permission variant.
    static func firmwareStateLabel(for state: PixooPreviewState) -> String {
        switch state {
        case .processing:     return "PROCESSING"
        case .awaitingPrompt: return "PERMISSION"
        case .idle:           return "IDLE"
        case .disconnected:   return "OFFLINE"
        }
    }

    // MARK: Usage footer — drawUsageFooter (adaptive split, firmware 208b1afc)

    /// Sample providers that "report usage" for this preview frame. Mirrors the
    /// firmware's usageRowCount gate: a provider row draws only when its quota
    /// data exists. Offline daemon → no usage data at all; otherwise the row
    /// set follows the agents in the session mix (Claude-linked / Codex-linked).
    private var usageProviderRows: [(glyph: PixooPreviewAgent, label: String, plan: String, p5: Double, p7: Double)] {
        guard selection.state != .disconnected else { return [] }
        let agents = selection.previewAgents
        var rows: [(PixooPreviewAgent, String, String, Double, Double)] = []
        // No sessions ≠ no usage — a linked daemon still reports Claude quota.
        if agents.isEmpty || agents.contains(.claudeCode) {
            rows.append((.claudeCode, "CLAUDE", "Max 20x", 0.42, 0.68))
        }
        if agents.contains(.codex) {
            rows.append((.codex, "CODEX", "Plus", 0.23, 0.51))
        }
        return rows
    }

    private var usageFooter: some View {
        let rows = usageProviderRows
        return VStack(alignment: .leading, spacing: 4) {
            // 0 usage rows → no separator, no gauge band (sepY = -1 in the
            // firmware); the session grid above reclaims the space and only
            // the pinned ticker remains.
            if !rows.isEmpty {
                Rectangle().fill(ink).frame(height: 1.4)
                ForEach(rows, id: \.label) { row in
                    providerRow(glyphAgent: row.glyph, label: row.label, plan: row.plan, p5: row.p5, p7: row.p7)
                }
            }
            HStack(spacing: 5) {
                Text("14:02")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                Text(tickerText)
                    .font(.system(size: 8))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(ink.opacity(0.7))
        }
        .padding(.bottom, 2)
    }

    private var tickerText: String {
        switch selection.state {
        case .processing:     return "response streaming — usage gauge updated"
        case .awaitingPrompt: return "waiting for permission decision"
        case .idle:           return "turn complete · aquarium idle"
        case .disconnected:   return "daemon offline — reconnecting"
        }
    }

    private func providerRow(glyphAgent: PixooPreviewAgent, label: String, plan: String, p5: Double, p7: Double) -> some View {
        HStack(spacing: 6) {
            PreviewCreatureGlyph(agent: glyphAgent, state: .idle, size: 13, tintOverride: ink)
            VStack(alignment: .leading, spacing: 0) {
                Text(label)
                    .font(.system(size: 8, weight: .bold))
                Text(plan)
                    .font(.system(size: 6.5, design: .monospaced))
                    .foregroundStyle(ink.opacity(0.6))
            }
            .foregroundStyle(ink)
            .frame(width: 52, alignment: .leading)
            gaugeBar(tag: "5H", pct: p5)
            gaugeBar(tag: "7D", pct: p7)
            Spacer(minLength: 0)
        }
    }

    private func gaugeBar(tag: String, pct: Double) -> some View {
        HStack(spacing: 4) {
            Text(tag)
                .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                .foregroundStyle(ink)
            ZStack(alignment: .leading) {
                Rectangle()
                    .stroke(ink, lineWidth: 0.9)
                Rectangle()
                    .fill(ink)
                    .frame(width: 86 * pct)
                    .padding(1.5)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: 90, height: 10)
            Text("\(Int(pct * 100))%")
                .font(.system(size: 7.5, design: .monospaced))
                .foregroundStyle(ink.opacity(0.8))
        }
    }
}

// Small helper: chunk an enumerated array into fixed-size rows for the grid.
private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
