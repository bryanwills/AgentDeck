---
name: sdc-diagnose
description: Diagnose AgentDeck Stream Deck/PTY option synchronization, cursor state, hook ingestion, and bridge state-machine issues. Collects diagnostics, searches known failure patterns, adds focused regression tests, and verifies with pnpm tests.
---

# AgentDeck Diagnostic Skill

Use this skill for AgentDeck bridge synchronization issues between device displays and agent terminals, especially cursor desync, false idle, stale options, action dispatch races, hook ingestion gaps, or state-machine regressions.

## Collect Data

From the repo root:

```bash
agentdeck diag --tail 500
```

If the bridge is not running, inspect local journal/log files when available:

```bash
ls -la ~/.agentdeck/journal/
ls -t ~/.agentdeck/journal/*.jsonl | head -1 | xargs tail -500
tail -200 /tmp/sdc-debug.log
```

If these commands fail because of sandboxing or access to user-local files, request scoped approval before relying on guesses.

## Known Patterns

- Cursor desync: `navigate_option` followed by stale `cursor_update`.
- False idle: `option_prompt` followed by `idle` within 500 ms.
- Stale options: `option_prompt` with missing or non-contiguous indices.
- Action dispatch race: `select_option` overlapping rapid state transitions.
- ANSI cursor invisible: terminal keyboard input without cursor update for more than 500 ms.
- Codex hook gap: missing `codex_user_prompt_submit`, `codex_tool_start`, `codex_tool_end`, or `codex_stop` in daemon hook logs.

## Regression Tests

Add focused tests near the subsystem under change:

- Parser/state-machine issues: `bridge/src/__tests__/cursor-sync.test.ts`, `state-machine.test.ts`, or parser tests.
- Codex hook issues: `hooks/src/__tests__/codex-install.test.ts`, `bridge/src/__tests__/state-machine.test.ts`, or Codex APME adapter tests.
- Apple timeline/rendering issues: `apple/AgentDeckTests/`.

## Verification

Run the narrowest useful tests first, then broaden when shared behavior changed:

```bash
pnpm test
pnpm -r exec tsc --noEmit
```

Report findings with issue pattern, evidence, changed tests, and verification result.
