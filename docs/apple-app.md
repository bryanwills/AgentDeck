# Apple Dashboard (iOS · iPadOS · macOS)

The SwiftUI companion. What ships in the App Store build versus the
terminal-managed daemon is tracked in
[appstore-feature-matrix.md](appstore-feature-matrix.md).

# Apple Dashboard

Monitor and control your AI agents from iPhone, iPad, or Mac — a native SwiftUI experience.

<p align="center">
  <img src="media/ipad-iphone-closeup.jpg" width="720" alt="Apple dashboard — iPad and iPhone showing terrarium with pixel art creatures and HUD overlay">
</p>

The Apple app is a SwiftUI multiplatform app that connects to the bridge on iOS/iPadOS, and **on macOS ships with a full in-process Swift daemon** (63 files, ~32,000 LOC) — mDNS, device modules (ADB/Serial/Pixoo/Timebox/iDotMatrix), Gateway proxy, and WebSocket server — so the macOS build works standalone without Node.js. You can still use the `agentdeck` CLI alongside it for Claude Code / Codex / OpenCode PTY sessions; the app's daemon auto-detects and defers to a running CLI daemon on the same port.

## Three-Tab Navigation

| Tab | Content |
|-----|---------|
| **Monitor** | Terrarium background + HUD overlay — agent status, rate limits, timeline |
| **Deck** | Stream Deck+ mirror — encoder panels + button grid with touch gestures |
| **Settings** | Bridge connection, display preferences |

## macOS Menu Bar Popup

On macOS the app always lives in the menu bar — one click reveals the full topology without taking over a window.

<p align="center">
  <img src="media/macos-menubar-popup.png" width="720" alt="AgentDeck macOS menu bar popup — session list, Jump To quick actions, and UPSTREAM/DOWNSTREAM topology over the Dashboard aquarium">
</p>

- **Sessions** — live session list with agent, state, and model; per-row Jump To buttons open the Pixoo view, the Stream Deck Code view, the full Dashboard window, or reveal the session data folder in Finder
- **Topology** — `UPSTREAM` (Claude Code hooks, OpenClaw Gateway, MLX, Ollama) and `DOWNSTREAM` (D200H, Pixoo, ESP32, Android) with LED dots driven by the shared `ProviderRailEvaluator`, so Settings / Dashboard / menu bar can never disagree about "is Claude connected?"
- **Tabs** — Launch · Dashboard · Evaluation switch the popup body without opening a window; a `Start at Login` toggle + `Quit` sit in the footer

## Connect to Bridge

- **mDNS** — automatic discovery of `_agentdeck._tcp` services on your local network
- **QR pairing** — scan with the in-app camera (`agentdeck qr` on your Mac)
- **Manual** — enter bridge IP and port

## iOS Foreground Recovery

The app handles iOS background/foreground transitions gracefully — WebSocket reconnects immediately on foregrounding, state syncs within milliseconds, and the terrarium animation resumes without flicker.

## Two-tier product: App Store app alone vs +CLI

AgentDeck is deliberately a two-tier product:

- **Tier 1 — the App Store app alone** is a complete monitoring dashboard. It installs Claude Code / Codex hooks itself (explicit NSOpenPanel consent), shows live session state and tool activity, flips a session to **"needs attention" + a macOS notification** when the agent genuinely waits for your response (you answer in your own terminal), optionally monitors an OpenCode server you run (`opencode serve`, Settings → Integrations), and drives all sandbox-reachable hardware (D200H, Pixoo, Timebox, iDotMatrix, ESP32) plus iPad pairing, voice input, and APME LLM evaluation.
- **Tier 2 — install the `agentdeck` CLI** (`npx @agentdeck/setup`) and the same app gains the PTY-powered extras: **steering** (answer Claude's real multi-choice prompts from the dashboard, Stream Deck, or D200H), Claude subscription usage gauges (5h/7d) and Codex credits, passive discovery of already-running sessions, Android/e-ink devices over ADB, and ESP32 firmware flashing. The app detects the CLI daemon automatically on port 9120 — no configuration; quit the daemon and the app seamlessly takes back over.

The upgrade story lives here and in [appstore-feature-matrix.md](appstore-feature-matrix.md) — the app itself never prompts you to install the CLI (App Review 4.2.3).

## App Store Distribution

[AgentDeck Dashboard 1.0.0 is live on the Mac App Store](https://apps.apple.com/us/app/agentdeck-dashboard/id6784822497) as of 2026-07-21; the iPhone/iPad companion remains in review. The repository has since advanced to the unified `1.0.1` maintenance train, so source version and currently public store version may differ between channel releases.

The macOS build ships as a **self-contained Swift daemon** gated by the `AGENTDECK_APP_STORE` compile flag — no bundled Node.js, no bundled `adb`, no subprocess spawn, no AppleScript. User data lives in the app sandbox container (`~/Library/Containers/bound.serendipity.agent.deck/Data/Library/Application Support/AgentDeck/`, not `~/.agentdeck/`) per Apple Review Guideline 2.5.2. D200H is reached only through the Ulanzi Studio WebSocket plugin, so AgentDeck requests no USB HID entitlement. The first-launch onboarding asks for Claude Code hook access via explicit NSOpenPanel consent. OpenClaw integration uses the Gateway-native WebSocket path (see §OpenClaw Gateway below), not a file-based identity. The app uses bundle ID `bound.serendipity.agent.deck`; see [RELEASING.md](../RELEASING.md) for independent channel delivery and build numbering.

## OpenClaw Gateway (Gateway-native pairing)

AgentDeck connects to the OpenClaw Gateway over WebSocket (`ws://127.0.0.1:18789`) as an operator client. Pairing uses two handshake formats so both distributions work:

- **Mac App Store build (v3 self-generated identity)**: on first launch AgentDeck generates an Ed25519 keypair and stores the private key in the macOS Keychain (`accessibleAfterFirstUnlockThisDeviceOnly`). `deviceId = sha256(raw 32-byte public key).hex`. The Gateway returns a `deviceToken` in `hello-ok.auth.deviceToken`; it's persisted and reused on reconnect. No file read of `~/.openclaw/identity/` — sandbox-safe per Apple 2.5.2. Default scopes: `operator.read`, `operator.write`, `operator.approvals`. To pair, run `openclaw devices approve <requestId>` (or use OpenClaw's Web UI) once; the dashboard flips from Pairing required → Connected.
- **CLI / Homebrew build (v2 file-based identity)**: reads `~/.openclaw/identity/device.json` created by `openclaw pair`, for historical parity with the Node bridge.

Both builds share the same RPC surface: `connect`, `health`, `models.list`, `logs.tail`, `sessions.list/subscribe`, `chat.send/abort`, `exec.approval.resolve`, `system-presence`. Events: `connect.challenge`, `health`, `sessions.changed`, `session.message/tool`, `chat`, `exec.approval.requested/resolved`, `presence`, `tick`, `shutdown`. All subprocess-based fallbacks (`openclaw doctor`, `openclaw logs --follow`, `openclaw models list`) are compile-out in the App Store build and replaced with Gateway RPCs. See [gateway-protocol.md](gateway-protocol.md) for wire format + parity fixtures.

Auth failures (`missing_token`, `pairing_required`, `token_mismatch`, `device_auth_invalid`) do **not** auto-loop; the Settings pairing-state UI surfaces each case so the user can resolve deliberately. Remote / TLS-pinned Gateway support is deferred to v2; v1 officially targets loopback.

---
