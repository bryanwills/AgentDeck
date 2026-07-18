# AgentDeck — Ulanzi Studio Marketplace listing

## Version

`1.0.0`

## Description

AgentDeck turns the Ulanzi D200H Deck Dock into a live control surface for AI coding agents. Its dynamic session-first layout shows Claude Code, Codex, OpenCode, and OpenClaw activity, attention states, prompt choices, modes, stop controls, and usage while automatically reflowing across the D200H keys.

The plugin is a thin client and requires the free AgentDeck macOS app or AgentDeck daemon running locally on port 9120. It does not collect analytics, bundle a daemon, access USB HID directly, or modify shell configuration.

## Release notes

First public release for D200H. Includes dynamic session keys, multi-agent state and attention rendering, prompt steering, stop and mode controls, usage views, and reconnect behavior through the official Ulanzi Studio plugin runtime.

## Submission files

- Installable folder: `plugin-ulanzi/dist/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/`
- Upload archive: `dist/agentdeck-ulanzi-v1.0.0.zip`
- Verification guide: `plugin-ulanzi/VERIFY.md`
