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

`scripts/appstore-demo-orchestrator.mjs` adds a looping 24-second performance
with Claude Code, Codex, and OpenCode. `scripts/record-feature-demo.sh` starts
the feed and, for marketing footage, a synchronized three-pane fictional
terminal replay.

## Story A — App Store Preview (app UI only, 20–24 seconds)

Apple App Review Guideline 2.3.4 permits only screen capture of the app itself
in an App Preview. Do not show Terminal, tmux, Xcode, browser chrome, a desktop,
or a hardware camera shot in this asset.

| Time | AgentDeck UI | Message |
|---:|---|---|
| 0–3s | Aquarium and three sessions appear; Claude is editing | One view for every coding agent |
| 3–6s | Codex starts tests while Claude continues | Work continues in parallel |
| 6–11s | Claude completes; OpenCode begins release notes | See progress without changing context |
| 11–15s | Claude enters the amber attention state | Know exactly when a human is needed |
| 15–19s | Attention clears; tests and notes complete | Return to flow immediately |
| 19–24s | All three creatures settle to idle | Your agents, calmly orchestrated |

Use a frame around 5 seconds as the poster frame: it contains three sessions,
two active agents, the aquarium, and timeline without the more alarming amber
attention state.

Start the animated feed:

```bash
bash scripts/record-feature-demo.sh app-only
```

Launch an iOS Debug Simulator build with these arguments:

```text
-AgentDeckScreenshotURL ws://127.0.0.1:9220
```

Record the app itself for one complete 24-second cycle. The existing
`apple/appstore-submission/previews/` files remain the current upload-ready
assets until a replacement passes `validate-appstore-submission.sh`.

## Story B — launch film (website, social, press; 35–45 seconds)

This version may show the developer workflow because it is not an App Store
Preview.

| Time | Shot | Direction |
|---:|---|---|
| 0–4s | Three terminal panes, empty prompts | “Three agents. Three workstreams.” |
| 4–10s | Claude edits, Codex tests, OpenCode waits | Terminal lines begin at staggered cues |
| 10–16s | Cut to AgentDeck aquarium | Match the same active/idle states in the app |
| 16–22s | Split view: terminals + AgentDeck | Show parallel work resolving into one dashboard |
| 22–28s | Tight crop on amber attention state | Human attention becomes the visual climax |
| 28–34s | Attention clears and agents complete | Show control without pretending the app approved it |
| 34–40s | Full AgentDeck hero frame | End card: “Your agents. One calm control surface.” |

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
