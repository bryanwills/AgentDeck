# Stream Deck+ Layout Reference

> **Superseded (historical reference).** This documents the retired **v3** layout. The current session-per-button model is [v4 Layout](v4-layout.md); rendering conventions live in [Plugin Conventions](plugin-conventions.md). Kept for the encoder/dial diagrams and v3→v4 migration context only.

Detailed reference for the Stream Deck+ button and encoder layout in AgentDeck v3.

---

## Utility Dial Modes (E1)

The Utility encoder supports multiple modes, switchable via touch (long press >=500ms):

| Mode | Rotate | Push | Display |
|------|--------|------|---------|
| **Volume** | Adjust output volume (+-5%) | Toggle mute | Volume % + bar |
| **Mic** | Adjust input volume (+-5%) | Toggle mute | Input level + bar |
| **Media** | Adjust volume | Play / Pause | Track + artist (Spotify / Music.app) |
| **Timer** | Adjust time (+-5 min) | Start / Pause / Reset | Countdown + bar |

## Action Dial Features (E2)

- **IDLE**: Cycles through prompt templates (rotate) and sends on push. If Claude Code shows a ghost text suggestion (autocomplete), it appears as the first prompt option
- **Interactive**: Scrolls options (rotate) and confirms selection (push). For navigable prompts with `>` cursor, arrow keys move the cursor in the PTY

## Voice Dial Features (E4)

- **Recording**: Hold push to record, release to transcribe. Pulsing red indicator with waveform animation
- **Voice Text Takeover**: After transcription, the text spans all 4 encoder LCDs (wide canvas, adaptive font 48->16px). Short push (<500ms) = send to Claude, long push (>=500ms) = cancel
- **Offline-first**: Recording works even when bridge is disconnected — text is pasted via clipboard

---

## Semantic Button Colors

Permission and diff response buttons are automatically color-coded by intent:

| Color | Hex | Meaning | Matched by |
|-------|-----|---------|------------|
| Green | `#166534` | Approve | shortcut `y`/`a`, or label starts with *Yes* / *Allow* / *Apply* |
| Red | `#991b1b` | Deny | shortcut `n`/`d`, or label starts with *No* / *Deny* |
| Blue | `#1e40af` | Permanent | label starts with *Always*, or contains *Don't ask again* / *Allow all sessions* |
| Teal | `#1e3a5f` | Other | Default for unrecognized options |

Option buttons (non-permission) use teal `#1e3a5f` by default, green `#1e4d2b` for recommended options.

---

## Per-State Layout

Slots 3-6 (quick actions) and slot 7 (stop/escape) reconfigure based on agent state. Slots 0-2 (Mode, Session, Usage) always remain in place.

### IDLE — waiting for user input

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |  GO ON   |  <- teal
+----------+----------+----------+----------+
| REVIEW   | COMMIT   |  CLEAR   |   ESC    |  <- slate, dim ESC
+----------+----------+----------+----------+
```

| Slot | Default Label | Color | Action |
|------|---------------|-------|--------|
| 3 | GO ON | teal `#1e3a2f` | Send `continue` prompt |
| 4 | REVIEW | slate `#1e293b` | Send `/review` |
| 5 | COMMIT | slate `#1e293b` | Send `/commit` |
| 6 | CLEAR | slate `#1e293b` | Send `/clear` |
| 7 | ESC | dim `#3d2607` | Send escape key |

All four quick-action labels and commands are customizable per-instance via the Stream Deck Property Inspector.

### PROCESSING — agent working

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |  START   |  <- blue
+----------+----------+----------+----------+
| REVIEW   | COMMIT   |  CLEAR   |  STOP    |  <- greyed out, red STOP
+----------+----------+----------+----------+
```

| Slot | Label | Color | Action |
|------|-------|-------|--------|
| 3 | START | blue `#0f3460` | Open project picker, spawn parallel `agentdeck claude` session |
| 4-6 | *(idle labels, greyed out)* | dim `#1a1a1a` | Disabled — labels remain visible but inactive |
| 7 | **STOP** | red `#cc0000` | Send Ctrl+C interrupt |

START appears only on slots with a `disconnectedAction` configured (default: slot 3 runs `agentdeck claude`).

### AWAITING_PERMISSION — tool/file approval prompt

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |   YES    |  <- green
+----------+----------+----------+----------+
|   NO     | ALWAYS   | DON'T... |   ESC    |  <- red, blue, blue, orange
+----------+----------+----------+----------+
```

Up to 4 options from the bridge, each auto-colored by semantic matching (see color table above). A typical Claude Code permission prompt shows: *Yes, allow once* (green) / *No, deny* (red) / *Always allow* (blue) / *Don't ask again for this tool* (blue). If the bridge sends no structured options, the fallback is hardcoded YES / NO / ALWAYS.

| Slot | Color rule | Action |
|------|------------|--------|
| 3-6 | Semantic (green / red / blue / teal) | `respond:{shortcut}` |
| 7 | ESC — orange `#b45309` | Cancel prompt |

