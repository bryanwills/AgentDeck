// TankStatusPanel.swift — Rate limits + model/runtime subscriptions panel

import SwiftUI

struct TankStatusPanel: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences

    var body: some View {
        let staleSuffix = stateHolder.state.usageStale == true ? " !" : ""

        VStack(alignment: .leading, spacing: 6) {
            Text("∿ TANK STATUS")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext)

            if stateHolder.state.fiveHourPercent != nil || stateHolder.state.sevenDayPercent != nil {
                HStack {
                    Spacer()
                    if let pct = stateHolder.state.fiveHourPercent {
                        WaterGauge(
                            label: "5h\(staleSuffix)",
                            percent: pct,
                            resetTime: formatResetTime(stateHolder.state.fiveHourResetsAt)
                        )
                    }
                    if let pct = stateHolder.state.sevenDayPercent {
                        WaterGauge(
                            label: "7d\(staleSuffix)",
                            percent: pct,
                            resetTime: formatResetTime(stateHolder.state.sevenDayResetsAt)
                        )
                    }
                    Spacer()
                }
            }

            EngineSection(
                title: "OpenClaw",
                lines: preferences.showOpenClawSection ? openClawLines : [],
                highlightedLine: preferences.showOpenClawSection ? openClawPrimaryLine : nil
            )
            EngineSection(title: "MLX", lines: preferences.showMLXSection ? mlxLines : [])
            EngineSection(title: "OLLAMA", lines: preferences.showOllamaSection ? ollamaLines : [])
            EngineSection(title: "Antigravity", lines: preferences.showAntigravitySection ? antigravityLines : [])
            EngineSection(title: "Subscriptions", lines: preferences.showSubscriptionsSection ? subscriptionLines : [])
        }
        .padding(10)
        .background(TerrariumHUD.bg, in: RoundedRectangle(cornerRadius: 8))
        .opacity(stateHolder.state.bridgeConnected ? 1.0 : 0.6)
    }

    private var openClawLines: [String] {
        let available = stateHolder.state.modelCatalog.filter(\.available)
        guard !available.isEmpty else { return [] }

        let ordered = available.sorted {
            let lhsDefault = $0.role == "default"
            let rhsDefault = $1.role == "default"
            if lhsDefault != rhsDefault { return lhsDefault && !rhsDefault }
            return normalizeOpenClawName($0.name) < normalizeOpenClawName($1.name)
        }

        let primary = normalizeOpenClawName(ordered[0].name)
        let remainder = ordered.dropFirst().map { normalizeOpenClawName($0.name) }
        guard !remainder.isEmpty else { return [primary] }

        var groups: [String: [String]] = [:]
        var familyOrder: [String] = []

        for normalized in remainder {
            let family = openClawFamilyKey(normalized)
            if groups[family] == nil { familyOrder.append(family) }
            groups[family, default: []].append(normalized)
        }

        let compactedRemainder: [String] = familyOrder.compactMap { family -> String? in
            guard let names = groups[family] else { return nil }
            return compactOpenClawFamily(names)
        }

        return [primary] + compactedRemainder
    }

    private var ollamaLines: [String] {
        guard let ollama = stateHolder.state.ollamaStatus, ollama.available else { return [] }
        let running = ollama.models.filter { $0.sizeVram > 0 }
        let source = running.isEmpty ? ollama.models : running
        let names = source.map { model in
            let bytes = model.sizeVram > 0 ? model.sizeVram : model.size
            let suffix = bytes > 0 ? " \(formatBytes(bytes))" : ""
            return "\(model.name)\(suffix)"
        }
        return names.isEmpty ? [] : [names.joined(separator: ", ")]
    }

    private var mlxLines: [String] {
        stateHolder.state.mlxModels.isEmpty ? [] : stateHolder.state.mlxModels
    }

    private var subscriptionLines: [String] {
        stateHolder.state.subscriptions.map { item in
            if let until = formatSubscriptionDate(item.until) {
                return "\(item.name) · \(until)"
            }
            return item.name
        }
    }

    private var antigravityLines: [String] {
        guard let status = stateHolder.state.antigravityStatus else { return [] }
        guard let planName = status.planName, !planName.isEmpty else { return [] }
        return [planName]
    }

    private var openClawPrimaryLine: String? {
        openClawLines.first
    }
}

