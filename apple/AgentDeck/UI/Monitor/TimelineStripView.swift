// TimelineStripView.swift — Event timeline (matches Android TimelineStrip.kt)

import SwiftUI

struct TimelineStripView: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder

    @State private var focusedIndex: Int = -1

    /// Read grouped entries — triggers re-render via timelineVersion observation.
    ///
    /// The Claude Code daemon path emits chat_response (the assistant's
    /// reply text) AND chat_end (a "Completed · Ns · topic" metadata
    /// marker) for every turn so that downstream surfaces — Pixoo, D200H,
    /// Stream Deck plugin, APME — can detect the turn boundary. On the
    /// dashboard's compact timeline panel that second row reads as "한 줄
    /// 더" beneath the assistant's conclusion, since the row immediately
    /// above it already conveys the same turn's completion. Hide the
    /// chat_end here so each turn occupies one row in this view; the
    /// daemon still persists/broadcasts the entry, so the focusedGroup
    /// detail pane and other surfaces are unaffected.
    private var grouped: [GroupedEntry] {
        stateHolder.timelineStore.grouped.filter { g in
            !(g.entry.type == .chatEnd && g.entry.agentType == "claude-code")
        }
    }

    /// Accessed in body to register SwiftUI observation on timeline changes
    private var timelineVersion: Int { stateHolder.timelineVersion }

    private var focusedGroup: GroupedEntry? {
        if grouped.isEmpty { return nil }
        if focusedIndex < 0 || focusedIndex >= grouped.count {
            return grouped.last
        }
        return grouped[focusedIndex]
    }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                // Main content: two-pane row (65/35 split). Use top
                // alignment so an empty timeline column (just "TIMELINE"
                // header + "No events yet") does not get vertically
                // centered against the taller detail pane on the right —
                // that produced a "title floats in the middle" look.
                HStack(alignment: .top, spacing: 0) {
                    // Left pane: compact log scroll (65%)
                    VStack(spacing: 0) {
                        // Header — timelineVersion read forces @Observable re-evaluation
                        Text("TIMELINE")
                            .id(timelineVersion)
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(TerrariumHUD.subtext)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.top, 4)
                            .padding(.bottom, 2)

                        if grouped.isEmpty {
                            Text("No events yet")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(TerrariumHUD.subtext)
                                .padding(.horizontal, 8)
                        } else {
                            ScrollViewReader { proxy in
                                ScrollView {
                                    LazyVStack(alignment: .leading, spacing: 1) {
                                        ForEach(Array(grouped.enumerated()), id: \.offset) { index, group in
                                            compactLogRow(group, index: index)
                                                .id(index)
                                                .onTapGesture { focusedIndex = index }
                                        }
                                    }
                                    .padding(.horizontal, 4)
                                }
                                .onChange(of: grouped.count) {
                                    if !grouped.isEmpty, focusedIndex < 0 {
                                        proxy.scrollTo(grouped.count - 1, anchor: .bottom)
                                    }
                                }
                            }
                        }
                    }
                    .frame(width: geo.size.width * 0.65)

                    // Vertical divider (1dp, matches Android)
                    Rectangle()
                        .fill(TerrariumHUD.subtext.opacity(0.3))
                        .frame(width: 1)
                        .padding(.vertical, 8)

                    // Right pane: detail panel (35%)
                    detailPane(focusedGroup)
                        .frame(maxWidth: .infinity)
                }

            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    // MARK: - Compact Log Row

    private func compactLogRow(_ group: GroupedEntry, index: Int) -> some View {
        let isSelected = index == focusedIndex ||
            (focusedIndex < 0 && index == grouped.count - 1)
        let isChatEnd = group.entry.type == .chatEnd
        let icon = timelineTypeIcon(for: group.entry.type, status: group.entry.status)
        let iconColor = timelineTypeColor(for: group.entry.type)
        let countSuffix = group.count > 1 ? " ×\(group.count)" : ""
        // Session attribution prefix — bracketed project name differentiates
        // simultaneous Claude sessions ("ViewTrans" vs "AgentDeck") whose
        // agentType would otherwise look identical in the timeline.
        let sessionLabel = rowPrefixLabel(for: group.entry)

        return HStack(spacing: 4) {
            // Selected indicator bar
            if isSelected {
                Rectangle()
                    .fill(iconColor)
                    .frame(width: 2, height: 14)
            }

            Text(formatTime(group.entry.date))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext.opacity(isChatEnd ? 0.4 : 0.5))

            Text(icon)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(iconColor.opacity(isChatEnd ? 0.6 : 1))

            if !sessionLabel.isEmpty {
                Text(sessionLabel)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext.opacity(isChatEnd ? 0.55 : 0.75))
                    .lineLimit(1)
            }

            Text(group.entry.raw + countSuffix)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(isChatEnd ? TerrariumHUD.text.opacity(0.6) : TerrariumHUD.text)
                .lineLimit(1)

            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(
            isSelected ? Color.white.opacity(0.08) : Color.clear,
            in: RoundedRectangle(cornerRadius: 2)
        )
    }

    /// Produce the compact-row attribution prefix. Prefers `projectName`
    /// (e.g. "AgentDeck") over the coarser `agentType` ("Claude"). Falls
    /// back to the agent tag when no project is recorded so OpenClaw or
    /// legacy entries still get *something* readable.
    private func rowPrefixLabel(for entry: TimelineEntry) -> String {
        if let p = entry.projectName, !p.isEmpty {
            return "[\(p)]"
        }
        let tag = agentTag(entry.agentType)
        return tag.isEmpty ? "" : "[\(tag)]"
    }

    // MARK: - Detail Pane

    private func detailPane(_ group: GroupedEntry?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let group {
                let icon = timelineTypeIcon(for: group.entry.type, status: group.entry.status)
                let iconColor = timelineTypeColor(for: group.entry.type)
                let countSuffix = group.count > 1 ? " (×\(group.count))" : ""

                // Header: type badge chip + timestamp
                HStack(spacing: 6) {
                    // Type badge chip (colored bg)
                    Text(" \(icon) \(formatType(group.entry.type)) ")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(iconColor.opacity(0.7), in: RoundedRectangle(cornerRadius: 3))

                    Spacer()

                    Text(formatTimeSeconds(group.entry.date))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                }
                .padding(.horizontal, 8)
                .padding(.top, 4)

                // Agent tag
                let agentTag = agentTag(group.entry.agentType)
                if !agentTag.isEmpty {
                    Text(agentTag + countSuffix)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext.opacity(0.7))
                        .padding(.horizontal, 8)
                }

                Spacer().frame(height: 4)

                // Summary (11sp bold)
                Text(group.entry.raw)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.text)
                    .padding(.horizontal, 8)

                // Detail text
                if let detail = group.entry.detail, detail != group.entry.raw {
                    Spacer().frame(height: 4)
                    ScrollView {
                        Text(detail)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(TerrariumHUD.subtext.opacity(0.8))
                    }
                    .padding(.horizontal, 8)
                }

                Spacer()
            } else {
                Spacer()
                Text("No events")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext.opacity(0.5))
                    .frame(maxWidth: .infinity)
                Spacer()
            }
        }
        .background(Color.black.opacity(0.19), in: RoundedRectangle(cornerRadius: 4))
    }

    // MARK: - Helpers

    private func formatTime(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        return fmt.string(from: date)
    }

    private func formatTimeSeconds(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm:ss"
        return fmt.string(from: date)
    }

    private func agentTag(_ agentType: String?) -> String {
        switch agentType {
        case "claude-code": "Claude"
        case "openclaw": "OpenClaw"
        case nil: ""
        default: "Agent"
        }
    }

    private func formatType(_ type: TimelineEntryType) -> String {
        switch type {
        case .toolRequest: "TOOL"
        case .toolResolved: "DONE"
        case .toolExec: "EXEC"
        case .modelCall: "MODEL"
        case .modelResponse: "RESP"
        case .chatStart: "CHAT"
        case .chatEnd: "END"
        case .chatResponse: "REPLY"
        case .memoryRecall: "MEM"
        case .error: "ERR"
        case .scheduled: "SCHED"
        case .userAction: "USER"
        case .evalResult: "EVAL"
        }
    }
}

