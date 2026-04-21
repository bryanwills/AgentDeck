// IntegrationsView.swift — single source of truth for the rows that
// appear in Settings → Integrations, the Onboarding integrations pane,
// and the Dashboard SetupNeededCard. Three places used to ship three
// different copies of the same five integrations; now they all read
// from this catalog and only differ in interaction mode.
//
// The catalog also splits integrations into two groups so users can
// see at a glance which ones come from "an account/CLI you already
// signed into" versus "a paste-this-key option". This was the user
// pain that prompted the rewrite — OpenClaw worked without any input
// and Anthropic Admin needed a key, but the old UI stacked them
// identically and made every row feel equally fiddly.

import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - Catalog

enum IntegrationKind {
    /// Auto-detected from a CLI session, native app, or a Web UI pairing
    /// flow. The user never pastes a token here; AgentDeck reads what
    /// the other tool already stored locally.
    case accountLinked
    /// Explicit secret pasted by the user. Optional — these surface
    /// extra data AgentDeck can't infer from local state.
    case apiKey
}

struct IntegrationDescriptor: Identifiable, Hashable {
    let id: String
    let displayName: String
    let kind: IntegrationKind
    let iconSystemName: String
    /// One-line, ≤ 100 chars. Describes WHAT the integration unlocks,
    /// not HOW to set it up.
    let oneLineHelp: String
    /// 1-line setup guidance shown only when the row is in a
    /// "needs action" state.
    let connectInstructions: String?
}

enum IntegrationCatalog {
    private static let claudeOneLineHelp = "Live session telemetry through opt-in Claude Code hooks."
    private static let claudeConnectInstructions = "Enable Claude Code Hooks below. Sessions appear here after hook events arrive."
    private static let codexOneLineHelp = "Codex runs in your own terminal; AgentDeck monitors the session through hooks."
    private static let codexConnectInstructions = "The standalone dashboard still works without launching Codex from here."

    static let claudeCode = IntegrationDescriptor(
        id: "claude",
        displayName: "Claude Code",
        kind: .accountLinked,
        iconSystemName: "bolt.fill",
        oneLineHelp: claudeOneLineHelp,
        connectInstructions: claudeConnectInstructions
    )

    static let codex = IntegrationDescriptor(
        id: "codex",
        displayName: "Codex (ChatGPT)",
        kind: .accountLinked,
        iconSystemName: "person.badge.key",
        oneLineHelp: codexOneLineHelp,
        connectInstructions: codexConnectInstructions
    )

    static let openClaw = IntegrationDescriptor(
        id: "openclaw",
        displayName: "OpenClaw Gateway",
        kind: .accountLinked,
        iconSystemName: "network",
        oneLineHelp: "Routes agent traffic through a local Gateway. Pairing happens in OpenClaw's Web UI.",
        connectInstructions: "Start OpenClaw, then approve this Mac in the OpenClaw Web UI."
    )

    static let antigravity = IntegrationDescriptor(
        id: "antigravity",
        displayName: "Antigravity",
        kind: .accountLinked,
        iconSystemName: "atom",
        oneLineHelp: "Plan name and remaining credits, read from the local Antigravity app.",
        connectInstructions: "Pick the Antigravity state.vscdb file once so the sandboxed app can read it."
    )

    static let anthropicAdmin = IntegrationDescriptor(
        id: "anthropic-admin",
        displayName: "Anthropic Admin API",
        kind: .apiKey,
        iconSystemName: "chart.line.uptrend.xyaxis",
        oneLineHelp: "Org-wide token usage (today + 30 days). Separate from Pro/Max subscription quota.",
        connectInstructions: "Paste an Admin API key from console.anthropic.com/settings/keys."
    )

    static let all: [IntegrationDescriptor] = [
        claudeCode, codex, openClaw, antigravity, anthropicAdmin,
    ]
}

// MARK: - Status

enum IntegrationStatus: Equatable {
    case connected(detail: String?)
    case awaiting(detail: String)
    case failed(detail: String)
    case notConfigured(detail: String?)
    case unsupported(detail: String)

