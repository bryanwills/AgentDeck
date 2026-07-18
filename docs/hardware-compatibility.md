---
id: hardware.compatibility
title: Hardware and OS Compatibility
description: Canonical device, panel, transport, host, and App Store compatibility matrix.
category: Specifications
locale: en
canonical: true
status: stable
owner: Hardware maintainers
reviewed: 2026-07-18
revision: 2026-07-18
source_of_truth: docs/hardware-compatibility.md
validators: [node scripts/build-design-system-viewer.mjs --check, bash esp32/robot/run.sh all]
translations: [ko, ja]
---

# Hardware and OS Compatibility

This is the source of truth for AgentDeck dashboard surfaces and their compatibility. A **surface** is any hardware, app, or terminal client that connects to the daemon hub and renders or controls agent state.

Reader translations: [한국어](../agentdeck-design-system/locales/ko/hardware-compatibility.md) · [日本語](../agentdeck-design-system/locales/ja/hardware-compatibility.md). English remains canonical; translations carry the same revision and must not introduce new facts.

## Ownership

| Fact | Canonical source |
|---|---|
| Cross-platform device, panel, transport, and compatibility data | This document |
| ESP32 flashing, pins, ports, provisioning, and OTA | [ESP32 operations](esp32.md) |
| Device protocol, discovery, and event handling | [Device transports](devices.md) |
| Android build and e-ink rendering | [Android](android.md) |
| App Store versus CLI feature gates | [App Store feature matrix](appstore-feature-matrix.md) |

Do not copy numeric specifications into domain guides. Link back to this matrix and keep operational detail in the owning guide.

## Support legend

| Mark | Meaning |
|:---:|---|
| Yes | Supported by the App Store Swift daemon or app |
| Partial | Supported with a stated limitation or pending hardware verification |
| CLI | Requires the external Node daemon or a CLI-managed transport |
| Experimental | Registration or firmware is under active development |

## Surface matrix

| Surface | Class | Platform / controller | Display | Transport | App Store |
|---|---|---|---|---|:---:|
| IPS 3.5 | ESP32 display | ESP32-S3 | AXS15231B IPS · 480×320 | USB serial · Wi-Fi WS | Yes |
| Round AMOLED 1.8 | ESP32 display | ESP32-S3 | ST77916 · 360×360 | USB serial · Wi-Fi WS | Yes |
| 86 Box 4.0 | ESP32 display | ESP32-S3 | ST7701 IPS · 480×480 | USB serial · Wi-Fi WS | Yes |
| TTGO T-Display 1.14 | ESP32 display | ESP32 classic | ST7789 · 135×240 | USB serial · Wi-Fi WS | Yes |
| Waveshare LCD 1.47 | ESP32 display | ESP32-C6 | ST7789 · 172×320 | USB serial · Wi-Fi WS | Yes |
| IPS 10.1 | ESP32 display | ESP32-P4 + C6 | JD9365 MIPI-DSI · 800×1280 | USB serial · Wi-Fi WS | Yes |
| Ulanzi TC001 | ESP32 LED | ESP32 classic | WS2812B · 32×8 | USB serial · Wi-Fi WS | Partial |
| InkDeck | ESP32 e-ink | XIAO ESP32-S3 Plus | UC8179 · 800×480 | Wi-Fi WS | Experimental |
| XTeink X3 | e-ink reader | ESP32-C3 | 3.7-inch · 528×792 | Wi-Fi WS | Experimental |
| XTeink X4 | e-ink reader | ESP32-C3 | 800×480 | Wi-Fi WS | Experimental |
| Divoom Pixoo64 | Commercial LED | Divoom controller | RGB LED · 64×64 | HTTP REST | Yes |
| iDotMatrix | Commercial pixel display | BLE SoC | RGB · 32×32 | BLE GATT | Yes |
| Divoom Timebox Mini | Commercial LED | BLE SoC | RGB LED · 11×11 | BLE GATT | Yes |
| Ulanzi D200H | HID deck | SigmaStar SSD210 | LCD keys · logical 960×540 | Ulanzi Studio plugin | Yes |
| Stream Deck | HID deck | Elgato | 15 LCD keys · 5×3 | Elgato plugin → WS | Yes |
| Stream Deck Mini | HID deck | Elgato | 6 LCD keys · 3×2 | Elgato plugin → WS | Yes |
| Stream Deck+ | HID deck | Elgato | 8 keys · 4 dials · touch strip | Elgato plugin → WS | Yes |
| macOS | App | Apple Silicon · Intel | Host display | In-process Swift daemon | Yes |
| iOS / iPadOS | App | A-series · M-series | Device display | Wi-Fi WS | Yes |
| Android e-ink | App | Vendor-specific | B&W or color e-ink | ADB localhost · mDNS | Partial |
| Android tablet | App | ARM · x86 | Color LCD | mDNS · Wi-Fi WS | Partial |
| TUI dashboard | Terminal | Host CPU | Truecolor terminal | WS | Yes |
| SSE stream | Protocol | Host | Browser or script | HTTP `/sse` | Partial |

`App Store` describes compatibility with the submitted Apple app and its Swift daemon, not whether third-party host software is bundled. Stream Deck and D200H still require their vendor applications.

