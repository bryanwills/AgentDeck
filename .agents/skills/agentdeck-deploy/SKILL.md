---
name: agentdeck-deploy
description: Build, install, launch, and configure AgentDeck on connected Android, Apple, ESP32, Stream Deck, or daemon targets. Use when the user asks to deploy AgentDeck or names target devices such as pantone, crema, lenovo, iphone, ipad, macos, esp32, tc001, bridge, daemon, or plugin.
---

# AgentDeck Deploy

Use this skill for deploy-style tasks. Keep deployment scoped to connected targets and skip missing devices with a clear note.

## Target Names

- `all`: bridge, plugin, Android, iOS, and macOS.
- `android`: all connected Android devices.
- `pantone` / `pantone6`: Pantone 6.
- `crema`: Crema S.
- `lenovo` / `tablet` / `tab`: Lenovo Tab.
- `ios`: iPad and iPhone.
- `iphone`: iPhone target.
- `ipad`: iPad target.
- `macos` / `mac`: macOS app.
- `apple`: iOS and macOS.
- `esp32`: LVGL ESP32 boards only.
- `esp32-all`: LVGL ESP32 boards plus Ulanzi TC001.
- `ulanzi` / `tc001`: Ulanzi TC001 only.
- `bridge` / `daemon`: daemon restart only.
- `plugin` / `sd`: Stream Deck plugin only.

## Preflight

From the repo root, detect what is actually connected before deploying:

```bash
adb devices -l
xcrun devicectl list devices
ls /dev/cu.usb*
pgrep -x "Stream Deck"
cat ~/.agentdeck/daemon.json
```

If any preflight command fails because of sandboxing or device access, request approval and retry only that command.

## Build Order

1. Run `pnpm build` unless the target is daemon-only or ESP32-only.
2. For Android targets, run `bash scripts/build-android-release.sh`.
3. For Stream Deck plugin fresh installs, run `pnpm package`; otherwise `pnpm build` is enough when the plugin is already linked.

## Android Deploy

For each connected target device:

```bash
adb -s <serial> shell am force-stop dev.agentdeck
adb -s <serial> install -r <apk>
adb -s <serial> shell am start -n dev.agentdeck/.MainActivity
adb -s <serial> reverse tcp:9120 tcp:9120
```

If install fails from a signature conflict, uninstall and retry install. For Pantone 6 after install, restore landscape:

```bash
adb -s AA007422R24C1300039 shell settings put system accelerometer_rotation 0
adb -s AA007422R24C1300039 shell settings put system user_rotation 1
```

## Apple Deploy

Use the Xcode project in `apple/`. Prefer existing XcodeBuildMCP tools when available; otherwise use the established `xcodebuild` commands from `CLAUDE.md` and local project schemes. Do not add App Store UI text that asks users to install or launch external tools.

## ESP32 Deploy

Build and flash one board at a time. Identify boards before flashing; do not assume a serial port maps to a board. Plain `esp32` excludes Ulanzi TC001. Use `tc001`, `ulanzi`, or `esp32-all` to include it.

## Report

Summarize targets deployed, skipped targets, commands that required approval, and verification status.
