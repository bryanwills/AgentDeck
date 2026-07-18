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

`scripts/appstore-demo-orchestrator.mjs` adds a looping 30-second performance
with Claude Code, Codex, and OpenCode. `scripts/record-feature-demo.sh` starts
the feed and, for marketing footage, a synchronized three-pane fictional
terminal replay.

## The cycle

Every cycle opens **cold** — a connected daemon with zero sessions — and then
introduces one agent at a time, which is what a real machine looks like as a
developer starts working. The whole arc fits in 28s because an App Preview may
not exceed 30 seconds.

| Time | Dashboard | Terminal panes |
|---:|---|---|
| 0–2.5s | Empty state; no sessions | All three blank |
| 2.5s | **Claude appears** — reading, then editing | Claude pane opens |
| 8s | **Codex appears**; Codex quota gauge lights up (7d, 78%) | Codex pane opens |
| 11s | Claude completes and goes idle | `✓ Dashboard polish complete` |
| 13.5s | **OpenCode appears** — drafting release notes | OpenCode pane opens |
| 16.5s | Claude enters the amber attention state | `Permission required` |
| 20s | Attention clears; Claude applies the change | `Permission granted` |
| 22.5s | Codex completes; quota ticks to 80% | `✓ 1842 tests passed` |
| 24.5s | OpenCode completes | `✓ Release notes are ready` |
| 26.5–30s | All three idle; creatures settle to the floor | Panes at rest |

### Quota gauges: Codex only, on purpose

The cycle emits a `usage_update` carrying **one Codex weekly window**
(7d, 78 → 80%, ChatGPT Plus) — what a real machine reports once the 5h window
has reset. The Claude `fiveHourPercent` / `sevenDayPercent` fields are
deliberately absent.

This is not a shortcut — it is what the App Store build actually shows.
`TopologyRail.rateLimitChips` gates Claude's gauges on
`daemonService.isUsingExternalDaemon`, because they need OAuth token and relay
data the sandboxed app cannot produce alone; the Codex gauges sit outside that
gate because the Swift daemon reads `~/.codex` directly. A preview showing a
populated Claude quota row would depict a capability the shipped app does not
have without the separately-installed Node daemon.

## Producing the submission assets

Both scripts start the feed with an epoch in the **future** and launch the app
fresh against it. Recording an already-looping feed does not work: the previous
cycle's last session card survives the empty phase, so the cold open reads as
"one idle session" rather than "nothing running yet".

```bash
bash scripts/record-appstore-previews.sh macos    # → previews/macOS/agentdeck-preview.mp4
bash scripts/record-appstore-previews.sh iphone   # → previews/iPhone/…
bash scripts/record-appstore-previews.sh ipad     # → previews/iPad/…

bash scripts/capture-appstore-screenshots.sh macos    # → screenshots/macOS/01-fleet, 02-attention, 03-complete
bash scripts/capture-appstore-screenshots.sh iphone
bash scripts/capture-appstore-screenshots.sh ipad

bash apple/scripts/validate-appstore-submission.sh
```

Output is already encoded to everything the validator enforces: H.264 High,
level 4.0, progressive, 30 fps, 28s, 10–12 Mbps, and the exact per-platform
dimensions (macOS 1920×1080, iPhone 886×1920, iPad 1200×1600). Screenshots come
out at native capture size — macOS 2880×1800 from a 1440×900 logical window,
iPhone 1320×2868, iPad 2064×2752 — with the alpha channel flattened, which the
App Store rejects.

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

The whole cycle is already under the limit, so the recorded 28s clip **is**
the preview — no trimming step.

| Cut | Message |
|---|---|
| 0–2.5s | Nothing to manage yet |
| 2.5–13.5s | Your agents show up on their own, one at a time |
| 13.5–16.5s | Every agent, one surface |
| 16.5–20s | Know exactly when a human is needed |
| 20–28s | Back to flow; everything lands |

Use the **`02-attention`** screenshot beat (cycle t=18.8s) as the poster frame
candidate on macOS.

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
| 0–2.5s | Empty dashboard beside three blank panes | “Nothing running yet.” |
| 2.5–8s | Claude pane opens; its card slides into the app | One agent, two surfaces, same instant |
| 8–16.5s | Codex then OpenCode join | Show the dashboard filling up, not a static grid |
| 16.5–20s | Tight crop on amber attention state | Human attention becomes the visual climax |
| 20–26.5s | Attention clears and agents complete | Show control without pretending the app approved it |
| 26.5–30s | Full AgentDeck hero frame, creatures at rest | End card: “Your agents. One calm control surface.” |

For a longer film, record two consecutive cycles and cut between them.

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
