# AgentDeck Dashboard — App Review Notes

_Paste the relevant sections into App Store Connect's "Notes" field when submitting `apple-v<version>`._

## What AgentDeck does

AgentDeck Dashboard is a real-time monitoring and evaluation app for AI coding agents (Claude Code, Codex CLI, OpenCode). It shows live session status, tool activity, and quality scores on the Mac, and — via the free iOS companion app — on an iPad or iPhone used as a secondary display.

**Works standalone on Mac.** All core features (dashboard, APME evaluation reports, Device Preview, Claude Code hook integration, and iOS pairing) work without any additional hardware or AgentDeck companion executable. Users run their AI agent in their own terminal; AgentDeck receives opt-in hook events.

**Optional hardware extensions** let power users drive the same state on Stream Deck+ keys, Ulanzi D200H Deck Docks (USB HID), ESP32 status displays (Wi-Fi), and Divoom Pixoo matrix displays (Wi-Fi). Each integration is configurable from an in-app sheet — the user is never forced to open Terminal.

**Advanced terminal-only integrations** — Android device bridging via ADB, PTY-level launch for Codex/OpenCode, and APME deterministic (git/pnpm introspection) scoring — are not part of the App Store app. The App Store build surfaces clear "Unavailable in App Store build" messaging for each so reviewers and users understand the boundary. The app does not download, install, or launch any companion executable to add those features.

The app is sandboxed. All non-trivial entitlements below are used for local-network monitoring of agents the user is running themselves — no remote services, no third-party data collection.

## Network server rationale (port 9120+)

`com.apple.security.network.server` is used to run a local-only HTTP + WebSocket dashboard hub on `127.0.0.1:9120`. The reason this must be a server (and not an outbound client) is that AgentDeck is a companion to **the same user's own iPad/iPhone running the AgentDeck Dashboard iOS app**, which connects over the local Wi-Fi network and renders the same data. Without `network.server`, the iOS companion cannot receive live session events.

- Port 9120 is the default; the user can override via Settings when another process holds it.
- Binding is `127.0.0.1` + the local-network interface. We do not open firewall rules or bind externally. No inbound traffic from the public internet.
- The server exposes only read-only dashboard endpoints + a hook POST endpoint that the Claude Code CLI (running in the user's own terminal) uses to report session events.

## Bonjour (`_agentdeck._tcp`)

Used so the iOS companion can discover the Mac dashboard on the same LAN without asking the user for an IP address. `NSLocalNetworkUsageDescription` in Info.plist explains this to the user at the system prompt.

## Group Container

`com.apple.security.application-groups` = `group.bound.serendipity.agentdeck.dashboard` stores the daemon state (session registry, auth token, cached usage metrics, APME evaluation SQLite database). A future helper or login-item may share this data, hence the group. No user-identifiable data leaves the device.

## Hook installation (Claude Code settings file)

AgentDeck can optionally register hooks in `~/.claude/settings.local.json` so Claude Code sessions report state to the dashboard. This is entirely opt-in:

1. On first launch the dashboard does **not** touch that file.
2. The user navigates to Settings → Claude Code Hooks → "Enable Claude Code Hooks…".
3. An `NSAlert` explains what keys will be written.
4. On acceptance, an `NSOpenPanel` requires the user to explicitly pick `~/.claude/settings.local.json`. Only then do we acquire a security-scoped bookmark and write the hook entries.
5. Writes are scoped to this single user-selected file; the app reads no other files in `~/.claude/`.

The UI also offers a "Remove" button that deletes our hook entries and revokes the bookmark.

## USB HID entitlement (`com.apple.security.device.usb`)

Used to communicate with the optional Ulanzi D200H Deck Dock (USB HID class, VID `0x2207` / PID `0x0019`). The user opts in by plugging in their own hardware. If the device is absent, the feature is inert.

## Audio input + serial entitlements

- Microphone (`com.apple.security.device.audio-input`) drives the optional voice-command input for AI sessions. Usage description in Info.plist explains the purpose at the system prompt.
- Serial (`com.apple.security.device.serial`) is only used by optional ESP32-based status displays over USB-serial. Inert unless the user connects such hardware.

## Subprocess execution

**The App Store build of AgentDeck does not spawn any subprocess or create shell scripts for Terminal.** The binary is gated behind an `AGENTDECK_APP_STORE` Swift compile condition that compiles-out every `Process()` path and every Terminal-launch path — bundled Node runtime, bundled `bridge/cli.js`, bundled `adb`, bundled D200H helper shell script, AppleScript for iTerm launch, AppleScript fallback for Terminal launch, `.command` launch scripts, `/usr/bin/security`, `/usr/bin/sqlite3`, `/bin/sh`, `/usr/bin/env`, and every external-CLI probe (`openclaw`, `whisper-cli`, `networksetup`). A CI script (`apple/scripts/verify-appstore-archive.sh`) runs after archive and fails the pipeline if the shipped `.app` contains any of those subprocess path strings in its main Mach-O, or any bundled executable besides the signed AgentDeck binary itself.

### What about the Claude Code hook commands?

Claude Code hooks run `python3` / `curl` at the user's shell prompt, in their own terminal session, under Claude Code's process tree — not AgentDeck's. The hook *string* is data AgentDeck writes (with the user's explicit consent via `NSOpenPanel` + security-scoped bookmark) into `~/.claude/settings.local.json`. Claude Code's own runtime is what eventually executes that string when the user runs Claude Code. AgentDeck itself only receives HTTP POSTs from those hooks on `localhost:9120`.

