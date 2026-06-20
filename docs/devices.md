# AgentDeck Dashboard Devices

7종 대시보드 디바이스 + 프로토콜 종합 레퍼런스.

## Device Matrix

| Device | Transport | Port | Auth | Discovery | Direction | Events |
|--------|-----------|------|------|-----------|-----------|--------|
| **Stream Deck+** | WebSocket JSON | Daemon (9120) | Token (local bypass) | `daemon.json` / mDNS | Bidirectional | All 13 |
| **Android** | WebSocket + HTTP | Daemon (9120) | Token (local bypass) | mDNS / ADB / QR | Bidirectional | All 13 |
| **Apple** | WebSocket + HTTP | Daemon (9120) | Token | mDNS / QR | Bidirectional | All 13 |
| **ESP32** | USB Serial JSON | CDC/UART 115200 | None | Port scan 10s | Push only | 6 |
| **Pixoo64** | HTTP REST (Divoom) | LAN:80 | None | Cloud API / manual | Push only | 4 |
| **Timebox Mini (SPP)** | Bluetooth Classic SPP serial | `/dev/cu.*` | Bluetooth pairing | `TimeBox-Light` paired port scan / manual | Push only | 4 |
| **Timebox Mini (BLE)** | BLE GATT (ISSC transparent-UART) | `49535343-…` | Bluetooth pairing | `TimeBox-mini-light` BLE scan | Push only | 4 |
| **SSE** | HTTP SSE | Daemon (9120) | Token | Manual URL | Push only | All 13 |
| **Gateway** | WebSocket Custom | 18789 | Ed25519 | Hardcoded | Bidirectional | N/A (adapter) |

> **Daemon hub**: All dashboard clients connect exclusively to the daemon. Session bridges handle PTY + hooks only and do not serve external devices. Daemon port defaults to 9120; if occupied by non-daemon process, daemon falls back to next available port and records actual port in `~/.agentdeck/daemon.json`. Local clients read `daemon.json`; remote clients discover via mDNS (daemon only advertises `_agentdeck._tcp`).

## Broadcast Architecture

```
Adapter (ClaudeCode / OpenClaw)
  │
  ▼
StateMachine → BridgeEvent
  │
  ▼
WsServer.broadcast(event)  ──→  WebSocket clients (Plugin, Android, Apple)
  │
  ├── onBroadcast hooks:
  │   ├── broadcastESP32()  ──→  USB Serial JSON lines
  │   └── broadcastPixoo()  ──→  HTTP REST push
  │
  ├── frame pollers:
  │   ├── Timebox sync.py      ──→  Bluetooth SPP frames
  │   └── Timebox sync_ble.py  ──→  BLE GATT frames (micro layout)
  │
  └── explicit calls:
      └── broadcastSse()    ──→  SSE event stream
```

All devices receive the same `BridgeEvent` JSON — only the transport differs.
ESP32 and Pixoo filter via `FORWARDED_EVENTS` sets (defined in `shared/src/protocol.ts`).

## Event Forwarding

Shared constants in `shared/src/protocol.ts`:

| Constant | Events | Used by |
|----------|--------|---------|
| `DISPLAY_FORWARDED_EVENTS` | `state_update`, `usage_update`, `sessions_list`, `connection` | Pixoo64 |
| `SERIAL_FORWARDED_EVENTS` | Above + `timeline_event`, `timeline_history` | ESP32 |

WebSocket and SSE forward all 13 `BridgeEvent` types without filtering.

## Device Details

### Stream Deck+ (Plugin)

- **Transport**: WebSocket to daemon
- **Discovery**: `daemon.json` port → mDNS fallback
- **Auth**: `~/.agentdeck/auth-token` (32-char hex), local connections bypass
- **Protocol**: Full `BridgeEvent` / `PluginCommand` bidirectional
- **Capability gating**: Actions check `AgentCapabilities` for feature availability
- **When daemon unavailable**: Plugin connects directly to OpenClaw Gateway via `GatewayClient`

### Android (Tablet / E-ink)