### AWAITING_OPTION — multi-choice selection (<=4 options)

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |  Opt 1   |  <- teal (green if recommended)
+----------+----------+----------+----------+
|  Opt 2   |  Opt 3   |  Opt 4   |   ESC    |  <- teal, orange ESC
+----------+----------+----------+----------+
```

### AWAITING_OPTION — multi-choice selection (5+ options)

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |  Opt 1   |
+----------+----------+----------+----------+
|  Opt 2   |  Opt 3   | MORE ▼   |   ESC    |  <- gray MORE, orange ESC
+----------+----------+----------+----------+
```

Badges: ★ on recommended option (green `#1e4d2b`), ✓ on currently selected. MORE ▼ (gray `#334155`) triggers encoder takeover — wide-canvas LCD across E2-E4 shows the full scrollable list.

### AWAITING_DIFF — file edit review

```
+----------+----------+----------+----------+
|  MODE    | SESSION  |  USAGE   |  APPLY   |  <- green
+----------+----------+----------+----------+
|  DENY    |  VIEW    |  (dim)   |   ESC    |  <- red, teal, orange ESC
+----------+----------+----------+----------+
```

Same semantic coloring as permission. Fallback if no options from bridge: APPLY (green) / DENY (red) / VIEW (teal).

### DISCONNECTED — no active session

```
+----------+----------+----------+----------+
|  (dim)   |  (dim)   |  USAGE   |  START   |  <- blue
+----------+----------+----------+----------+
|  (dim)   |  (dim)   |  (dim)   |  (dim)   |
+----------+----------+----------+----------+
```

| Slot | Label | Color | Action |
|------|-------|-------|--------|
| 3 | START | blue `#0f3460` | Open project picker, run `agentdeck claude` |
| 4-6 | — | dim `#1a1a1a` | Disabled |
| 7 | STOP | dim red `#3a1111` | Disabled |

START appears on any slot with `disconnectedAction` configured. Mode and Session dim; Usage remains active (independent render loop).

---

## Terminal Dial (E3) — iTerm Session Manager

| Action | Behavior |
|--------|----------|
| **Rotate** | Cycle through iTerm sessions + focus the selected window/tab |
| **Push** | Activate the selected session. If it's a detached tmux session, opens a new iTerm window and attaches |
| **Auto-switch** | When you focus an iTerm tab that belongs to an AgentDeck session, the bridge auto-switches to that session (2s polling) |

Detached tmux sessions from AgentDeck appear in the list with a plug prefix (e.g. `ViewLingo`). Pushing on these opens a new iTerm window and runs `tmux attach`.

The **Session button** long press also focuses the terminal — if the tmux session is detached, it auto-attaches in a new iTerm window.

---

## Encoder Takeover (Wide Canvas)

When Claude presents options, permissions, or diff prompts, the encoder LCDs switch to a **wide canvas** mode:

| Encoder | Panel | Content |
|---------|-------|---------|
| E1 | **Context** | State indicator (color-coded), question text, cursor position |
| E2-E4 | **Option List** | 600px-wide scrollable list with highlight, badges (★ recommended, ✓ selected), semantic colors |

Rotate E2 to scroll, push to confirm. The wide canvas auto-scrolls to keep the selected option visible. When the prompt is answered, all encoders restore to their normal displays.

---

## Button Label Intelligence

Permission and option labels can be long (e.g. "Yes, allow and don't ask again"). AgentDeck uses a 3-tier system to fit them on 144x144px buttons:

| Tier | Method | Latency | Example |
|------|--------|---------|---------|
| 1. **Pixel-aware wrap** | CJK-aware text measurement + multi-line wrap | Instant | "Yes, allow once" -> fits as-is |
| 2. **Local abbreviation** | Pattern-based heuristic (known phrases) | Instant | "Yes, I trust this folder" -> "Trust folder" |
| 3. **Haiku summarization** | `claude -p --model haiku` CLI fallback | ~1-3s | Unknown long label -> AI-shortened version |

- **CJK support**: Korean, Chinese, and Japanese characters are measured at double-width (1em vs 0.55em for Latin), preventing overflow on CJK labels
- **Haiku fallback**: Only triggers when tiers 1-2 fail. First render shows ellipsis (`...`), then re-renders with the AI summary once it arrives. Results are cached (200 entries) so repeated labels are instant
- **Abbreviated indicator**: Buttons that were shortened show a subtle `~` mark at the bottom-right corner
- **Wide canvas unaffected**: Encoder LCD option lists (E2-E4) have enough horizontal space to display full labels without abbreviation

> **Requirement**: Tier 3 (Haiku) requires Claude Code CLI (`claude`) installed and authenticated. Subscription accounts work — no separate API key needed.