### Bundled helpers

The App Store archive contains no `Contents/Helpers/`, no `Contents/Resources/node`, no `Contents/Resources/agentdeck-runtime`, and no `Contents/Resources/bridge/cli.js`. The sole binary is `Contents/MacOS/AgentDeck`. Android ADB bridging, APME Layer 1 deterministic git/pnpm scoring, and PTY-level agent parsing are outside the reviewed app and are not required for the App Store experience.

### OpenClaw Gateway integration

Unlike the other advanced integrations, OpenClaw **is** first-class in the App Store build — but entirely through the network, not through subprocess or file I/O:

- AgentDeck connects to the user's local OpenClaw Gateway over WebSocket (`ws://127.0.0.1:18789`). No `~/.openclaw/` directory read, no `openclaw` CLI spawn.
- On first launch AgentDeck generates its own Ed25519 keypair (stored in the macOS Keychain, accessible-after-first-unlock / this-device-only). The public key's SHA-256 hex becomes the `deviceId` sent to the Gateway during the v3 pairing handshake. A short-lived `deviceToken` issued by the Gateway is used for subsequent reconnects.
- The user must approve the new device in OpenClaw's Web UI — AgentDeck only displays the pairing state; it never writes to OpenClaw's own config.
- Reviewers without OpenClaw installed will see the "Gateway not found" state and can skip this integration entirely.

### Codex / OpenCode launch

Codex and OpenCode do not ship Claude-Code-compatible hook systems today, so the App Store build does not provide built-in PTY launch for those two agents. Claude Code is monitored entirely through the hook pipeline described above; users start Claude Code in Terminal themselves.

## APME evaluation module

AgentDeck can evaluate finished agent turns against configurable rubrics. In the App Store build:
- Default backend is **Apple Intelligence (Foundation Models)** — on-device, zero-cost, no network.
- Alternatives (MLX local server, Anthropic API) are opt-in and clearly labeled in Settings.
- Layer 1 deterministic checks (git/pnpm introspection) are **disabled** in the App Store build because they require subprocess access outside the sandbox. The UI surfaces this explicitly — users still get Layer 2 LLM-based scoring.

## Stream Deck+ dependency

AgentDeck's Stream Deck+ integration renders session state on Stream Deck+ keys via Elgato's Stream Deck plugin SDK. This requires Elgato's Stream Deck software to be installed separately (free, Mac App Store & Elgato direct download). If a user plugs in a Stream Deck+ without Elgato's software, AgentDeck detects the hardware and shows an inline "Install Stream Deck software to connect" prompt with a direct download link. No silent failure. Reviewers testing without Elgato hardware can skip this integration entirely — the rest of the app does not depend on it.

## iOS companion

The iOS app (same bundle family `bound.serendipity.agentdeck.dashboard`) is a read-only remote dashboard that auto-discovers a paired Mac via Bonjour. On first launch it runs a 3-pane onboarding walking the user through installing an agent on their Mac and finding their Mac on Wi-Fi. Fallback pairing via QR code (Mac shows → iPad scans) handles cases where Local Network permission is denied or the two devices are on different routable networks. No network-server entitlement is needed on iOS — it's a pure client.

## Review demo account

No account required. To see the app's features:

1. Launch the app. A first-run onboarding sheet walks the user through the value prop, available AI agents, and iPad pairing. Dismissing it opens the empty dashboard with a prompt to "Launch Session" or "Preview Devices".
2. Click "Preview Devices" from the menu bar to see how AgentDeck renders sessions on 14 different hardware targets — no real hardware required.
3. Click "Launch Session" to see the App Store-safe guidance: AgentDeck does not launch Terminal scripts. Start Claude Code in Terminal after enabling hooks; the session appears automatically in the dashboard.
4. Click "Pair iPad" to show a QR code the iOS companion app can scan.
5. Open Settings → Hardware Setup to see the in-app flows for ESP32 and Pixoo provisioning (no subprocess calls; writes serial config directly).

## Contact

For anything unclear: `puritysb@gmail.com`.
