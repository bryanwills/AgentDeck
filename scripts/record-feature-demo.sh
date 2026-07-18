#!/bin/bash
# Repeatable AgentDeck launch-recording rehearsal.
#
# Usage:
#   bash scripts/record-feature-demo.sh app-only
#   bash scripts/record-feature-demo.sh marketing
#   bash scripts/record-feature-demo.sh stop

set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-marketing}"
PORT="${AGENTDECK_DEMO_PORT:-9220}"
SESSION="agentdeck-launch-demo"
RUNTIME_DIR="${TMPDIR:-/tmp}/agentdeck-launch-demo"
PID_FILE="$RUNTIME_DIR/server.pid"
EPOCH_FILE="$RUNTIME_DIR/epoch-ms"
LOG_FILE="$RUNTIME_DIR/server.log"

mkdir -p "$RUNTIME_DIR"

stop_demo() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
  fi
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(sed -n '1p' "$PID_FILE")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
    fi
    rm -f "$PID_FILE"
  fi
}

if [ "$MODE" = "stop" ]; then
  stop_demo
  echo "AgentDeck launch demo stopped."
  exit 0
fi

if [ "$MODE" != "app-only" ] && [ "$MODE" != "marketing" ]; then
  echo "Usage: bash scripts/record-feature-demo.sh {app-only|marketing|stop}" >&2
  exit 2
fi

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
if [ "$MODE" = "marketing" ]; then
  command -v tmux >/dev/null || { echo "tmux is required for marketing mode" >&2; exit 1; }
fi

stop_demo

# Start far enough in the future for the app and tmux panes to connect before
# the first cue. Every participant receives the same epoch.
EPOCH_MS="$(( $(date +%s) * 1000 + 3500 ))"
echo "$EPOCH_MS" > "$EPOCH_FILE"
node scripts/appstore-demo-orchestrator.mjs serve \
  --port "$PORT" \
  --epoch-ms "$EPOCH_MS" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

cleanup_on_error() {
  local status=$?
  if [ "$status" -ne 0 ]; then stop_demo; fi
  exit "$status"
}
trap cleanup_on_error EXIT

sleep 0.4
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Demo server failed to start:" >&2
  sed -n '1,80p' "$LOG_FILE" >&2
  exit 1
fi

trap - EXIT

echo "Animated app feed: ws://127.0.0.1:$PORT"
echo "Launch a Debug build with:"
echo "  -AgentDeckScreenshotURL ws://127.0.0.1:$PORT"
echo
echo "The 60s cycle opens on an empty dashboard and adds one session at a"
echo "time (claude 4s, codex 14s, opencode 24s, attention 30s, all idle 51s)."
echo "Connect the app first, then start recording when the dashboard next"
echo "goes empty — that frame recurs every 60s."

if [ "$MODE" = "app-only" ]; then
  echo "App-only rehearsal is running. Stop with:"
  echo "  bash scripts/record-feature-demo.sh stop"
  exit 0
fi

tmux new-session -d -s "$SESSION" -n agents \
  "node scripts/appstore-demo-orchestrator.mjs terminal --agent claude --epoch-ms '$EPOCH_MS'"
tmux split-window -h -t "$SESSION":0 \
  "node scripts/appstore-demo-orchestrator.mjs terminal --agent codex --epoch-ms '$EPOCH_MS'"
tmux split-window -v -t "$SESSION":0.1 \
  "node scripts/appstore-demo-orchestrator.mjs terminal --agent opencode --epoch-ms '$EPOCH_MS'"
tmux select-layout -t "$SESSION":0 tiled
tmux set-option -t "$SESSION" status off

echo "Three synchronized fictional agent terminals are ready."
echo "Attach with: tmux attach -t $SESSION"
echo "Stop with:  bash scripts/record-feature-demo.sh stop"
tmux attach -t "$SESSION"
