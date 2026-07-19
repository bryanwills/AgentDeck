#!/bin/bash
# Capture App Store App Previews from the deterministic demo feed.
#
#   bash scripts/record-appstore-previews.sh macos
#   bash scripts/record-appstore-previews.sh iphone
#   bash scripts/record-appstore-previews.sh ipad
#
# Each run starts the demo feed with an epoch a few seconds in the FUTURE and
# launches the app fresh against it, so the recording opens on a genuinely
# empty dashboard. Recording an already-looping feed does not work: the
# previous cycle's last session card survives the empty phase and the cold
# open reads as "one idle session" instead of "nothing running yet".
#
# Output lands in apple/appstore-submission/previews/<platform>/ already
# encoded to the dimensions, duration, codec and bitrate that
# apple/scripts/validate-appstore-submission.sh enforces.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PLATFORM="${1:-}"
PORT="${AGENTDECK_DEMO_PORT:-9220}"
WS="ws://127.0.0.1:$PORT"
CLIP_SECONDS=28          # App Previews must be 15–30s
LEAD_SECONDS=12          # app connects and settles before the cycle starts
RAW_SECONDS=$(( CLIP_SECONDS + LEAD_SECONDS + 8 ))
WORK="${TMPDIR:-/tmp}/agentdeck-appstore-previews"
MACOS_APP="$ROOT/apple/DerivedData/Build/Products/Debug/AgentDeck.app"
IOS_APP="$ROOT/apple/DerivedData/Build/Products/Debug-iphonesimulator/AgentDeck.app"
BUNDLE_ID="bound.serendipity.agent.deck"

# macOS window geometry: 16:9 in logical points, doubled on a 2x display.
# Height is bounded by the menu bar and Dock, so this is the largest 16:9
# window that fits without the Dock clipping it.
MAC_WIN_W=1856; MAC_WIN_H=1044; MAC_WIN_X=0; MAC_WIN_Y=30
MAC_DISPLAY=1

usage() { echo "Usage: bash scripts/record-appstore-previews.sh {macos|iphone|ipad}" >&2; exit 2; }
[[ "$PLATFORM" =~ ^(macos|iphone|ipad)$ ]] || usage
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

mkdir -p "$WORK"
RAW="$WORK/$PLATFORM-raw.mov"
rm -f "$RAW"

stop_feed() { bash "$ROOT/scripts/record-feature-demo.sh" stop >/dev/null 2>&1 || true; }

# Start the feed with a future epoch and report it (ms since epoch).
start_feed_at() {
  local epoch_ms="$1"
  stop_feed
  mkdir -p "${TMPDIR:-/tmp}/agentdeck-launch-demo"
  echo "$epoch_ms" > "${TMPDIR:-/tmp}/agentdeck-launch-demo/epoch-ms"
  node "$ROOT/scripts/appstore-demo-orchestrator.mjs" serve \
    --port "$PORT" --epoch-ms "$epoch_ms" \
    > "${TMPDIR:-/tmp}/agentdeck-launch-demo/server.log" 2>&1 &
  echo $! > "${TMPDIR:-/tmp}/agentdeck-launch-demo/server.pid"
  sleep 0.6
}

now_ms() { python3 -c "import time;print(int(time.time()*1000))"; }

# ---------------------------------------------------------------- encode
# `offset` is where the cycle actually begins inside the raw file.
encode() {
  local raw="$1" offset="$2" filter="$3" out="$4"
  mkdir -p "$(dirname "$out")"
  # App Store Connect rejects App Previews with no audio stream at all
  # ("unsupported or corrupted audio") — a silent AAC-LC track is required
  # even though the captures themselves are silent. Do not reintroduce `-an`.
  ffmpeg -y -v error -accurate_seek -ss "$offset" -t "$CLIP_SECONDS" -i "$raw" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -vf "$filter,format=yuv420p" -r 30 \
    -c:v libx264 -profile:v high -level:v 4.0 \
    -b:v 11M -maxrate 11M -bufsize 22M \
    -c:a aac -b:a 128k -ar 44100 -ac 2 \
    -map 0:v:0 -map 1:a:0 -shortest \
    -movflags +faststart "$out"
  echo "wrote $out"
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,r_frame_rate,profile,level \
    -show_entries format=duration,bit_rate -of default=nw=1 "$out"
  ffprobe -v error -select_streams a:0 \
    -show_entries stream=codec_name,sample_rate,channels -of default=nw=1 "$out"
}

# ---------------------------------------------------------------- macOS
record_macos() {
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

  local t0; t0=$(now_ms)
  screencapture -v -D"$MAC_DISPLAY" -V "$RAW_SECONDS" "$RAW" &
  local pid=$!
  echo "recording macOS · cycle starts $(( epoch - t0 ))ms into the run"
  wait $pid

  # screencapture drops ~0.9s of frames while it spins up; measure_offset
  # below is refined by inspecting the first frame.
  local offset; offset=$(python3 -c "print(max(0,($epoch-$t0)/1000-0.9))")
  echo "$offset" > "$WORK/macos-offset"
  encode "$RAW" "$offset" \
    "crop=$((MAC_WIN_W*2)):$((MAC_WIN_H*2)):$((MAC_WIN_X*2)):$((MAC_WIN_Y*2)),scale=1920:1080:flags=lanczos" \
    "$ROOT/apple/appstore-submission/previews/macOS/agentdeck-preview.mp4"
}

# ---------------------------------------------------------------- iOS
record_ios() {
  local device="$1" outdir="$2" scale="$3"
  local udid
  udid="$(xcrun simctl list devices available | grep -F "$device (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  [[ -n "$udid" ]] || { echo "simulator not found: $device" >&2; exit 1; }

  xcrun simctl boot "$udid" 2>/dev/null || true
  open -a Simulator
  sleep 6
  xcrun simctl install "$udid" "$IOS_APP"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true

  local epoch; epoch=$(( $(now_ms) + (LEAD_SECONDS * 1000) ))
  start_feed_at "$epoch"

  xcrun simctl launch "$udid" "$BUNDLE_ID" -AgentDeckScreenshotURL "$WS" >/dev/null

  local t0; t0=$(now_ms)
  xcrun simctl io "$udid" recordVideo --codec h264 --force "$RAW" &
  local pid=$!
  echo "recording $device · cycle starts $(( epoch - t0 ))ms into the run"
  sleep "$RAW_SECONDS"
  kill -INT $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
  sleep 1

  local offset; offset=$(python3 -c "print(max(0,($epoch-$t0)/1000-0.5))")
  echo "$offset" > "$WORK/$PLATFORM-offset"
  encode "$RAW" "$offset" "$scale" "$ROOT/apple/appstore-submission/previews/$outdir/agentdeck-preview.mp4"
}

case "$PLATFORM" in
  macos)  record_macos ;;
  iphone) record_ios "iPhone 16 Pro Max" "iPhone" "scale=886:1920:flags=lanczos" ;;
  ipad)   record_ios "iPad Pro 13-inch (M4)" "iPad" "scale=1200:1600:flags=lanczos" ;;
esac

echo
echo "Verify before uploading:"
echo "  bash apple/scripts/validate-appstore-submission.sh"
