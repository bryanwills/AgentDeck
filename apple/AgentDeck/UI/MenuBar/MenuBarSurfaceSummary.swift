// MenuBarSurfaceSummary.swift — bounded topology glance for the macOS popup.

#if os(macOS)
import SwiftUI

struct MenuBarSurfaceSummary: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var daemonService: DaemonService

    private var rollup: MenuBarSurfaceRollup {
        MenuBarSurfaceRollup.make(from: stateHolder.state.moduleHealth)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("SURFACES")
                    .font(.system(size: 9.5, weight: .bold))
                    .kerning(0.5)
                    .foregroundStyle(TerrariumHUD.subtext)
                Spacer(minLength: 4)
                statusLabel
            }

            HStack(spacing: 7) {
                AgentDeckLogo(size: 15, color: DesignTokens.UI.cyan)
                Text("AgentDeck")
                    .font(.system(size: 11, weight: .semibold))
                if daemonService.port > 0 {
                    Text(verbatim: ":\(portString(daemonService.port))")
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(TerrariumHUD.subtext)
                }
                Spacer(minLength: 4)
                Circle()
                    .fill(daemonService.port > 0 ? DesignTokens.UI.ok : DesignTokens.UI.error)
                    .frame(width: 6, height: 6)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                    .fill(DesignTokens.UI.popupBgMid.opacity(0.9))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                    .stroke(DesignTokens.UI.cyan.opacity(0.24), lineWidth: 0.5)
            )

            if rollup.families.isEmpty {
                Text("No connected surfaces")
                    .font(.system(size: 10))
                    .foregroundStyle(TerrariumHUD.subtext)
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: DesignTokens.Spacing.s2),
                        GridItem(.flexible(), spacing: DesignTokens.Spacing.s2),
                    ],
                    alignment: .leading,
                    spacing: DesignTokens.Spacing.s2
                ) {
                    ForEach(rollup.families) { family in
                        HStack(spacing: 5) {
                            Text(family.name)
                                .lineLimit(1)
                            Spacer(minLength: 2)
                            Text("\(family.count)")
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .foregroundStyle(TerrariumHUD.text)
                        }
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(TerrariumHUD.subtext)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                                .fill(DesignTokens.Tide.s50.opacity(0.055))
                        )
                    }
                }
            }

            if !rollup.issues.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Text("NEEDS ATTENTION")
                        .font(.system(size: 9, weight: .bold))
                        .kerning(0.45)
                        .foregroundStyle(DesignTokens.UI.attn)

                    ForEach(rollup.issues) { issue in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 8))
                                .foregroundStyle(DesignTokens.UI.attn)
                            Text(issue.label)
                                .lineLimit(2)
                            Spacer(minLength: 3)
                            if issue.count > 1 {
                                Text("\(issue.count)")
                                    .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                            }
                        }
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(TerrariumHUD.text)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: DesignTokens.Radius.md)
                                .fill(DesignTokens.UI.attn.opacity(0.08))
                        )
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Connected surfaces summary")
    }

    @ViewBuilder
    private var statusLabel: some View {
        if rollup.issueCount > 0 {
            Label("\(rollup.issueCount) need attention", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(DesignTokens.UI.attn)
        } else {
            Text("\(rollup.total) connected")
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .foregroundStyle(rollup.total > 0 ? DesignTokens.UI.ok : TerrariumHUD.subtext)
        }
    }
}
#endif
