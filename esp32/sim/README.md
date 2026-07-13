# ESP32 host simulator

Render **real** AgentDeck ESP32 board screens on your Mac/Linux host — no board,
no flashing. The simulator compiles the firmware's LVGL render surface (the
terrarium aquarium) against a host toolchain + LVGL's software renderer, into a
headless RGB565 framebuffer that is dumped to PNG.

Because it reuses the firmware sources **verbatim** with each board's build
defines (`SCREEN_W/H` + `BOARD_*`), the output is **pixel-exact** with what the
physical panel shows — it is that board's firmware minus hardware I/O, not a
hand-drawn approximation. This is the ESP32 counterpart to the Node preview tools
(`bridge/scripts/pixoo-preview.ts` et al.) that reuse the production Pixoo
renderer, and it removes the drift risk of the hand-mirrored Swift Device Preview
ESP32 tiles (`apple/.../UI/Preview/Devices/EinkEsp32Previews.swift`).

## Quick start

```bash
cd esp32/sim
./render.sh                 # all boards, all scenes → sim-out/*.png
./render.sh box_86          # one board, all scenes
./render.sh box_86 working  # one board, one scene
```

Requires PlatformIO (`pio`) — same tool the firmware uses. LVGL is fetched
automatically as a `lib_deps` (pinned to the firmware's `lvgl@^9.2.0`).

Under the hood:

```bash
pio run -e box_86                                       # build the host binary
.pio/build/box_86/program --all --outdir sim-out        # render every scene
.pio/build/box_86/program --scene working --out out.png # one frame
```

## Boards

| env      | board define   | resolution | notes                         |
|----------|----------------|------------|-------------------------------|
| `box_86` | `BOARD_BOX_86` | 480×480    | 86Box 4" — the flagship board |
| `ips35`  | `BOARD_IPS35`  | 480×320    | IPS 3.5" landscape            |
| `amoled` | `BOARD_AMOLED` | 360×360    | Round AMOLED (circular mask)  |

**Adding a board:** copy an env block in `platformio.ini` and set the target's
`BOARD_*` / `SCREEN_W` / `SCREEN_H` defines to match the real env in
`esp32/platformio.ini`. The display buffers are stride-aware, so widths that
aren't a multiple of 16 (TTGO 135/144, etc.) work without extra changes.

## Scenes

`empty` (pre-connection), `idle`, `working`, `multi` (Claude + Codex + OpenCode +
Antigravity + OpenClaw gateway crayfish), `permission` (awaiting → "?" bubble).
Scenes populate the same `g_state` the firmware fills from the daemon's
`state_update`, so they exercise the real session → creature derivation.

Frames are deterministic: the PRNG is re-seeded per run and the clock is virtual,
so `--out a.png` twice produces byte-identical PNGs (suitable for golden tests).

## How it fits together

```
sim/
  platformio.ini        # native envs (one per board) — NOT inheriting esp32/platformio.ini
  render.sh             # build + render wrapper
  shims/                # host stubs for the tiny hardware surface the render code touches
    Arduino.h           #   millis/micros/Serial/map/random/ps_malloc
    esp_heap_caps.h     #   heap_caps_* → malloc
    freertos/*.h        #   SemaphoreHandle_t + no-op mutex
  src/
    sim_main.cpp        # CLI: parse args, drive the render loop, dump PNG
    sim_display.cpp     # headless LVGL display → in-memory RGB565 framebuffer (stride-aware)
    png_writer.cpp      # RGB565 → PNG (self-contained: stored DEFLATE + CRC32/Adler32)
    mock_scenes.cpp     # named g_state presets
    sim_globals.cpp     # host defs of firmware globals (g_state, g_screenW/H, font_kr_12)
    fw/*.cpp            # unity-include wrappers → ../../src/ui/terrarium/*.cpp
```

The firmware terrarium sources are **never copied**: each `src/fw/<name>.cpp` is a
one-line `#include "../../../src/ui/terrarium/<name>.cpp"`. That pass-through
matters for correctness — compiling the firmware sources through the sim's own
`src/` gives each env a **per-env object dir** (`.pio/build/<env>/`) so board `#if`
branches (`IS_ROUND`, canvas format, `MAX_*`) take effect independently. Referencing
them via a `build_src_filter` `../..` path instead lands one shared
`.pio/build/src/` object that freezes those branches to whichever env built first
(e.g. the round AMOLED mask leaking onto rectangular boards).

## Scope / not yet covered

- **Terrarium only.** The HUD bar, IPS10 office/mosaic, TTGO overlay, matrix
  (TC001) and e-ink (InkDeck) render paths are not yet wired — they need their
  own thin shims for the widgets/screens layer. The terrarium is the animated
  surface the Swift previews hand-draw, so it was the highest-value first target.
- **Latin labels only.** The CJK fallback font isn't bundled; Korean session
  names would render as `.notdef` boxes (Latin labels are pixel-identical).
