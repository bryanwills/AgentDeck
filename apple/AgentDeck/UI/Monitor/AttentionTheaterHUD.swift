// AttentionTheaterHUD.swift — Dashboard variant of the Option D attention theater
//
// Same interaction pattern as the menubar's `AttentionTheaterView` — when any
// session awaits permission/option/diff input, surface it at the top of the
// monitor screen with YES/NO/ALWAYS buttons that dispatch directly to the
// bridge — but rendered in the Terrarium HUD palette rather than the menubar's
// cream card. Visually reads as a bioluminescent alert suspended above the
// aquarium: deep-water glass, amber flare, neon underline.
//
// Interaction parity with Cmd+Y/N/A: YES = selectOption(0), NO = selectOption(1),
// ALWAYS = selectOption(2). Matches D200H button mapping and the existing
// keyboard shortcuts in `MonitorScreen.KeyboardShortcutsModifier`.

import SwiftUI

struct AttentionTheaterHUD: View {
    let session: SessionInfo
    let question: String?
    let queuedCount: Int                       // how many other awaiting sessions are behind this one
    let respond: (Int) -> Void                 // 0=yes 1=no 2=always
    let onFocus: () -> Void                    // focus this session in the dashboard

    @State private var breatheLarge = false
    @State private var auraPhase = false

    private var agentLabel: String {
        switch session.agentType {
        case "claude-code": return "Claude"
        case "codex-cli":   return "Codex"
        case "openclaw":    return "OpenClaw"
        case "opencode":    return "OpenCode"
        default:            return session.agentType?.capitalized ?? "Agent"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                creatureBadge
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("ATTENTION")
                            .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                            .kerning(1.4)
                            .foregroundStyle(TerrariumHUD.ledAmber)
                        if queuedCount > 0 {
                            Text("+\(queuedCount) queued")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(TerrariumHUD.subtext)
                        }
                        Spacer(minLength: 0)
                    }
                    Text(session.projectName ?? "Session")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(TerrariumHUD.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                        .lineLimit(1)
                    if let question, !question.isEmpty {
                        Text(question)
                            .font(.system(size: 12))
                            .foregroundStyle(TerrariumHUD.text)
                            .lineLimit(3)
                            .padding(.top, 6)
                    }
                }
            }

            HStack(spacing: 6) {
                theaterButton(
                    label: "Yes",
                    hint: "⌘Y",
                    fill: TerrariumHUD.ledGreen,
                    action: { respond(0) }
                )
                theaterButton(
                    label: "No",
                    hint: "⌘N",
                    fill: TerrariumHUD.ledRed,
                    action: { respond(1) }
                )
                theaterButton(
                    label: "Always",
                    hint: "⌘A",
                    fill: TerrariumHUD.tetraNeon,
                    action: { respond(2) }
                )
            }
        }
        .padding(12)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.black.opacity(0.65))
                RoundedRectangle(cornerRadius: 12)
                    .stroke(TerrariumHUD.ledAmber.opacity(0.45), lineWidth: 1)
                // Pulsing glow — the "bioluminescent signal" that a creature
                // needs you. Keeps the peripheral eye aware without stealing
                // the center of the screen.
                RoundedRectangle(cornerRadius: 12)
                    .stroke(TerrariumHUD.ledAmber.opacity(auraPhase ? 0.35 : 0.1), lineWidth: 3)
                    .blur(radius: 4)
            }
        )
        .onTapGesture { onFocus() }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                breatheLarge = true
            }
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                auraPhase = true
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = [agentLabel]
        if let model = session.modelName, !model.isEmpty {
            parts.append(shortModel(model))
        }
        if let started = relativeTime(session.startedAt) {
            parts.append(started)
        }
        return parts.joined(separator: " · ")
    }

    private var creatureBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.black.opacity(0.45))
                .frame(width: 50, height: 50)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(TerrariumHUD.ledAmber.opacity(0.5), lineWidth: 1)
                )
            SessionCreatureIcon(
                agentType: session.agentType,
                tint: SessionBrand.color(for: session.agentType),
                size: 34
            )
        }
        .scaleEffect(breatheLarge ? 1.04 : 1.0)
    }

    private func theaterButton(
        label: String,
        hint: String,
        fill: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                Text(hint)
                    .font(.system(size: 9, design: .monospaced))
                    .opacity(0.85)
            }
            // Dark-on-LED buttons: the button-face is the LED color, text is
            // near-black so it stays legible against bright fills. Matches
            // the terrarium HUD convention of using LED colors as the signal
            // palette rather than as background tints.
            .foregroundColor(Color.black.opacity(0.85))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(fill)
                    .shadow(color: fill.opacity(0.45), radius: 6, x: 0, y: 2)
            )
        }
        .buttonStyle(.plain)
    }

    private func shortModel(_ name: String) -> String {
        var s = name
        for prefix in ["claude-", "gpt-", "o1-", "o3-"] {
            if s.hasPrefix(prefix) { s = String(s.dropFirst(prefix.count)) }
        }
        if let range = s.range(of: #"-\d{8}$"#, options: .regularExpression) {
            s = String(s[s.startIndex..<range.lowerBound])
        }
        return s
    }

    private func relativeTime(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return nil
        }
        let s = Int(Date().timeIntervalSince(date))
        if s < 60 { return "<1m" }
        let m = s / 60
        if m < 60 { return "\(m)m" }
        let h = m / 60
        if h < 24 { return "\(h)h" }
        return "\(h / 24)d"
    }
}
