# Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plugin shows DISCONNECTED | Bridge not running | Run `agentdeck claude` |
| Plugin reconnects every 3s | Bridge crashed | Restart `agentdeck claude` |
| Bridge enters disconnected state | Claude process exited | Restart `agentdeck claude` |
| State tracking not working | Hook server unreachable | Verify `agentdeck` is running |
| Stream Deck buttons inactive | Hardware not connected | Reconnect + restart app |
| Stuck in PROCESSING > 5 min | Agent stalled | STOP button or Ctrl+C in terminal |
| Voice transcription returns empty | Speech recognition permission denied, or OS dictation model still downloading | macOS Settings → Privacy & Security → Speech Recognition → enable AgentDeck. First-time recognition may wait ~30s while the OS finishes the on-device model download |
| Plugin not in Stream Deck app | Plugin not linked | Restart Stream Deck app, then `cd plugin && streamdeck link bound.serendipity.agentdeck.sdPlugin` |
| Hooks not firing | Hooks not installed or stale | `node hooks/dist/install.js` (re-installs all 7 hooks) |
| Need to remove hooks | Uninstalling AgentDeck | `node hooks/dist/install.js uninstall` |
| Plugin loads but buttons blank | Plugin needs rebuild | `pnpm build && pnpm generate-icons`, restart Stream Deck app |
| Android app can't find bridge | mDNS blocked on network | Use QR pairing (`agentdeck qr`) or enter IP manually in Settings |
| Android shows "Not Connected" | Bridge not reachable | Verify same LAN; for USB: `adb reverse tcp:9120 tcp:9120` then connect to 127.0.0.1:9120 |
| E-ink ghosting on Crema | Missing full GC16 refresh | State transitions trigger full refresh automatically; force refresh by toggling bridge connection |
| `posix_spawnp failed` | Prebuilt node-pty binary incompatible with Node version | `cd $(npm root -g)/@agentdeck/bridge/node_modules/node-pty && npx node-gyp rebuild` |

## tmux -CC Compatibility

When using iTerm2's `tmux -CC` (control mode): run `agentdeck claude` inside a tmux window. The bridge manages its own PTY, so there's no conflict.

Signal chain: `tmux → iTerm2 → agentdeck → bridge PTY → claude`

---