    var label: String {
        switch self {
        case .connected: return "Connected"
        case .awaiting: return "Awaiting setup"
        case .failed: return "Auth failed"
        case .notConfigured: return "Not configured"
        case .unsupported: return "Unsupported"
        }
    }

    var detail: String? {
        switch self {
        case .connected(let d), .notConfigured(let d): return d
        case .awaiting(let d), .failed(let d), .unsupported(let d): return d
        }
    }

    var tint: Color {
        switch self {
        case .connected: return TerrariumHUD.ledGreen
        case .awaiting: return TerrariumHUD.ledAmber
        case .failed, .unsupported: return TerrariumHUD.ledRed
        case .notConfigured: return TerrariumHUD.subtext
        }
    }

    var needsAttention: Bool {
        switch self {
        case .connected, .notConfigured: return false
        case .awaiting, .failed, .unsupported: return true
        }
    }
}

// MARK: - Status evaluator

/// Maps live `AgentState` + `AppPreferences` into an `IntegrationStatus`
/// per descriptor. Centralized so SettingsScreen, Onboarding and the
/// Dashboard SetupCard can't drift in their interpretation of state.
enum IntegrationStatusEvaluator {
    static func status(
        for descriptor: IntegrationDescriptor,
        state: DashboardState,
        preferences: AppPreferences,
        anthropicKeySaved: Bool
    ) -> IntegrationStatus {
        switch descriptor.id {
        case "claude":
            return claudeStatus(state: state, preferences: preferences)
        case "codex":
            return codexStatus(state: state)
        case "openclaw":
            return openClawStatus(state: state)
        case "antigravity":
            return antigravityStatus(state: state, preferences: preferences)
        case "anthropic-admin":
            return anthropicStatus(state: state, hasKey: anthropicKeySaved)
        default:
            return .notConfigured(detail: nil)
        }
    }

    private static func claudeStatus(state: DashboardState, preferences: AppPreferences) -> IntegrationStatus {
        // Claude is "connected" as soon as either the hook relay or the
        // OAuth token is wired up — both are independently usable signals.
        //   • Hooks on  → real-time session telemetry (sandbox-safe path
        //                  and the only one that works in the App Store
        //                  build without an external Node daemon).
        //   • OAuth on  → subscription quota fetch (direct Anthropic API;
        //                  needs the token on disk, which the sandboxed
        //                  daemon can't read — flows in via CLI relay).
        // Earlier code gated on oauthConnected alone, so App Store users
        // with working hooks still saw "not connected" despite sessions
        // flowing through the dashboard.
        let hooksOn = preferences.hooksInstalled
        let oauthOn = state.oauthConnected ?? false
        if hooksOn && oauthOn {
            return .connected(detail: "Pro/Max · hooks on")
        }
        if hooksOn {
            return .connected(detail: "Hooks on")
        }
        if oauthOn {
            return .connected(detail: "Pro/Max · hooks off")
        }
        return .awaiting(detail: "Enable Claude Code Hooks below to relay live sessions.")
    }

    private static func codexStatus(state: DashboardState) -> IntegrationStatus {
        if let mode = state.codexAuthMode, !mode.isEmpty {
            return .connected(detail: mode)
        }
        return .unsupported(detail: "Codex runs in your own terminal; sessions appear here once started.")
    }