## ESP32 board specifications

The AgentDeck firmware uses PlatformIO and Arduino. LVGL 9.2 drives LCD boards; TC001 uses FastLED; InkDeck uses its e-ink renderer. USB port names are not identities—probe `device_info_request` before flashing.

| Board | Friendly name | PlatformIO env | SoC | Panel / resolution | Flash | PSRAM | USB |
|---|---|---|---|---|---:|:---:|---|
| JC3248W535 | `ips_35` | `ips35` | ESP32-S3 | AXS15231B · 480×320 | 16 MB | Yes | Native USB JTAG |
| JC3636W518 | `amoled_18` | `amoled` | ESP32-S3 | ST77916 · 360×360 | 8 MB | Yes | Native USB JTAG |
| ESP32-S3-4848S040 | `box_40` | `box_86` | ESP32-S3 | ST7701 · 480×480 | 16 MB | Yes | CH340 |
| LilyGO T-Display | `tft_114` | `ttgo` | ESP32 classic | ST7789 · 135×240 | 16 MB | No | CH340 |
| Waveshare ESP32-C6-LCD-1.47 | — | `esp32_c6_147` | ESP32-C6 | ST7789 · 172×320 | 4 MB | No | Native USB CDC |
| JC8012P4A1C | `ips_101` | `ips10` | ESP32-P4NRW32 + C6 | JD9365 · 800×1280 | 16 MB | 32 MB | CH340 |
| Ulanzi TC001 | `led_8x32` | `led8x32` | ESP32 classic | WS2812B · 32×8 | 8 MB | No | CH340 |
| Seeed TRMNL 7.5 DIY Kit | `inkdeck` | `inkdeck` | XIAO ESP32-S3 Plus | UC8179 · 800×480 | 8 MB | Yes | Native USB |

Operational exceptions:

- `box_86` retains the legacy duplicate `rgb48` environment and is the current `default_envs` target.
- TTGO flashing uses 57,600 baud with `--no-stub`; its no-PSRAM renderer has a deliberately small buffer.
- IPS 10.1 uses a 16 MB dual-OTA layout with 6 MB slots and requires internal-memory LVGL buffers. Its ESP32-C6 is the Wi-Fi coprocessor.
- Existing factory or old-partition 86 Box and IPS 10.1 units require one USB full flash before OTA.
- XTeink X3/X4 run the external CrossPoint Reader fork, not the `esp32/` PlatformIO project. Their wire contract is [ESP32 client contract](esp32-client-contract.md).

## Pixel displays and control decks

| Device | Rendering / ownership constraint |
|---|---|
| Pixoo64 | LAN HTTP REST; no supported raw-frame BLE path. AgentDeck throttles frame pushes and recovers from device-side timeouts. |
| iDotMatrix | Native 32×32 composition over BLE. The daemon owns one BLE display connection at a time. |
| Timebox Mini | Dedicated 11×11 Agent Beacon over ISSC BLE GATT. It shares the single BLE connection budget with iDotMatrix. |
| TC001 | Self-rendering serial/Wi-Fi board. App Store status is Partial only because the Swift `led8x32` path awaits hardware verification; this is not a sandbox restriction. |
| D200H | Ulanzi Studio plugin is the only driver. Direct-HID implementations are retired. |
| Stream Deck family | One plugin provides bundled profiles for standard, Mini, and Plus. XL grid calculation exists, but no XL profile ships. |

## Software platforms

| Platform | Minimum / toolchain | Connection model | Constraint |
|---|---|---|---|
| macOS | macOS 26 · Xcode 26.6 · Swift 6 | In-process Swift daemon on port 9120 | App Store sandbox; no subprocesses or bundled interpreter |
| iOS / iPadOS | iOS 17 · Swift 6 | Bonjour + same-LAN WS | Client only; no direct hardware modules |
| Android | minSdk 29 · target/compileSdk 34 · JDK 17 | ADB localhost first, then mDNS | ADB reverse is CLI-only; same-LAN discovery is sandbox-safe |
| Node bridge | Node.js 22+ | Daemon on port 9120 | Supported on macOS and Windows 11; Linux is not an official host |

Android e-ink uses vendor-native refresh controls: Crema and MOAAN use `EinkManager`, Onyx uses its update-mode API, Bigme uses a color palette path, and Kobo falls back to invalidation. Android and Apple share the wire protocol; their render and discovery layers remain platform-native.

## Protocol surfaces

| Surface | Contract | Limitation |
|---|---|---|
| TUI | WS client, truecolor ANSI, responsive at 60/80/120 columns | Push-only view |
| SSE | `GET /sse` on daemon port 9120 | Full streaming and heartbeats exist in the Node bridge. The Swift daemon currently sends only the initial `connected` event. |

## Change checklist

1. Update the owning row here before changing a public device count or compatibility claim.
2. Update the domain guide only for operational behavior; do not duplicate specifications.
3. Update the matching KR and JP translation revision without adding translation-only facts.
4. Run the frontmatter/catalog validator and the relevant runtime or hardware suite.
5. Keep the GitHub Pages viewer generated from these sources; never hand-edit generated viewer content.
