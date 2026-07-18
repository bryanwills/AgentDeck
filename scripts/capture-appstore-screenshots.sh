#!/bin/bash
# Capture App Store screenshots from the same deterministic demo feed that
# produces the App Previews, so the still and motion assets tell one story and
# neither exposes a real workspace.
#
#   bash scripts/capture-appstore-screenshots.sh macos
#   bash scripts/capture-appstore-screenshots.sh iphone
#   bash scripts/capture-appstore-screenshots.sh ipad
#
# Three beats are captured per platform, at fixed offsets into the 30s cycle:
#   1. fleet    — several agents working at once, quota gauge live
#   2. attention— the amber "a human is needed" moment (late enough that the
#                 HUD has finished animating in; capturing at ~1s reads as a
#                 half-faded overlay with the panel bleeding through)
#   3. complete — every session resolved, terrarium at rest
#
# Native capture sizes are already App Store-legal, so nothing is rescaled:
#   iPhone 16 Pro Max 1320x2868 · iPad Pro 13" 2064x2752 · macOS 2880x1800
#   (a 1440x900 logical window on a 2x display).

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PLATFORM="${1:-}"
PORT="${AGENTDECK_DEMO_PORT:-9220}"
WS="ws://127.0.0.1:$PORT"
LEAD_SECONDS=12
SHOTS="$ROOT/apple/appstore-submission/screenshots"
MACOS_APP="$ROOT/apple/DerivedData/Build/Products/Debug/AgentDeck.app"
IOS_APP="$ROOT/apple/DerivedData/Build/Products/Debug-iphonesimulator/AgentDeck.app"
BUNDLE_ID="bound.serendipity.agent.deck"

# Cycle offsets, in seconds, for the three beats.
BEAT_TIMES=(9.5 18.8 27.5)
BEAT_NAMES=(01-fleet 02-attention 03-complete)

# 16:10 window so the macOS capture is exactly 2880x1800 physical.
MAC_WIN_W=1440; MAC_WIN_H=900; MAC_WIN_X=0; MAC_WIN_Y=30
MAC_DISPLAY=1

usage() { echo "Usage: bash scripts/capture-appstore-screenshots.sh {macos|iphone|ipad}" >&2; exit 2; }
[[ "$PLATFORM" =~ ^(macos|iphone|ipad)$ ]] || usage

now_ms() { python3 -c "import time;print(int(time.time()*1000))"; }

# App Store rejects screenshots carrying an alpha channel, and `simctl io
# screenshot` always writes RGBA. Flatten in place.
flatten() {
  local file="$1"
  ffmpeg -y -v error -i "$file" -pix_fmt rgb24 "${file%.png}.flat.png"
  mv "${file%.png}.flat.png" "$file"
}

start_feed_at() {
  local epoch_ms="$1"
  bash "$ROOT/scripts/record-feature-demo.sh" stop >/dev/null 2>&1 || true
  mkdir -p "${TMPDIR:-/tmp}/agentdeck-launch-demo"
  echo "$epoch_ms" > "${TMPDIR:-/tmp}/agentdeck-launch-demo/epoch-ms"
  node "$ROOT/scripts/appstore-demo-orchestrator.mjs" serve \
    --port "$PORT" --epoch-ms "$epoch_ms" \
    > "${TMPDIR:-/tmp}/agentdeck-launch-demo/server.log" 2>&1 &
  echo $! > "${TMPDIR:-/tmp}/agentdeck-launch-demo/server.pid"
  sleep 0.6
}

# Sleep until `epoch + offset`, where both are relative to the feed's cycle.
wait_for_beat() {
  local epoch_ms="$1" offset_s="$2"
  python3 - "$epoch_ms" "$offset_s" <<'PY'
import sys, time
target = int(sys.argv[1]) / 1000 + float(sys.argv[2])
delay = target - time.time()
if delay > 0:
    time.sleep(delay)
PY
}

capture_macos() {
  osascript -e 'quit app "AgentDeck"' >/dev/null 2>&1 || true
  sleep 2
  local epoch; epoch=$(( $(now_ms) + (LEAD_SECONDS * 1000) ))
  start_feed_at "$epoch"

  open -n "$MACOS_APP" --args -AgentDeckScreenshotURL "$WS"
  sleep 6
  osascript -e "tell application \"System Events\" to tell process \"AgentDeck\"
    set position of window 1 to {$MAC_WIN_X, $MAC_WIN_Y}
    set size of window 1 to {$MAC_WIN_W, $MAC_WIN_H}
  end tell" >/dev/null

  mkdir -p "$SHOTS/macOS"
  local tmp="${TMPDIR:-/tmp}/agentdeck-shot.png"
  for i in "${!BEAT_TIMES[@]}"; do
    wait_for_beat "$epoch" "${BEAT_TIMES[$i]}"
    screencapture -D"$MAC_DISPLAY" -x "$tmp"
    # Crop the window out of the full-display grab, in physical pixels.
    ffmpeg -y -v error -i "$tmp" \
      -vf "crop=$((MAC_WIN_W*2)):$((MAC_WIN_H*2)):$((MAC_WIN_X*2)):$((MAC_WIN_Y*2))" \
      -pix_fmt rgb24 "$SHOTS/macOS/${BEAT_NAMES[$i]}.png"
    flatten "$SHOTS/macOS/${BEAT_NAMES[$i]}.png"
    echo "captured macOS/${BEAT_NAMES[$i]}.png"
  done
  rm -f "$tmp"
}

capture_ios() {
  local device="$1" outdir="$2"
  local udid
  udid="$(xcrun simctl list devices available | grep -F "$device (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  [[ -n "$udid" ]] || { echo "simulator not found: $device" >&2; exit 1; }

  xcrun simctl boot "$udid" 2>/dev/null || true
  open -a Simulator
  sleep 6
  xcrun simctl install "$udid" "$IOS_APP"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
  # Apple's canonical marketing status bar.
  xcrun simctl status_bar "$udid" override \
    --time "9:41" --cellularMode active --cellularBars 4 --wifiBars 3 --batteryState charged --batteryLevel 100 \
    >/dev/null 2>&1 || true

  local epoch; epoch=$(( $(now_ms) + (LEAD_SECONDS * 1000) ))
  start_feed_at "$epoch"
  xcrun simctl launch "$udid" "$BUNDLE_ID" -AgentDeckScreenshotURL "$WS" >/dev/null

  mkdir -p "$SHOTS/$outdir"
  for i in "${!BEAT_TIMES[@]}"; do
    wait_for_beat "$epoch" "${BEAT_TIMES[$i]}"
    xcrun simctl io "$udid" screenshot "$SHOTS/$outdir/${BEAT_NAMES[$i]}.png" >/dev/null 2>&1
    flatten "$SHOTS/$outdir/${BEAT_NAMES[$i]}.png"
    echo "captured $outdir/${BEAT_NAMES[$i]}.png"
  done
}

case "$PLATFORM" in
  macos)  capture_macos ;;
  iphone) capture_ios "iPhone 16 Pro Max" "iPhone" ;;
  ipad)   capture_ios "iPad Pro 13-inch (M4)" "iPad" ;;
esac

echo
echo "Verify before uploading:"
echo "  bash apple/scripts/validate-appstore-submission.sh"
