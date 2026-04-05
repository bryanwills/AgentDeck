# TUI Dashboard

`agentdeck dashboard` — zero-dependency TUI monitoring via raw ANSI escape codes. WS client connects to running Daemon via `findDaemonPort()` (`daemon.json` → `sessions.json` fallback).

## Files (`bridge/src/tui/`)

- `ansi.ts` — ANSI helpers
- `gauge.ts` — Unicode block gauge
- `screen.ts` — alternate buffer, raw stdin
- `terrarium.ts` — braille aquarium animation
- `renderer.ts` — adaptive layout
- `dashboard.ts` — WS client + state + render loop

## Responsive layouts

Three responsive layouts: wide (120+), standard (80-119), narrow (60-79).

## Terrarium

3-tier sprite scaling (small=1×/large=2×/xlarge=3× via `scaleGridN()`; thresholds: large 100×20, xlarge 160×35).

### Sprite sizes

- Braille octopus: small 14×5→7×2, large 28×10→14×3, xlarge 42×15→21×4
- Crayfish: small 16×8→8×2, large 32×16→16×4, xlarge 48×24→24×6
- Neon tetra: small 3ch, large 5ch, xlarge 7ch
- Jellyfish/Codex CLI: small 10×8→5×2, large 20×16→10×4, xlarge 30×24→15×6; 6-lobe cloud shape matching Codex icon, indigo #6366F1, glow #A5B4FC

### Crayfish ROUTING

Signal wave rings (3 concentric `◦·∙` semicircles) + orbiting cyan `✦` dots.

### Naming

Octopus name tag + crayfish name tag directly above sprite (`oy-1`). Multi-session octopi matched by session `id` (not `name`) — same-project sessions numbered `#1 #2`.

### Tetra attraction priority

Processing octopus > processing jellyfish > routing crayfish > none.

## Sessions & status

- Session list from daemon `sessions_list`; virtual OpenClaw entry when `gatewayAvailable`
- Half-block pixel font logo (4×6→4×3)
- Status split: LIMITS|MODELS (E-ink style)
- Local timeline generation from `state_update` events (`receivingBridgeTimeline` flag for bridge event dedup)
- 10fps terrarium, 4fps panels