private func normalizeOpenClawName(_ name: String) -> String {
    name
        .replacingOccurrences(of: "DeepSeek: DeepSeek ", with: "DeepSeek ")
        .replacingOccurrences(of: "DeepSeek:", with: "DeepSeek")
        .replacingOccurrences(of: "GPT: GPT ", with: "GPT ")
        .replacingOccurrences(of: "GLM: GLM ", with: "GLM ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func openClawFamilyKey(_ name: String) -> String {
    let lower = name.lowercased()
    if lower.hasPrefix("glm") { return "glm" }
    if lower.hasPrefix("gpt") { return "gpt" }
    if lower.hasPrefix("deepseek") { return "deepseek" }
    if lower.hasPrefix("claude") { return "claude" }
    if lower.hasPrefix("gemini") { return "gemini" }
    if lower.hasPrefix("qwen") { return "qwen" }
    if lower.hasPrefix("llama") { return "llama" }
    return name
}

private func compactOpenClawFamily(_ names: [String]) -> String {
    let deduped = Array(NSOrderedSet(array: names).array as? [String] ?? names)
    guard let first = deduped.first else { return "" }
    guard deduped.count > 1 else { return first }

    let prefix = familyDisplayPrefix(first)
    guard !prefix.isEmpty else { return deduped.joined(separator: ", ") }

    let compacted = deduped.enumerated().map { index, name in
        guard index > 0, name.hasPrefix(prefix) else { return name }
        return String(name.dropFirst(prefix.count))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return compacted.joined(separator: ", ")
}

private func familyDisplayPrefix(_ name: String) -> String {
    let lower = name.lowercased()
    if lower.hasPrefix("glm-") { return "GLM-" }
    if lower.hasPrefix("gpt-") { return "GPT-" }
    if lower.hasPrefix("deepseek ") { return "DeepSeek " }
    if lower.hasPrefix("claude ") { return "Claude " }
    if lower.hasPrefix("gemini ") { return "Gemini " }
    if lower.hasPrefix("qwen ") { return "Qwen " }
    if lower.hasPrefix("llama ") { return "Llama " }
    return ""
}

private struct EngineSection: View {
    let title: String
    let lines: [String]
    var highlightedLine: String? = nil

    var body: some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext)

                ForEach(lines, id: \.self) { line in
                    Text(line)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(line == highlightedLine ? TerrariumHUD.ledAmber : TerrariumHUD.text)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
            .padding(.top, 2)
        }
    }
}

struct WaterGauge: View {
    let label: String
    let percent: Double
    var resetTime: String? = nil

    private var fillColor: Color {
        if percent >= 90 { return TerrariumHUD.ledRed }
        if percent >= 70 { return TerrariumHUD.ledAmber }
        return TerrariumHUD.ledGreen
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundStyle(TerrariumHUD.subtext)

            ZStack(alignment: .center) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 76, height: 76)

                VStack(spacing: 0) {
                    Spacer()
                    Rectangle()
                        .fill(fillColor.opacity(0.5))
                        .frame(height: 68 * min(percent / 100, 1))
                }
                .frame(width: 68, height: 68)
                .clipShape(RoundedRectangle(cornerRadius: 4))

                Text("\(Int(percent))%")
                    .font(.system(size: 18, weight: .bold, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.text)
            }
            .frame(width: 76, height: 76)

            if let reset = resetTime {
                Text("⟲ \(reset)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(TerrariumHUD.subtext.opacity(0.7))
            }
        }
    }
}

private func formatSubscriptionDate(_ iso: String?) -> String? {
    guard let iso, !iso.isEmpty else { return nil }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]

    guard let date = fractional.date(from: iso) ?? plain.date(from: iso) else {
        return iso
    }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}
