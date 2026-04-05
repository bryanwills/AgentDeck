# v4 Layout (0.4.0) — Session-Per-Button

**Manifest actions** (5 total): `session-slot` (Keypad ×8) + 4 encoders (`option-dial`, `voice-dial`, `utility-dial`, `usage-dial`). v3 keypad actions (mode/session/usage/response/stop) removed. Usage dial UUID kept as `iterm-dial` for profile backward compat.

## Keypad (8 slots, all `session-slot`)

List view: each button = one session (OpenClaw first, then coding agents by port). Detail view (press to enter):

| Slot | List View | Detail View |
|------|-----------|-------------|
| 0 | Session 1 | BACK |
| 1 | Session 2 | Session Info (project+model+state+watermark) |
| 2-3 | Session 3-4 | Content (options/presets) |
| 4 | Session 5 | ESC/STOP (always visible, state-aware dimming) |
| 5-6 | Session 6-7 | Content (options/presets) |
| 7 | NEXT (paginate) | NEXT (5+ options) or empty |

No daemon: slot 0 = **▶ START** (launches AgentDeck Dashboard app), rest dark.

**OpenClaw presets** (detail view, IDLE/PROCESSING): STATUS, MODEL (dynamic model name + switch), GATEWAY (browser).

## Encoders (4 slots)

| E# | Action | Rotate | Push | Touch |
|----|--------|--------|------|-------|
| E1 | Utility | Adjust value | Toggle/Action | Switch mode |
| E2 | Action | Scroll options / cycle prompts | Send prompt / Confirm | Same as push |
| E3 | Usage | Cycle pages (overview/5h/7d/session/extra) | Refresh usage data | Next page |
| E4 | Voice | Scroll text | Hold=record, tap(<500ms)=cancel, VT push=send/paste | — |

## v4 Changes from v3

- **Session-per-button**: All 8 keypad slots use `session-slot` action (v3 individual actions removed)
- **v3 actions removed**: mode-button, session-button, usage-button, response-button, stop-button, expanded-actions
- **Detail view**: Press session → BACK + INFO + options/presets + ESC/STOP layout
- **OpenClaw presets**: STATUS, MODEL (dynamic name + switch animation), GATEWAY (browser launch)
- **Agent watermark**: `dimColor()` approach — high opacity + muted tones for visible but non-intrusive marks
- **State-aware ESC/STOP**: Active=bright, idle=dimmed, always accessible
- **No-daemon START**: ▶ START button launches macOS app (replaces "agentdeck daemon start" text)
- **Plugin icon**: Monochrome terrarium+octopus SVG (transparent bg, white — SD convention)
