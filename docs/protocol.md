# Protocol & Architecture Reference

Internal reference for the AgentDeck state machine, WebSocket protocol, and project structure.

---

## Architecture Diagram

```
┌──────────────────────┐   WebSocket (ws://localhost:9120)   ┌────────────────────┐
│  Stream Deck Plugin  │◄───────────────────────────────────►│   Bridge Server    │
│  (Node.js, SDK v2)   │   state updates ← / → commands     │   (Node.js)        │
│                      │                                     │                    │
│  8 Keys              │                                     │  ┌──────────────┐  │
│  4 Encoders + LCD    │                                     │  │ PTY Manager  │  │
└──────────────────────┘                                     │  │ (node-pty)   │  │
                                                             │  └──────┬───────┘  │
                                                             │         │          │
┌──────────────────────┐                                     │  ┌──────▼───────┐  │
│  User's Terminal     │◄──stdio proxy──────────────────────►│  │ claude CLI   │  │
│  (iTerm2)            │  user sees claude normally          │  └──────┬───────┘  │
└──────────────────────┘                                     │         │ output   │
                                                             │  ┌──────▼───────┐  │
┌──────────────────────┐   HTTP POST (hook JSON on stdin)    │  │ Output       │  │
│  Claude Code Hooks   │────────────────────────────────────►│  │ Parser       │  │
│  (settings.json)     │   structured events                 │  └──────┬───────┘  │
└──────────────────────┘                                     │         │          │
                                                             │  ┌──────▼───────┐  │
                                                             │  │ State        │  │
                                                             │  │ Machine      │  │
                                                             │  └──────┬───────┘  │
                                                             │         │          │
                                                             │  ┌──────▼───────┐  │
                                                             │  │ WS Server    │  │
                                                             │  │ :9120        │  │
                                                             │  └──────────────┘  │
                                                             │                    │
                                                             │  ┌──────────────┐  │
                                                             │  │ Voice        │  │
                                                             │  │ whisper.cpp  │  │
                                                             │  └──────────────┘  │
                                                             └────────┬───────────┘
                                                                      │
┌──────────────────────┐   WebSocket (ws://LAN:9120) + mDNS          │
│  Android Dashboard   │◄────────────────────────────────────────────►│
│  (Jetpack Compose)   │   SSE / state updates / voice transcribe
│  E-ink / Tablet      │
└──────────────────────┘
```

**Multi-surface control (macOS host + Stream Deck + Android)**
- The macOS bridge (`sdc`) listens on `0.0.0.0:9120`; local clients are auto-trusted, LAN clients must present the auth token stored at `~/.agentdeck/auth-token`.
- Stream Deck plugin connects locally; Android tablet/e-ink app connects over the same WebSocket (pair via `sdc qr`) and mirrors encoder LCDs and buttons.
- Bridge computes encoder state and relays the Stream Deck slot map. If the plugin is absent, Android falls back to the v3 default layout while staying fully controllable.
- Voice from Android uploads WAV to `POST /voice/transcribe`; utility actions (volume/brightness/media/timer) go through the bridge's macOS `osascript` proxy, so either surface can monitor and steer the agent independently or simultaneously.

---

## State Machine

The bridge combines hook events and PTY output parsing to maintain 6 states:

```
                    +----------------+
         +---------|  DISCONNECTED  |<---- SessionEnd hook / PTY closed
         |         +----------------+
         | sdc start
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

Communication between the bridge (port 9120) and the Stream Deck plugin / Android app.

### Bridge -> Plugin / Android

```typescript
// State change (includes tool context, options, cursor, suggested prompt, gateway health)
{ type: 'state_update', state: 'processing', permissionMode: 'default', currentTool: 'Read',
  toolInput: 'src/index.ts', navigable: false, suggestedPrompt: 'fix the bug',
  gatewayAvailable: true, gatewayHasError: false }

// Prompt options (backward-compat, options-only)
{ type: 'prompt_options', promptType: 'yes_no_always', options: [{ index: 0, label: 'Yes' }, ...] }

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
│       ├── index.ts              # sdc CLI entry (commander)
│       ├── pty-manager.ts        # node-pty wrapper: spawn, proxy, interrupt
│       ├── output-parser.ts      # ANSI parsing + pattern matching
│       ├── hook-server.ts        # HTTP POST receiver (Claude Code hooks) + SSE + voice endpoint
│       ├── state-machine.ts      # Hook + PTY event → state management
│       ├── ws-server.ts          # WebSocket server (plugin comms + remote auth)
│       ├── session-registry.ts   # Multi-session registry (~/.agentdeck/sessions.json)
│       ├── usage-tracker.ts      # Session usage tracking (tokens, cost)
│       ├── usage-api.ts          # Anthropic API usage fetch (OAuth + Keychain)
│       ├── voice.ts              # sox capture + whisper.cpp transcription
│       ├── whisper-server-manager.ts  # Singleton whisper-server lifecycle (port 9100)
│       ├── mdns.ts               # mDNS advertising (_agentdeck._tcp)
│       ├── auth.ts               # Auth token management (~/.agentdeck/auth-token)
│       ├── utility-proxy.ts      # macOS osascript proxy (volume/brightness/media)
│       ├── ollama-probe.ts       # Ollama process status + running models (5s polling)
│       ├── model-catalog.ts      # OAuth model catalog fetch
│       ├── gateway-probe.ts      # OpenClaw Gateway TCP probe + doctor health check
│       ├── daemon-server.ts      # Daemon monitoring server (multi-session aggregation)
│       ├── display-monitor.ts    # Display sleep sync (LCD backlight, screen wake)
│       ├── adapters/
│       │   ├── index.ts              # createAdapter() factory
│       │   ├── claude-code.ts        # ClaudeCodeAdapter (PTY + Parser + HookServer)
│       │   └── openclaw.ts           # OpenClawAdapter (Gateway WebSocket)
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
│   │   ├── log-stream.ts         # openclaw logs --follow --json → timeline events
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
