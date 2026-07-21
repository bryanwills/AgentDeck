---
id: arch.protocol
title: Bridge Protocol
description: The bridge-to-client WebSocket protocol — event catalog, state machine, and the generated Swift/Kotlin type mirrors.
category: Engineering
locale: en
canonical: true
status: stable
owner: Bridge maintainers
reviewed: 2026-07-21
revision: 2026-07-21
source_of_truth: docs/protocol.md
validators: [pnpm generate-protocol, pnpm test]
---
# Protocol & Architecture Reference

Internal reference for the AgentDeck state machine, WebSocket protocol, and project structure.

---

## Architecture Diagram

```
                                        ┌─────────────────────────────────────────┐
                                        │          Daemon (port 9120)             │
┌──────────────────────┐  WebSocket     │  ┌──────────────┐  ┌──────────────┐    │
│  Stream Deck Plugin  │◄──────────────►│  │ WS Server    │  │ mDNS         │    │
│  Android Dashboard   │◄──────────────►│  │ (all clients)│  │ (daemon only)│    │
│  Apple Dashboard     │◄──────────────►│  └──────────────┘  └──────────────┘    │
│  TUI Dashboard       │◄──────────────►│  ┌──────────────┐  ┌──────────────┐    │
│  ESP32               │◄──Serial──────►│  │ Device Mods  │  │ Gateway      │    │
│  Pixoo64             │◄──HTTP────────►│  │ serial+ble   │  │ Proxy        │    │
│  Timebox Mini Light  │◄──BLE GATT────►│  └──────────────┘  └──────────────┘    │
└──────────────────────┘                │                                         │
                                        └────────────┬────────────────────────────┘
                                                     │ internal WS (future)
                                        ┌────────────▼────────────────────────────┐
                                        │      Session Bridge (port 9121+)        │
┌──────────────────────┐                │  ┌──────────────┐  ┌──────────────┐    │
│  User's Terminal     │◄──stdio───────►│  │ PTY Manager  │  │ Hook Server  │    │
│  (iTerm2)            │                │  │ (node-pty)   │  │ (HTTP POST)  │    │
└──────────────────────┘                │  └──────┬───────┘  └──────────────┘    │
                                        │         │                               │
┌──────────────────────┐  HTTP POST     │  ┌──────▼───────┐  ┌──────────────┐    │
│  Claude Code Hooks   │───────────────►│  │ Output       │  │ Voice        │    │
│  (settings.json)     │                │  │ Parser → SM  │  │ whisper.cpp  │    │
└──────────────────────┘                │  └──────────────┘  └──────────────┘    │
                                        └─────────────────────────────────────────┘
```

**Daemon hub architecture**
- The daemon is the **sole hub** for all dashboard clients. Session bridges handle PTY + hooks only and do not serve external devices.
- Daemon listens on `0.0.0.0:9120` (fallback to 9121+ if port occupied by non-daemon). `~/.agentdeck/daemon.json` records the actual port for local client discovery. Remote clients discover via mDNS (`_agentdeck._tcp`, daemon only advertises).
- Local clients are auto-trusted; LAN clients must present the auth token (`~/.agentdeck/auth-token`). Pair via `agentdeck qr`.
- Daemon computes encoder state and relays the Stream Deck slot map. If the plugin is absent, Android falls back to the v3 default layout while staying fully controllable.
- Voice from Android uploads WAV to `POST /voice/transcribe`; utility actions (volume/brightness/media/timer) go through the Node CLI daemon's macOS `osascript` proxy. The App Store Swift daemon uses native CoreAudio/IOKit code for local utility control and never spawns `osascript`.

---

## State Machine

The bridge combines hook events and PTY output parsing to maintain 6 states:

```
                    +----------------+
         +---------|  DISCONNECTED  |<---- SessionEnd hook / PTY closed
         |         +----------------+
         | agentdeck claude
         v
    +-----------+  Stop hook / idle detected
    |   IDLE    |<----------------------------------+
    +-----+-----+                                   |
          | UserPromptSubmit hook / spinner          |
          v                                         |
    +---------------+  permission prompt detected   |
    |  PROCESSING   |---------------------+         |
    +---+-------+---+                     |         |
        |       |                         v         |
        |       |                +--------------+   |
        |       |                |  AWAITING    |   |
        |       |                |  PERMISSION  |---+ user responds (y/n/a)
        |       |                +--------------+
        |       | diff prompt detected
        |       v
        |  +--------------+
        |  |  AWAITING    |
        |  |  DIFF        |-----------------------------+ user responds (v/a/d)
        |  +--------------+
        | option UI detected
        v
    +--------------+
    |  AWAITING    |
    |  OPTION      |--------------------------------+ user selects option
    +--------------+
```

| State | Description | Detection |
|-------|-------------|-----------|
| `DISCONNECTED` | No session | `SessionEnd` hook, PTY exit |
| `IDLE` | Waiting for prompt | `Stop` hook, `>` idle pattern |
| `PROCESSING` | Agent working | `UserPromptSubmit` hook, spinner |
| `AWAITING_PERMISSION` | Yes/No response needed | `Yes, allow once` / `(y/n)` pattern |
| `AWAITING_OPTION` | Selection needed | Numbered list / navigable cursor |
| `AWAITING_DIFF` | Diff review | `(V)iew/(A)pply/(D)eny` pattern |

