#!/bin/bash
# D200H current-boot display maps dump.
# Uses a single adb shell session to capture ps + /proc/*/maps + fb info
# into on-device files, then pulls them back in a second phase.
set -euo pipefail

SERIAL="${1:-0123456789ABCDEF}"
ADB=(adb -s "$SERIAL")
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUTDIR="$SCRIPT_DIR/dumps/maps_$STAMP"
REMOTE_DIR="/tmp/agentdeck-maps-$STAMP"

mkdir -p "$OUTDIR"

echo "=== D200H Maps Dump ==="
echo "Serial: $SERIAL"
echo "Local output: $OUTDIR"
echo "Remote temp: $REMOTE_DIR"

echo "--- [1/2] Single-shell on-device capture ---"
"${ADB[@]}" shell "
set -e
mkdir -p $REMOTE_DIR
ps > $REMOTE_DIR/ps.txt
cat /proc/fb > $REMOTE_DIR/proc_fb.txt 2>/dev/null || true
cat /proc/meminfo > $REMOTE_DIR/meminfo.txt 2>/dev/null || true
cat /proc/cmdline > $REMOTE_DIR/cmdline.txt 2>/dev/null || true
cat /sys/class/graphics/fb0/virtual_size > $REMOTE_DIR/fb_virtual_size.txt 2>/dev/null || true
cat /sys/class/graphics/fb0/bits_per_pixel > $REMOTE_DIR/fb_bpp.txt 2>/dev/null || true
cat /sys/class/graphics/fb0/name > $REMOTE_DIR/fb_name.txt 2>/dev/null || true
cat /sys/class/zkswe_usb/zkswe0/functions > $REMOTE_DIR/usb_functions.txt 2>/dev/null || true
cat /sys/class/zkswe_usb/zkswe0/enable > $REMOTE_DIR/usb_enable.txt 2>/dev/null || true
for P in \$(ps | busybox awk '/zkgui_ui|\\/bin\\/zkgui|\\/bin\\/zkdisplay|\\/bin\\/zkdaemon|agentdeck/{print \$1}'); do
  echo \$P >> $REMOTE_DIR/pids.txt
  cat /proc/\$P/cmdline > $REMOTE_DIR/pid_\$P.cmdline.txt 2>/dev/null || true
  cat /proc/\$P/maps > $REMOTE_DIR/pid_\$P.maps.txt 2>/dev/null || true
done
ls -la $REMOTE_DIR > $REMOTE_DIR/index.txt
echo done
"

echo "--- [2/2] Pull captured files ---"
"${ADB[@]}" pull "$REMOTE_DIR/." "$OUTDIR/" >/dev/null

echo ""
echo "=== Summary ==="
if [ -f "$OUTDIR/pids.txt" ]; then
  echo "Captured PIDs: $(tr '\n' ' ' < "$OUTDIR/pids.txt")"
else
  echo "Captured PIDs: none"
fi

for maps in "$OUTDIR"/pid_*.maps.txt; do
  [ -f "$maps" ] || continue
  echo "--- $(basename "$maps") ---"
  rg '/dev/fb0|libmi_|libnanovg|libzkgui' "$maps" || true
done

echo ""
echo "Files saved under: $OUTDIR"
