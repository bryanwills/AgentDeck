# Configuration

What you can change, and where the file lives.

## Settings

Defaults ship in `config/default-settings.json` and are copied into your user
data directory on first run (`~/.agentdeck/settings.json`; the App Store macOS
app uses its container path — see CLAUDE.md → User data dir).

| Key | Default | Effect |
|-----|---------|--------|
| `bridgePort` | `9120` | Daemon hub port. Session bridges take 9121-9139. |
| `autoRestart` | `false` | Restart a session bridge when its agent exits. |
| `stuckTimeoutMs` | `300000` | How long PROCESSING may last before the session reads as stalled. |
| `reconnectIntervalMs` | `3000` | Client reconnect backoff. |
| `voiceLanguage` · `voiceAutoSend` · `whisperModel` | `ko` · `true` · `large-v3-turbo` | Dictation on the Apple app. See [Voice setup](voice-setup.md). |
| `llm.mlx.endpoint` · `llm.mlx.model` | `http://127.0.0.1:8800` · `null` | Local MLX server used by APME's judge. |
| `apme.*` | enabled, auto-tuning | Evaluation module — schema and semantics in [APME](apme.md). |

## Stream Deck Property Inspector

Only the **Launcher encoder (E4)** carries per-instance settings:
`claudeTarget`, `codexTarget`, `openclawTarget` — the working directory each
agent opens in.

The keypad has no per-button configuration. Every key is a `session-slot` whose
content is derived from live session state, and the detail-view quick actions
(GO ON / REVIEW / COMMIT / CLEAR) are defined by the shared layout engine in
`shared/src/d200h-layout.ts`, not by user settings. The earlier configurable
slots 3-6 belonged to the retired mode-dial keypad — see
[Retired and Experimental Surfaces](retired-surfaces.md).

## Prompt templates

`config/prompt-templates.json` holds labelled prompts:

```json
{
  "templates": [
    { "label": "Fix Bug", "prompt": "Please fix the bug described above" },
    { "label": "Test", "prompt": "Write tests for the changes made" }
  ]
}
```

The bridge resolves `send_prompt` commands of the form `__template:<index>`
against this file. **Nothing in the shipped UI emits that command today** — the
encoder that cycled templates was retired with the multi-mode dials, so editing
this file currently has no visible effect. It is documented because the file and
the bridge handler both still exist.