- **Transport**: OkHttp WebSocket + HTTP endpoints (to daemon)
- **Discovery**: NSD mDNS (`_agentdeck._tcp`, daemon only advertises) → ADB reverse tunnel → QR pairing
- **Auth**: Token from mDNS TXT record or QR code
- **Special endpoints** (on daemon):
  - `POST /voice/transcribe` — WAV upload → whisper transcription
  - `GET /health` — Daemon health check (includes `mode: 'daemon'`)
  - `GET /usage` — Usage data relay
- **ADB reverse**: Daemon polls USB devices every 30s, auto-sets `adb reverse tcp:{daemonPort}`
- **Reconnect**: localhost 5 failures → clear URL → fall back to mDNS discovery

### Apple (iPhone / iPad / macOS)

- **Transport**: URLSessionWebSocketTask + HTTP endpoints
- **Discovery**: NWBrowser (Network.framework) mDNS (`_agentdeck._tcp`, daemon only advertises) → QR pairing (VisionKit)
- **Auth**: Token from mDNS TXT record or QR code
- **Special endpoints**:
  - `POST /voice/transcribe` — WAV upload → whisper transcription (AVAudioEngine 16kHz mono)
- **Platform**: SwiftUI Multiplatform — single Xcode project, iOS + macOS native targets (no Mac Catalyst)
- **Deployment target**: iOS 17.0 / iPadOS 17.0 / macOS 15.0 (macOS 15 raised on 2026-05-10 to use `Scene.defaultLaunchBehavior(.suppressed)` for Evaluation/Settings restoration suppression)
- **State**: `@Observable` (Observation framework) — equivalent to Android's MutableStateFlow
- **Terrarium**: Canvas + TimelineView(.animation) 60fps, Metal backend automatic
- **Layout**:
  - iPhone (compact): Vertical stack HUD, pull-up Engine sheet
  - iPad (regular): Same as Android tablet — terrarium background + 4-corner HUD overlay
  - macOS: Separate WindowGroup, external monitor fullscreen, LSUIElement menu bar mode
- **Distribution**: App Store (`dev.agentdeck.dashboard`), TestFlight beta
- **Source**: `apple/` (pnpm workspace 외부, `android/`와 동일 레벨)
- **Status**: In progress (Phase 1–6 구현 중)

### ESP32 Touch Display

- **Transport**: USB Serial (CH340/CP210x), 115200 baud, newline-delimited JSON
- **Discovery**: Port scan every 10s (`/dev/cu.usbserial-*` macOS, `/dev/ttyUSB*` Linux)
- **Heartbeat**: Full state re-push every 5s via `setESP32StateProvider()`
- **Events**: 6 types (`SERIAL_FORWARDED_EVENTS`)
- **Direction**: Push only — no commands from ESP32
- **Boards**: IPS 3.5" (480×320), 86 Box 4" (480×480), Round AMOLED (240×240)

### Pixoo64 LED Matrix

- **Transport**: HTTP REST to Divoom device LAN IP (port 80)
- **Discovery**: Divoom Cloud API (`app.divoom-gz.com`) or manual IP in `~/.agentdeck/pixoo.json`
- **Events**: 4 types (`DISPLAY_FORWARDED_EVENTS`)
- **Rendering**: State → 64×64 RGB pixel buffer → Divoom HTTP API
- **Heartbeat**: Current frame re-push every 10s
- **Animation**: Idle animation at 600ms/frame (4 frames), PROCESSING state animation
- **Config**: `~/.agentdeck/pixoo.json` — `{ devices: [{ ip, name? }] }`
- **Source**: `bridge/src/pixoo/` (6 files: client, bridge, renderer, sprites, font, settings)

### Divoom Timebox Mini

The Timebox Mini ships in **two transport variants** that drive the same 11×11 LED screen. A `timeboxDevices` entry carries exactly one of `port` (SPP) or `address` (BLE); `agentdeck timebox scan` lists both and `add` auto-detects (a `/dev/…` path → SPP, anything else → BLE; override with `--ble`/`--serial`).

