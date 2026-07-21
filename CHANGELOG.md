# Changelog

Product versions are unified across every delivery channel — the root `VERSION`
file is the source of truth and `pnpm verify-version` gates the mirrors. Channels
ship independently under their own tags (`apple-v*`, `streamdeck-v*`, `ulanzi-v*`,
`npm-v*`, `android-v*`, `esp32-v*`), so a given version may reach each store on a
different day. See [RELEASING.md](RELEASING.md).

## 1.0.1

Maintenance release across independently delivered channels — reliability fixes
that landed after the 1.0.0 build (03ed5a94) went to the App Store. Channels ship
on their own schedules; the iOS companion carries its fix on a later train while
1.0.0 finishes review.

### macOS app — App Store

- Fix the dashboard failing to attach to its own in-process daemon (WS connect
  handler was being clobbered and ports were mis-probed)
- Remove an actor-isolated closure that could trap at runtime
- Display-sleep correctness: re-sync `display_state` to clients, disarm two dim
  traps, and make iDotMatrix "off" render actually dark
- Recover a wedged ESP32 serial port by backing off instead of resetting the board
- Stop dropping whole tail windows on a split UTF-8 character (restores the Codex
  usage gauge)

### Stream Deck plugin — Elgato Marketplace

- Keep observed-agent processing details capability-aware on every keypad size:
  show the current model once as an inert readout instead of filling every unused
  key with duplicate `MODEL` tiles
- Preserve the notify-only Codex contract: processing details expose no steering
  action that the observed session cannot deliver

### iOS companion (ships after 1.0.0 review completes)

- Hold the screen awake while the paired Mac's display is on

## 1.0.0

First public release. Previous 0.x versions were development and TestFlight-only builds.

### macOS / iOS app — App Store

The macOS app is **standalone**: it embeds an in-process Swift daemon and needs no
Node.js, no CLI, and no companion install. The iOS/iPadOS app is a read-only
companion that pairs with a Mac on the same network.

- Live session dashboard for Claude Code, Codex, OpenCode, and OpenClaw — state,
  tool calls, timeline, and token/usage gauges
- APME evaluation — per-turn scoring, cost accounting, and a Pareto-frontier model
  recommender
- Device Preview gallery — 17 hardware surfaces rendered without owning any hardware
- Local-network pairing over Bonjour with QR-code enrollment
- Voice input via on-device speech recognition
- Opt-in Claude Code hook installer

Sandboxed with no subprocess execution, no home-relative-path entitlement, and no
App Groups; the local WebSocket accepts same-machine and paired-companion clients only.

### Stream Deck plugin — Elgato Marketplace

- Session-per-button keypad layout with encoder dials and a live touch-strip timeline
- Renders an explicit OFFLINE state when no daemon is present
- Requires the Stream Deck app 6.9+

### Ulanzi plugin — Ulanzi Marketplace

- D200H Deck Dock support through a single dynamic action whose keys reflow by agent
  state (sessions, options, mode, stop, usage)
- Ships `@resvg/resvg-js` native binaries for every declared macOS/Windows target
- Requires Ulanzi Studio 2.1.4+

### CLI and daemon — npm (optional)

`npx @agentdeck/setup` installs the `agentdeck` CLI, daemon hub, and lifecycle hooks
for Claude Code, Codex, and OpenCode. This unlocks the Tier-2 surfaces the sandboxed
app cannot reach — ADB-bridged Android devices, serial/BLE matrix displays, and
ESP32 WiFi OTA. Everything in the App Store app works without it.

### Android app — GitHub Release (APK)

E-ink-first dashboard for CremaS, Onyx, Kobo, and tablets. Not distributed through
Google Play.

### ESP32 firmware — GitHub Release

Prebuilt firmware for 86 Box, IPS 3.5", Round AMOLED, IPS 10.1", InkDeck (7.5"
e-ink), and TTGO T-Display. Flash over USB, then update over WiFi with
`agentdeck esp32-ota <target>`.