    private static func openClawStatus(state: DashboardState) -> IntegrationStatus {
        // Short deviceId (first 8 hex chars) for pairing copy so the user
        // can match what they see here against the entry OpenClaw's Web UI
        // shows when approving a new device. Nil → omit the identifier
        // entirely rather than showing a stub.
        let deviceIdHint: String = state.gatewayDeviceId
            .flatMap { $0.isEmpty ? nil : String($0.prefix(8)) }
            .map { " — deviceId `\($0)…`" } ?? ""

        switch state.gatewayAuthStatus {
        case "connected":
            return .connected(detail: "Paired through Gateway")
        case "reconnecting":
            // WebSocket dropped but Gateway TCP is still up — adapter reconnects
            // automatically. Show amber "Awaiting" instead of "Not configured" so
            // the user knows this is transient and no action is required.
            return .awaiting(detail: "Reconnecting to Gateway\(deviceIdHint)…")
        case "approval_pending", "pairing_required", "gateway_reachable":
            return .awaiting(detail: "Approve this Mac in OpenClaw's Web UI (http://localhost:18789)\(deviceIdHint).")
        case "gateway_token_missing":
            return .awaiting(detail: "Gateway is in shared-token mode. Paste the token in Advanced.")
        case "token_mismatch":
            return .failed(detail: "Shared token doesn't match. Paste the correct Gateway token in Advanced\(deviceIdHint).")
        case "device_auth_invalid":
            // Expected on first launch and after identity reset — device key not yet
            // in Gateway's approved list. Shown as "Awaiting" (amber) not "Auth failed"
            // (red) because this is a normal step in the pairing flow, not a hard error.
            return .awaiting(detail: "Approve this Mac in OpenClaw's Web UI (http://localhost:18789)\(deviceIdHint).")
        case "auth_failed":
            return .failed(detail: "Authentication error. Check OpenClaw Gateway logs\(deviceIdHint).")
        case "unsupported_protocol":
            return .unsupported(detail: "Update OpenClaw Gateway to a 2026.4.14+ build.")
        default:
            if state.gatewayAvailable {
                return .awaiting(detail: "Gateway reachable. Open the OpenClaw Web UI to approve this Mac\(deviceIdHint).")
            }
            return .notConfigured(detail: "Start OpenClaw on ws://127.0.0.1:18789 to begin pairing.")
        }
    }

    private static func antigravityStatus(state: DashboardState, preferences: AppPreferences) -> IntegrationStatus {
        if !preferences.antigravityAccessEnabled {
            return .notConfigured(detail: "Pick the state.vscdb file to grant read access.")
        }
        guard let info = state.antigravityStatus, let plan = info.planName, !plan.isEmpty else {
            return .awaiting(detail: "DB selected but no plan info yet — open Antigravity once to populate it.")
        }
        let credits = info.availableCredits.map { "\($0) cr" }
        let detail = [plan, credits].compactMap { $0 }.joined(separator: " · ")
        return .connected(detail: detail)
    }

    private static func anthropicStatus(state: DashboardState, hasKey: Bool) -> IntegrationStatus {
        guard hasKey else {
            return .notConfigured(detail: "Optional. Adds org-wide token usage when configured.")
        }
        let todayIn = state.adminApiTodayInputTokens ?? 0
        let todayOut = state.adminApiTodayOutputTokens ?? 0
        let monthIn = state.adminApiMonthInputTokens ?? 0
        let monthOut = state.adminApiMonthOutputTokens ?? 0
        let todayTotal = todayIn + todayOut
        let monthTotal = monthIn + monthOut
        if todayTotal == 0 && monthTotal == 0 {
            return .connected(detail: "Awaiting first fetch")
        }
        return .connected(detail: "Today \(formatTokens(todayTotal)) · 30d \(formatTokens(monthTotal))")
    }

    private static func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
        return "\(n)"
    }
}

// MARK: - Row view

/// Display modes for `IntegrationRow`. Keeps the catalog/row code
/// shared while letting each screen show only the affordances it needs.
enum IntegrationRowMode {
    /// Full Settings row: name + status + detail + connect instructions
    /// when not connected. No paste fields here — they live in
    /// `IntegrationsView` slots so this row stays platform-agnostic.
    case settings
    /// Onboarding pane: name + one-line help only. No live status,
    /// because users haven't done anything yet and we don't want to
    /// nag during the wizard.
    case onboarding
    /// Dashboard SetupCard: compact two-line variant. Caller pre-filters
    /// to rows where `status.needsAttention == true`.
    case setupCard
}

struct IntegrationRow: View {
    let descriptor: IntegrationDescriptor
    let status: IntegrationStatus
    let mode: IntegrationRowMode

    var body: some View {
        switch mode {
        case .settings: settingsBody
        case .onboarding: onboardingBody
        case .setupCard: setupCardBody
        }
    }