- **SPP variant** — Bluetooth Classic RFCOMM/SPP, paired as `TimeBox-Light`, exposed by macOS as `/dev/cu.*`. Driven by `sync.py`. **CLI daemon only** (needs a serial port; not available in the App Store sandbox).
- **BLE variant** — BLE GATT over the ISSC transparent-UART service `49535343-fe7d-…` (write char `49535343-8841-…`, write-without-response, 20-byte chunks). Advertises as `TimeBox-mini-light` (sharing its BD_ADDR with the Classic audio endpoint `TimeBox-mini-audio`). Driven by `sync_ble.py` (bleak) on the CLI daemon **and natively by the App Store Swift daemon over CoreBluetooth** (no subprocess).

- **Rendering**: dedicated **micro** layout (`/pixoo/frame?size=11&layout=micro`) — a bold, hand-authored **native 11×11 creature glyph** (octopus/codex/opencode/crayfish, with the brand identity marks) on a semantic status field, drawn pixel-for-pixel at the device resolution (no downscale — that bottoms out at a fuzzy silhouette at 121 LEDs). Glyph tables are the SSOT in `bridge/src/pixoo/micro-glyphs.ts`, mirrored byte-for-byte in `apple/.../Modules/MicroGlyphs.swift`. The 11×11 RGB → Divoom static-image packet (4-bit nibbles, `0x44` command, escaped `0x01…0x02` frame); the Swift packet encoder is `TimeboxDivoomPacket` (byte-verified against `sync.py` by `TimeboxProtocolTests`).
- **Heartbeat**: polls the frame endpoint (~1.5s BLE / 2s SPP) and sends only changed frames.
- **Config**: `~/.agentdeck/settings.json` — `{ timeboxDevices: [{ port? | address?, name?, brightness? }] }`
- **Source**: `bridge/src/timebox/` (settings, daemon sync manager, `sync.py`/`sync_ble.py`/`scan_ble.py`); App Store: `apple/AgentDeck/Daemon/Modules/Timebox{BLE,Module,DivoomPacket}.swift`
- **Tier**: SPP = CLI daemon only. BLE = both CLI daemon and App Store Swift daemon.

### SSE (Server-Sent Events)

- **Transport**: HTTP SSE at `GET /sse` on daemon port
- **Auth**: Token query parameter (local bypass)
- **Format**: `event: {type}\ndata: {json}\n\n`
- **Caching**: Bridge caches last `state_update` and `usage_update` for late-connecting clients
- **Events**: All 13 types (no filtering)
- **Use case**: Browser dashboards, monitoring scripts, external integrations

### OpenClaw Gateway (Adapter)

- **Transport**: WebSocket with custom framing `{ type: "req"/"res"/"event", ... }`
- **Port**: 18789 (default)
- **Auth**: Ed25519 device key handshake (`~/.openclaw/identity/`)
- **Protocol**: `chat.send`, `chat.abort`, `exec.approval.resolve`, `sessions.list`
- **Events**: `chat`, `exec.approval.*`, `presence`, `tick`, `shutdown`
- **Note**: Not a dashboard device — it's an upstream agent adapter. Both bridge (`OpenClawAdapter`) and plugin (`GatewayClient`) implement the protocol independently (plugin needs standalone operation).

## Heartbeat Mechanisms

| Device | Method | Interval |
|--------|--------|----------|
| WebSocket | `ws.ping()` | 15s |
| ESP32 | Full state JSON re-push | 5s |
| Pixoo64 | Current frame re-render | 10s |
| Timebox Mini (SPP / BLE) | Current frame poll + changed-frame push | 2s / 1.5s |
| ADB tunnel | `adb devices` poll + re-setup | 30s |
| SSE | No heartbeat (HTTP keep-alive) | — |

## Adding a New Device

1. Create `bridge/src/{device}.ts` with start/stop/broadcast functions
2. Filter events using `DISPLAY_FORWARDED_EVENTS` or `SERIAL_FORWARDED_EVENTS` from `shared/src/protocol.ts` (or define a new set if needed)
3. Register broadcast hook: `wsServer.onBroadcast(broadcastNewDevice)` in `bridge/src/index.ts`
4. Add discovery/polling if needed
5. Update this document