---

## WebSocket Protocol

Communication between the daemon (port 9120) and all dashboard clients (Plugin, Android, Apple, TUI, ESP32).

### Bridge -> Plugin / Android

```typescript
// State change (includes tool context, options, cursor, suggested prompt, gateway health)
{ type: 'state_update', state: 'processing', permissionMode: 'default', currentTool: 'Read',
  toolInput: 'src/index.ts', navigable: false, suggestedPrompt: 'fix the bug',
  gatewayAvailable: true, gatewayHasError: false }

// Prompt options (backward-compat). Multi-session clients treat these as
// actionable only when sessionId/focusedSessionId matches the selected session.
{ type: 'prompt_options', sessionId: 'session-123', focusedSessionId: 'session-123',
  promptType: 'yes_no_always', options: [{ index: 0, label: 'Yes' }, ...] }

// Usage stats (session + API-sourced plan usage + ollama status)
{ type: 'usage_update', sessionDurationSec: 120, inputTokens: 5000, outputTokens: 3000, toolCalls: 7,
  fiveHourPercent: 42, sevenDayPercent: 15, extraUsageEnabled: true, oauthConnected: true,
  ollamaStatus: { running: true, models: [{ name: 'qwen2.5:7b', size: '4.5G' }] } }

// Connection status
{ type: 'connection', status: 'connected' }

// Voice recording state
{ type: 'voice_state', state: 'recording' }  // idle | recording | transcribing | error

// User prompt echo (text user typed in terminal)
{ type: 'user_prompt', text: 'fix the login bug' }

// Display sleep (LCD backlight sync)
{ type: 'display_sleep', displayOn: true }

// Active sessions list (multi-session + sibling state)
{ type: 'sessions_list', sessions: [{ id: 'abc', project: 'MyApp', state: 'idle' }] }

// --- Multi-surface events (Android Deck mirroring) ---

// Encoder LCD state (4 encoder panels: utility/action/terminal/voice)
{ type: 'encoder_state', encoders: [...], takeoverActive: false }

// Button state (8 button slots with colors, labels, actions)
{ type: 'button_state', buttons: [{ slot: 0, title: 'MODE', bgColor: '#1e293b', ... }] }

// Stream Deck+ slot map (profile layout for dynamic mirroring)
{ type: 'deck_slot_map', buttons: [...], encoders: [...] }
```

### Plugin / Android -> Bridge

```typescript
{ type: 'respond', value: 'y' }              // Yes/No/Always response (shortcut char)
{ type: 'select_option', index: 2 }          // Option selection (0-based, sends Enter)
{ type: 'navigate_option', direction: 'down' } // Cursor movement for navigable lists
{ type: 'send_prompt', text: 'fix the bug' } // Send prompt text
{ type: 'switch_mode', mode: 'plan' }        // Mode switch (Shift+Tab)
{ type: 'interrupt' }                        // Ctrl+C
{ type: 'escape' }                           // Esc key (cancel prompt/selection)
{ type: 'voice', action: 'start' }           // Voice record start/stop/cancel
{ type: 'query_usage' }                      // Refresh API usage data
{ type: 'utility', mode: 'volume', action: 'set', value: 75 }  // macOS utility proxy
```

---

## Project Structure

