---
name: agentdeck-workflows
description: Use for AgentDeck build, dev-server, Stream Deck plugin, Android release, D200H preview, or Apple/Xcode diagnostic workflows. Reads the matching .agents/workflows file and follows it instead of guessing commands.
---

# AgentDeck Workflows

Use this skill when the user asks to build, run dev mode, link/package the Stream Deck plugin, build Android, preview D200H output, or debug an Apple/Xcode reproduction.

## Required Context

1. Read `CLAUDE.md` before running workflow commands.
2. Read the top of `DEVELOPMENT_LOG.md`, then search it for the subsystem you are touching instead of loading the full file.
3. Preserve App Store invariants from `CLAUDE.md` and `AGENTS.md` when touching Apple UI, daemon, setup, or diagnostics.

## Workflow Map

- Android release APK: read `.agents/workflows/build-android.md`.
- Stream Deck plugin build/link: read `.agents/workflows/build-plugin.md`.
- Dev watch mode: read `.agents/workflows/start-dev.md`.
- D200H preview: read `.agents/workflows/d200h-preview.md`.
- Apple/Xcode diagnostics: read `.agents/workflows/apple-xcode-debug.md`.

## Execution Rules

- Treat the workflow file as the canonical command sequence for that task.
- If a command requires network, GUI access, device access, or writes outside the workspace, request the scoped approval required by the current Codex sandbox.
- For Apple/Xcode diagnostics, capture repository-side diagnostics before editing code when the issue was reproduced from Xcode.
- Keep generated diagnostics under `diagnostics/`; do not commit them.
- Report which workflow file was used and the verification result.
