# AgentDeck launch recording runbook

This runbook separates App Store metadata from broader launch marketing. The
same deterministic scenario powers both, so the app and terminal footage tell
one coherent story without exposing a real project, account, path, token, or
network address.

## Decision

Do not add a shipping simulation feature to AgentDeck. The app already has a
Debug-only WebSocket capture path, and the repository has a static screenshot
mock. A developer-only performance harness is safer because it:

- exercises the real dashboard parser and SwiftUI views;
- cannot appear as a hidden or dormant App Store feature;
- never launches a coding agent or modifies a workspace;
- gives every take the same timing and privacy-safe content;
- leaves the existing static screenshot captures reproducible.

`scripts/appstore-demo-orchestrator.mjs` adds a looping 60-second performance
with Claude Code, Codex, and OpenCode. `scripts/record-feature-demo.sh` starts
the feed and, for marketing footage, a synchronized three-pane fictional
terminal replay.

## The cycle

Every cycle opens **cold** — a connected daemon with zero sessions — and then
introduces one agent at a time, which is what a real machine looks like as a
developer starts working. All timings are relative to the shared epoch, so the
app feed and the terminal panes always agree.

| Time | Dashboard | Terminal panes |
|---:|---|---|
| 0–4s | Empty state; no sessions | All three blank |
| 4s | **Claude appears** — reading, then editing | Claude pane opens |
| 9s | Claude tool row (`Edit · MonitorScreen.swift`) | Editing line |
| 14s | **Codex appears** — running the test suite; Codex quota gauge lights up at 41% | Codex pane opens |
| 19s | Claude completes and goes idle | `✓ Dashboard polish complete` |
| 24s | **OpenCode appears** — drafting release notes | OpenCode pane opens |
| 30s | Claude enters the amber attention state | `Permission required` |
| 36s | Attention clears; Claude applies the change | `Permission granted` |
| 41s | Codex completes; quota ticks to 47% | `✓ 1842 tests passed` |
| 46s | OpenCode completes | `✓ Release notes are ready` |
| 51–60s | All three idle; creatures settle to the floor | Panes at rest |

### Quota gauges: Codex only, on purpose

The cycle emits a `usage_update` carrying **Codex rolling-window limits only**
(5h primary climbing 41 → 44 → 47%, 7d secondary 23 → 24%, ChatGPT Plus). The
Claude `fiveHourPercent` / `sevenDayPercent` fields are deliberately absent.

This is not a shortcut — it is what the App Store build actually shows.
`TopologyRail.rateLimitChips` gates Claude's gauges on
`daemonService.isUsingExternalDaemon`, because they need OAuth token and relay
data the sandboxed app cannot produce alone; the Codex gauges sit outside that
gate because the Swift daemon reads `~/.codex` directly. A preview showing a
populated Claude quota row would depict a capability the shipped app does not
have without the separately-installed Node daemon.

Verify the shape of a run without the app at all:

```bash
node scripts/appstore-demo-orchestrator.mjs serve --port 9221
```

## Story A — App Store Preview (app UI only, ≤30 seconds)

Apple App Review Guideline 2.3.4 permits only screen capture of the app itself
in an App Preview. Do not show Terminal, tmux, Xcode, browser chrome, a desktop,
or a hardware camera shot in this asset. App Previews are also capped at 30
seconds, so **record the full 60-second cycle and trim** — do not try to make
the harness itself fit the limit.

The recommended cut is **0–30s**: it opens on an empty dashboard, fills up one
agent at a time, and lands on the amber attention state as the closing beat.

| Cut | Message |
|---|---|
| 0–4s | Nothing to manage yet |
| 4–14s | Your first agent shows up on its own |
| 14–24s | Every agent, one surface |
| 24–30s | Know exactly when a human is needed |

Use a frame around **26 seconds** as the poster frame: three sessions present,
two active, aquarium and timeline populated, no amber attention state yet.

Start the animated feed:

```bash
bash scripts/record-feature-demo.sh app-only
```

Launch an iOS Debug Simulator build with these arguments:

```text
-AgentDeckScreenshotURL ws://127.0.0.1:9220
```

Record at least one complete 60-second cycle, then trim in the editor. The
existing `apple/appstore-submission/previews/` files remain the current
upload-ready assets until a replacement passes
`validate-appstore-submission.sh`.

## Story B — launch film (website, social, press; 45–60 seconds)

This version may show the developer workflow because it is not an App Store
Preview.

| Time | Shot | Direction |
|---:|---|---|
| 0–4s | Empty dashboard beside three blank panes | “Nothing running yet.” |
| 4–14s | Claude pane opens; its card slides into the app | One agent, two surfaces, same instant |
| 14–24s | Codex then OpenCode join | Show the dashboard filling up, not a static grid |
| 24–30s | Split view: terminals + AgentDeck | Parallel work resolving into one surface |
| 30–36s | Tight crop on amber attention state | Human attention becomes the visual climax |
| 36–51s | Attention clears and agents complete | Show control without pretending the app approved it |
| 51–60s | Full AgentDeck hero frame, creatures at rest | End card: “Your agents. One calm control surface.” |

Start the synchronized terminal rehearsal:

```bash
bash scripts/record-feature-demo.sh marketing
```

The command creates a tmux session named `agentdeck-launch-demo`. It does not
run Claude, Codex, or OpenCode. The panes replay fictional output synchronized
to the same epoch as the app feed. In another Terminal window, launch the macOS
Debug app with:

```bash
open -n apple/DerivedData/Build/Products/Debug/AgentDeck.app --args \
  -AgentDeckScreenshotURL ws://127.0.0.1:9220
```

Stop everything with:

```bash
bash scripts/record-feature-demo.sh stop
```

## Capture rules

- Capture at 30 fps. App Store H.264 previews must be 15–30 seconds, progressive,
  at most 500 MB, and use a supported target resolution.
- Keep terminal text fictional. Never point the harness at a real repository.
- Do not show approval buttons in the observed Claude attention state; the
  faithful UI is display-only and says to respond in the terminal.
- Do not replace current upload assets until the new files pass:

```bash
bash apple/scripts/validate-appstore-submission.sh
```

- Verify the processed 5-second poster frame in App Store Connect.
