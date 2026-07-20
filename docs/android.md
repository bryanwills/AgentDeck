---
id: spec.android
title: Android Devices
description: Android device support matrix and creature rendering behaviour across e-ink readers and tablets.
category: Specifications
locale: en
canonical: true
status: stable
owner: Android maintainers
reviewed: 2026-07-21
revision: 2026-07-21
source_of_truth: docs/android.md
validators: [pnpm test:android]
---
# Android Dashboard

Detailed reference for the AgentDeck Android app — build, device support, and creature behavior.

---

## Supported Devices

e-ink 리더(Crema S, Onyx Boox, MOAAN Pantone 6, Bigme, Kobo)와 컬러 태블릿(Lenovo 등)을 지원한다. **벤더별 EPD API · 칩셋 · 디스플레이 타입 · 리프레시 모드 · App Store tier 의 전체 디바이스 매트릭스는 [hardware-compatibility.md § D](hardware-compatibility.md#d-모바일--데스크톱-소프트웨어-플랫폼) 가 SSOT** 다. 이 문서는 빌드/서명/크리처 렌더링 등 Android 앱 고유 내용을 다룬다.

---

## Build & Install

Requires JDK 17+ (`brew install openjdk@17`). Build script auto-detects Homebrew JDK.

```bash
# Build APK locally
bash scripts/build-android-release.sh    # → dist/agentdeck-v{VERSION}.apk

# Or download from GitHub Releases
# git tag android-v{VERSION} && git push origin android-v{VERSION}  → CI builds APK
```

### WiFi adb deploy (cable-free updates)

Dashboard devices (e-ink readers, tablets) can take silent APK updates over WiFi
once their `adbd` is switched to TCP mode:

```bash
bash scripts/deploy-android-wifi.sh enable           # one-time per device, USB attached:
                                                     #   tcpip:5555 + record wlan0 IP
bash scripts/deploy-android-wifi.sh deploy [--build] # install newest dist/agentdeck-v*.apk
                                                     #   to every recorded device + relaunch
bash scripts/deploy-android-wifi.sh status           # reconnect + show device states
```

Device IPs persist in `~/.agentdeck/android-adb-devices.json`. tcpip mode does
**not** survive a device reboot — after a reboot, plug the device in over USB
once and re-run `enable`. USB adb keeps working alongside TCP mode.

### Signing

For local builds, create `android/signing.properties` (gitignored):
```properties
storeFile=/path/to/keystore.jks
keyAlias=agentdeck
keyPassword=your-key-password
storePassword=your-store-password
```

For CI (GitHub Actions), set these secrets:
- `ANDROID_KEYSTORE_BASE64` — base64-encoded keystore file
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`

### Release

Tag-triggered CI builds:
```bash
git tag android-v{VERSION}
git push origin android-v{VERSION}
# → GitHub Actions builds + creates Release with APK
```

---

## E-ink Device Setup (CremaS etc.)

CremaS and some other locked-down e-ink readers reset USB debugging on every reboot. AgentDeck's `BootReceiver` re-enables it automatically, but needs a one-time adb grant:

```bash
adb shell pm grant dev.agentdeck android.permission.WRITE_SECURE_SETTINGS
```

After this, on every boot `BootReceiver` writes `global adb_enabled=1` + `development_settings_enabled=1`, so USB debugging comes back without any manual toggling. Verify with:

```bash
adb logcat -s AgentDeckBootReceiver
```

The same grant also powers `stay_on_while_plugged_in` from `MonitorService`. Note: AppOps grants can be lost on app reinstall — re-run the `pm grant` command after reinstalling the APK.

---

## Terrarium Creature Behavior

The aquarium creatures respond to agent state in real-time:

| Creature | Agent | Visual States |
|----------|-------|---------------|
| **Octopus** (14x5 pixel grid) | Claude Code | PROCESSING: starburst animation + tentacle wave. IDLE: rests near the sand. Per-session instances with name hats. `standingJitter` + depth offset for natural multi-session placement |
| **Crayfish** (SVG path art) | OpenClaw | ROUTING: claw clap + signal waves + eye flash + glow pulse. SITTING: heartbeat glow (4s double-pulse teal). SICK: desaturated body, -12° tilt, drooping claws, dim flickering eyes (gateway doctor errors). DORMANT: completely still |
| **Neon Tetra** (14 fish, 2 schools) | Ambient | Boids flocking with Lissajous school paths. Attracted to active agents — swim toward data particles during PROCESSING. 2 schools of 7 fish meet/scatter every ~20-30s |

### Gateway Health → Crayfish SICK State

The bridge runs `openclaw doctor --json` every 30 seconds and sends `gatewayHasError` in `state_update` events. When errors are detected (channel warnings, memory sync failures, config issues), the crayfish enters the **SICK** visual state:

| Property | SICK Effect | Normal (SITTING) |
|----------|------------|-------------------|
| Body color | 55% desaturated gray-pink | Red gradient |
| Tilt | -12° lean | Upright |
| Claws | Droop downward (-8°) | Rest at sides |
| Eyes | Dim flickering (alpha 0.35–0.55) | Gentle breathing (0.85) |
| Antennae | Hang down, minimal wiggle | Slow gentle wave |
| Position | Droops +8% lower | On rock |
| E-ink gray | `0x66` (washed out) | `0x33` (dark) |
| Env overlay | Red error tint | None |

Once errors are resolved, the crayfish recovers at the next 30-second check.

### E-ink Grayscale

On e-ink devices, creatures use native 16-level grayscale (no dithering):
- Creature body: `0x44`, limbs/claws: `0x33`, starburst: `0x99`
- Sick crayfish body: `0x66` (lighter — visually washed out)
- Fish body: `0x55`, stripe: `0xBB`
- Environment: sand `0xCC`, rock outline `0x22`, seaweed 2px stroke
- 12 tetra (6+6 schools) on e-ink vs 14 (7+7) on tablet
