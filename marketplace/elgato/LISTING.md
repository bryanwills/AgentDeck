# AgentDeck — Elgato Marketplace listing

Submission target: **https://maker.elgato.com** (Maker Console → Publish).

## Store asset requirements

Per [Product Guidelines](https://docs.elgato.com/guidelines/products/), checked
against our files on 2026-07-20.

| Slot | Spec | Our file | ✓ |
|---|---|---|---|
| App icon | 288×288 PNG | `marketplace/elgato/1.0.0/app-icon-288.png` | 288×288 |
| Thumbnail | 1920×960 PNG | `marketplace/elgato/1.0.0/thumbnail-1920x960.png` | 1920×960 |
| Gallery | 1920×960 PNG, **min 3**, max 10 | `gallery-01-session-keys.png` · `gallery-02-dials.png` · `gallery-03-hardware.png` | 3 × 1920×960 |
| Gallery video (optional) | 1920×1080 MP4, <250 MB | `apple/appstore-submission/previews/macOS/agentdeck-preview.mp4` | 1920×1080, 28s, 37 MB |
| Product name | ≤30 chars | `AgentDeck` | 9 |
| Description | 250–1,500 per guidelines; console field allows 4000 | below | see check |

Plugin package: `dist/bound.serendipity.agentdeck.streamDeckPlugin` — rebuild with
`pnpm package`, which runs Elgato's `streamdeck validate` before packing.

## Version

`1.0.0.0` (product version `1.0.0`) — Stream Deck requires the 4-part form;
`scripts/verify-version-sync.mjs` pins it to `<VERSION>.0`.

## Platform

**macOS 26.0+ only.** The Windows entry was dropped for 1.0.0 (`f20af561`):
the Volume and Launcher dials are `osascript` / `open -a`, so a Windows build
would have shipped two dead dials. The Node.js bridge itself does run on
Windows — this is a plugin-surface decision, not a bridge limitation.

## Description

```
AgentDeck turns Stream Deck and Stream Deck + into a live control surface for AI coding agents.

Session keys show Claude Code, Codex, OpenCode, and OpenClaw sessions at a glance — which one is running, which one is waiting on you, what tool it just called. Press a key to focus a session, pick a prompt option, toggle its mode, or stop it. Dials cover Claude and Codex usage with reset countdowns, system volume, and a launcher for your agent apps.

Profiles for Stream Deck, Stream Deck Mini, and Stream Deck + are bundled and install automatically.

Getting set up
AgentDeck is a thin client — it needs the free AgentDeck daemon running on the same Mac. Install it from a terminal:

    npx @agentdeck/setup

That is the whole setup. Start Claude Code, Codex, or OpenCode as you normally would and your sessions appear on the keys. (An AgentDeck app for Mac is also on the way through the App Store, which will remove the terminal step.)

The plugin does not embed a daemon, collect analytics, or modify your shell configuration.

AgentDeck is an independent project and is not affiliated with or endorsed by Elgato, Anthropic, OpenAI, or any other third party mentioned. All trademarks belong to their owners.
```

## Release notes

```
First public release.

• Session keys for Claude Code, Codex, OpenCode, and OpenClaw with distinct running / waiting states
• Prompt steering, mode toggle, and stop from the key
• Stream Deck + dials: Claude usage, Codex usage, volume, launcher
• Bundled profiles for Stream Deck, Stream Deck Mini, and Stream Deck +
• Automatic reconnect with an explicit OFFLINE state when no daemon is running
```

## Links

- Product: https://puritysb.github.io/AgentDeck/
- Support: https://github.com/puritysb/AgentDeck/issues
- Privacy: https://puritysb.github.io/AgentDeck/#privacy

## Submission files

- Plugin: `dist/bound.serendipity.agentdeck.streamDeckPlugin`
- App icon: `marketplace/elgato/1.0.0/app-icon-288.png`
- Thumbnail: `marketplace/elgato/1.0.0/thumbnail-1920x960.png`
- Gallery: the three `marketplace/elgato/1.0.0/gallery-*.png` files
- Optional gallery video: `apple/appstore-submission/previews/macOS/agentdeck-preview.mp4`

## Gallery sources

The gallery shows the plugin on Stream Deck hardware rather than the Mac app.
Sources live in `docs/media/` and are 2026-07-20 captures of the shipped 1.0.0
layout:

| File | Source |
|---|---|
| `gallery-01-session-keys.png` | `streamdeck-keys-app.png` — Stream Deck app, 15-key grid |
| `gallery-02-dials.png` | `streamdeck-plus-app.png` — Stream Deck + keys, touch strip, dials |
| `gallery-03-hardware.png` | `streamdeck-plus-hw.jpg` — the physical deck running live sessions |

**Do not reuse `docs/media/hardware-d200h-tc001-closeup.png` for Stream Deck
imagery.** Its touch strip reads VOL / PROMPT / USAGE / VOICE, and the Voice and
Prompt dials were removed in `f20af561` — it advertises features that no longer
ship. The same applies to any capture predating that commit.

Sources are modest resolution (910×548 / 794×560 app captures, 1280×960 photos),
so the generator composes each near native scale on an ink-tide canvas instead of
upscaling to fill 1920×960.
