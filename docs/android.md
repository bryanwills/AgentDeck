# Android Dashboard

Detailed reference for the AgentDeck Android app — build, device support, and creature behavior.

---

## Supported Devices

| Device | Chip | EPD API |
|--------|------|---------|
| **Crema S** | Rockchip RK3566 | `android.os.EinkManager` — `setMode()` + `sendOneFullFrame()` |
| **Onyx Boox** | — | `BaseDevice.setViewDefaultUpdateMode()` |
| **Kobo** (via Android) | — | Fallback `invalidate()` |
| **General tablets** | — | Standard Android rendering (color, 60fps) |

---

## Build & Install

Requires JDK 17+ (`brew install openjdk@17`). Build script auto-detects Homebrew JDK.

```bash
# Build APK locally
bash scripts/build-android-release.sh    # → dist/agentdeck-v{VERSION}.apk

# Or download from GitHub Releases
# git tag android-v{VERSION} && git push origin android-v{VERSION}  → CI builds APK
```

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