```
AgentDeck/
├── shared/                       # Shared type definitions
│   └── src/
│       ├── index.ts              # Re-exports
│       ├── states.ts             # State enum, transitions, StateSnapshot
│       ├── protocol.ts           # WebSocket event/command types, constants
│       └── voice-paths.ts        # Shared binary/model path constants (rec, whisper)
│
├── bridge/                       # Bridge server (PTY + Hook + WS + Voice)
│   └── src/
│       ├── cli.ts                # Unified CLI entry (commander): claude/monitor/daemon/status/...
│       ├── index.ts              # startSession() — session lifecycle (PTY or monitor)
│       ├── bridge-core.ts        # BridgeCore — shared infra (SM, WS, Usage, modules)
│       ├── pty-manager.ts        # node-pty wrapper (dynamic import): spawn, proxy, interrupt
│       ├── output-parser.ts      # ANSI parsing + pattern matching
│       ├── hook-server.ts        # HTTP POST receiver (Claude Code hooks) + SSE + voice endpoint
│       ├── state-machine.ts      # Hook + PTY event → state management
│       ├── ws-server.ts          # WebSocket server (plugin comms + remote auth)
│       ├── session-registry.ts   # Session registry + daemon.json port discovery
│       ├── usage-tracker.ts      # Session usage tracking (tokens, cost)
│       ├── usage-api.ts          # Anthropic API usage fetch (OAuth + Keychain)
│       ├── voice.ts              # sox capture + whisper.cpp transcription
│       ├── whisper-server-manager.ts  # Singleton whisper-server lifecycle (port 9100)
│       ├── mdns.ts               # mDNS advertising (_agentdeck._tcp)
│       ├── auth.ts               # Auth token management (~/.agentdeck/auth-token)
│       ├── utility-proxy.ts      # Node CLI macOS osascript proxy (volume/brightness/media)
│       ├── ollama-probe.ts       # Ollama process status + running models (5s polling)
│       ├── model-catalog.ts      # OAuth model catalog fetch
│       ├── gateway-probe.ts      # OpenClaw Gateway TCP probe + doctor health check
│       ├── daemon.ts             # Legacy daemon entry (backward compat)
│       ├── daemon-server.ts      # startDaemon() — daemon lifecycle (multi-session aggregation)
│       ├── display-monitor.ts    # Display sleep sync (LCD backlight, screen wake)
│       ├── adapters/
│       │   ├── index.ts              # createAdapter() factory
│       │   ├── pty-adapter.ts        # PtyAdapter abstract base (PTY + HookServer common)
│       │   ├── claude-code.ts        # ClaudeCodeAdapter extends PtyAdapter (OutputParser + mode switch)
│       │   ├── monitor.ts            # MonitorAdapter (hook-only, no PTY)
│       │   └── openclaw.ts           # OpenClawAdapter (Gateway WebSocket)
│       ├── modules/
│       │   ├── types.ts              # DeviceModule interface, BridgeContext, ModuleConfigs
│       │   ├── index.ts              # Module registry: createDefaultModules, initModules, stopModules
│       │   ├── mdns-module.ts        # mDNS advertisement module
│       │   ├── adb-module.ts         # ADB reverse tunnel module (auto-detect)
│       │   ├── serial-module.ts      # ESP32 serial module (auto-detect)
│       │   ├── pixoo-module.ts       # Pixoo64 LED matrix module (auto-detect)
│       │   └── timebox-module.ts     # Timebox Mini Light BLE sync module
│       ├── check-deps.ts         # Runtime dependency check
│       ├── logger.ts             # Structured logging
│       └── types.ts              # Bridge-local types + shared re-exports
│
├── plugin/                       # Stream Deck SDK v2 plugin
│   ├── src/
│   │   ├── plugin.ts             # SDK entry, action registration, takeover guard
│   │   ├── bridge-client.ts      # WebSocket client (auto-reconnect)
│   │   ├── connection-manager.ts # Bridge > Gateway priority, event forwarding
│   │   ├── gateway-client.ts     # Direct Gateway connection, Ed25519 auth
│   │   ├── agent-link.ts         # AgentLink interface (send/isConnected/getCapabilities)
│   │   ├── timeline-store.ts     # OC event store, grouping, disk persist, NOW marker
│   │   ├── layout-manager.ts     # State-driven button/encoder layout
│   │   ├── encoder-takeover.ts   # Encoder wide-canvas takeover (option/permission)
│   │   ├── encoder-registry.ts   # String ID → action lookup (no stale references)
│   │   ├── expanded-actions.ts   # 5+ option expanded keypad mode
│   │   ├── label-summarizer.ts   # Haiku CLI fallback for long button labels
│   │   ├── voice-local.ts        # Local voice recording (bridge-independent)
│   │   ├── project-scanner.ts    # Project directory scanner
│   │   ├── project-picker.ts     # Project/session picker UI
│   │   ├── log.ts                # Plugin logger
│   │   ├── actions/              # Button and encoder action handlers
│   │   ├── renderers/            # SVG renderers for buttons and encoder LCDs
│   │   └── utility-modes/        # Volume, mic, media, timer, brightness, darkmode
│   ├── .sdPlugin/
│   │   ├── manifest.json         # Stream Deck plugin manifest
│   │   ├── bin/                  # Build output (plugin.js)
│   │   ├── layouts/              # Encoder LCD layouts
│   │   └── static/imgs/         # Icon assets
│   └── rollup.config.mjs        # Bundle config
│
├── hooks/                        # Claude Code hook installer
│   └── src/install.ts            # Register/unregister hooks in settings.local.json
│
├── setup/                        # npm setup package (@agentdeck/setup)
│   └── src/setup.ts              # npx @agentdeck/setup entry point
│
├── android/                      # Android dashboard app (Jetpack Compose)
│   ├── app/src/main/kotlin/dev/agentdeck/
│   │   ├── net/                  # WebSocket client, protocol, mDNS
│   │   ├── state/                # AgentStateHolder, SessionMetrics
│   │   ├── service/              # MonitorService (foreground, wake lock)
│   │   ├── terrarium/            # Creature animation engine
│   │   ├── ui/                   # Screen composables, HUD panels, e-ink, deck mirror
│   │   └── voice/                # VoiceRecorder (AudioRecord → WAV → bridge)
│   └── build.gradle.kts          # minSdk 29, CATEGORY_HOME launcher
│
├── config/                       # Prompt templates + default settings
├── scripts/                      # Install, uninstall, package, icon generation
├── package.json                  # pnpm workspaces root
├── CLAUDE.md                     # Developer reference
└── README.md
```
