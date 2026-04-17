# AgentDeck Dashboard — App Review Notes

_Paste the relevant sections into App Store Connect's "Notes" field when submitting `apple-v<version>`._

## What AgentDeck does

AgentDeck Dashboard is the companion for developers using command-line AI coding agents such as Claude Code, Codex CLI, OpenCode, and OpenClaw. It shows real-time session status, tool activity, and usage metrics on the Mac desktop (and optionally on the user's own Stream Deck+, ESP32 boards, or iPad via the companion iOS app of the same product family).

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

The app does not spawn arbitrary subprocesses. The earlier design that shelled out to `/usr/bin/env which …` for CLI discovery was removed in version 1.0.0. The only process invocation that remains is `NSWorkspace.shared.open(...)` / `NSAppleScript` to launch the user's chosen terminal emulator (Terminal, iTerm, etc.), which is a standard user-initiated action.

## APME evaluation module

AgentDeck can evaluate finished agent turns against configurable rubrics. In the App Store build:
- Default backend is **Apple Intelligence (Foundation Models)** — on-device, zero-cost, no network.
- Alternatives (MLX local server, Anthropic API) are opt-in and clearly labeled in Settings.
- Layer 1 deterministic checks (git/pnpm introspection) are **disabled** in the App Store build because they require subprocess access outside the sandbox. The UI surfaces this explicitly — users still get Layer 2 LLM-based scoring.

## Review demo account

No account required. To see the app's features:

1. Launch the app. The menu bar icon appears.
2. Click "Preview Devices" to see how AgentDeck renders sessions on 14 different hardware targets — no real hardware required.
3. Click "Launch Session" to start a Claude Code session (requires the user to have `claude` CLI installed via `npm install -g @anthropic-ai/claude-code`; if absent, the dashboard shows an install prompt and remains functional as a status UI).

## Contact

For anything unclear: `puritysb@gmail.com`.