// MARK: - Timeline Type Color & Icon (matches Android typeColor/typeIcon)

func timelineTypeColor(for type: TimelineEntryType) -> Color {
    switch type {
    case .chatStart, .chatEnd, .chatResponse: TerrariumHUD.text
    case .toolRequest, .toolResolved, .toolExec: TerrariumHUD.ledGreen
    case .modelCall, .modelResponse: TerrariumHUD.tetraNeon
    case .error: TerrariumHUD.ledRed
    case .scheduled: TerrariumHUD.subtext
    case .userAction: Color(red: 0.231, green: 0.51, blue: 0.965) // Blue
    case .memoryRecall: TerrariumHUD.claudeBody
    case .evalResult: TerrariumHUD.ledAmber
    }
}

func timelineTypeIcon(for type: TimelineEntryType, status: String? = nil) -> String {
    if type == .toolRequest, let status {
        switch status {
        case "approved": return "✓"
        case "denied": return "✗"
        default: return "⚠"
        }
    }
    return switch type {
    case .toolRequest: "⚠"
    case .toolResolved: "✓"
    case .toolExec: "▸"
    case .modelCall: "◆"
    case .modelResponse: "◇"
    case .chatStart: "▶"
    case .chatEnd: "■"
    case .chatResponse: "◇"
    case .memoryRecall: "⦻"
    case .error: "✗"
    case .scheduled: "⏰"
    case .userAction: "☞"
    case .evalResult: "★"
    }
}
