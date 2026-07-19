# AgentDeck — Elgato Marketplace listing

Submission target: **https://maker.elgato.com** (Maker Console → Publish).

## Store asset requirements

Per [Product Guidelines](https://docs.elgato.com/guidelines/products/), checked
against our files on 2026-07-20.

| Slot | Spec | Our file | ✓ |
|---|---|---|---|
| App icon | 288×288 PNG | `marketplace/elgato/1.0.0/app-icon-288.png` | 288×288 |
| Thumbnail | 1920×960 PNG | `marketplace/elgato/1.0.0/thumbnail-1920x960.png` | 1920×960 |
| Gallery | 1920×960 PNG, **min 3**, max 10 | the three `gallery-*.png` | 3 × 1920×960 |
| Gallery video (optional) | 1920×1080 MP4, <250 MB | `apple/appstore-submission/previews/macOS/agentdeck-preview.mp4` | 1920×1080, 28s, 37 MB |
| Product name | ≤30 chars | `AgentDeck` | 9 |
| Description | 250–1,500 chars | below | 948 |

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

AgentDeck is a thin client: it needs the free AgentDeck app for Mac (App Store), or the AgentDeck CLI, running on the same machine. It does not embed a daemon, collect analytics, or modify your shell configuration.

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

## Known asset-pipeline gap

`scripts/generate-elgato-marketplace-assets.mjs` no longer runs: it reads
`apple/appstore-submission/screenshots/macOS/{01-device-preview,02-apme-on-device,03-integrations}.png`,
but the screenshots moved under per-locale directories and were renamed
(`screenshots/en/macOS/01-fleet.png` …). The committed assets above are valid
and were produced before that move, so this does not block submission — but the
gallery cannot currently be regenerated from source. Repoint the script the next
time these assets are refreshed.