    private var settingsBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: descriptor.iconSystemName)
                    .font(.system(size: 12))
                    .foregroundStyle(TerrariumHUD.subtext)
                    .frame(width: 16)
                Text(descriptor.displayName)
                    .font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 8)
                statusBadge
            }
            if let detail = status.detail {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(TerrariumHUD.subtext.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if status.needsAttention, let instructions = descriptor.connectInstructions {
                Text(instructions)
                    .font(.system(size: 10))
                    .foregroundStyle(TerrariumHUD.subtext.opacity(0.7))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var onboardingBody: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: descriptor.iconSystemName)
                .font(.system(size: 16))
                .foregroundStyle(Color.accentColor)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(descriptor.displayName)
                    .font(.system(size: 14, weight: .semibold))
                Text(descriptor.oneLineHelp)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.08))
        )
    }

    private var setupCardBody: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: descriptor.iconSystemName)
                .font(.system(size: 10))
                .foregroundStyle(status.tint)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(descriptor.displayName)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TerrariumHUD.text)
                Text(status.detail ?? status.label)
                    .font(.system(size: 10))
                    .foregroundStyle(TerrariumHUD.subtext)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var statusBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(status.tint)
                .frame(width: 6, height: 6)
            Text(status.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(status.tint)
        }
    }
}

// MARK: - List view (Settings two-group container)

/// Shows the two groups (Account integrations / Optional API keys)
/// with their explanatory header lines. Paste fields and "Choose
/// state.vscdb" affordances are passed in as builder slots so this
/// view stays free of #if AGENTDECK_APP_STORE / Keychain code.
struct IntegrationsView<AccountSlot: View, ApiKeySlot: View>: View {
    @EnvironmentObject private var stateHolder: AgentStateHolder
    @EnvironmentObject private var preferences: AppPreferences

    /// `true` when the Anthropic Admin API key is present in Keychain.
    /// Owner of this view tracks it and passes it down so we don't have
    /// to make IntegrationsView App-Store-only.
    let anthropicKeySaved: Bool

    /// Per-row inline editor (e.g. OpenClaw Advanced disclosure with
    /// the shared-token field, Antigravity database picker). Returns
    /// `EmptyView()` for rows that have no extra controls.
    @ViewBuilder let accountSlot: (IntegrationDescriptor) -> AccountSlot

    /// Inline editor for API key rows (e.g. SecureField + Save/Clear).
    @ViewBuilder let apiKeySlot: (IntegrationDescriptor) -> ApiKeySlot

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            section(
                title: "Accounts",
                hint: "Sign in to a CLI or desktop app once; AgentDeck reads the local session. No tokens to paste here.",
                rows: IntegrationCatalog.all.filter { $0.kind == .accountLinked },
                slot: { accountSlot($0) }
            )

            section(
                title: "Optional API keys",
                hint: "Paste a key only if you want extra data AgentDeck can't infer from local state.",
                rows: IntegrationCatalog.all.filter { $0.kind == .apiKey },
                slot: { apiKeySlot($0) }
            )
        }
    }

    @ViewBuilder
    private func section<Slot: View>(
        title: String,
        hint: String,
        rows: [IntegrationDescriptor],
        @ViewBuilder slot: @escaping (IntegrationDescriptor) -> Slot
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .kerning(0.6)
                .foregroundStyle(TerrariumHUD.subtext)
            Text(hint)
                .font(.system(size: 11))
                .foregroundStyle(TerrariumHUD.subtext.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)

            ForEach(Array(rows.enumerated()), id: \.element.id) { index, descriptor in
                if index > 0 { Divider().opacity(0.4) }
                VStack(alignment: .leading, spacing: 6) {
                    IntegrationRow(
                        descriptor: descriptor,
                        status: IntegrationStatusEvaluator.status(
                            for: descriptor,
                            state: stateHolder.state,
                            preferences: preferences,
                            anthropicKeySaved: anthropicKeySaved
                        ),
                        mode: .settings
                    )
                    slot(descriptor)
                }
            }
        }
    }
}
