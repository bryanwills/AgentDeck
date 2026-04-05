#!/bin/bash
SERIAL="0123456789ABCDEF"
cd "$(dirname "$0")"

# 1. Clean up local MAC background loop
pkill -f "adb -s $SERIAL" 2>/dev/null

echo "=== SNEAKY TAKEOVER (v1.3_freeze) ==="

# 2. Identify and freeze stock UI
adb -s "$SERIAL" shell "
# Ensure probe tools are executable
chmod +x /data/fb-test /data/agentdeck-dyn

echo 'Finding zkgui/zkdisplay...'
ZK_PIDS=\$(ps | busybox awk '/zkgui|zkdisplay|zkdaemon/{print \$1}')
if [ -z \"\$ZK_PIDS\" ]; then
  echo 'Stock processes not found. Is it already dead?'
else
  echo \"Freezing PIDs: \$ZK_PIDS\"
  for P in \$ZK_PIDS; do
    kill -STOP \$P 2>/dev/null
  done
fi

echo 'Analyzing memory maps of zkgui...'
MAPS_OUTPUT=\$(/data/fb-test --maps 2>&1)
echo \"\$MAPS_OUTPUT\"

# Extract offset for /dev/fb0
OFFSET=\$(echo \"\$MAPS_OUTPUT\" | busybox awk '/dev\\/fb0/{print \$1}' | head -n 1 | cut -d'-' -f1)

if [ -z \"\$OFFSET\" ]; then
  echo 'Failed to find /dev/fb0 offset in zkgui maps. Guessing 0x30121000...'
  OFFSET=\"0x30121000\"
else
  echo \"Found fb0 offset: \$OFFSET\"
fi

echo '--- LAUNCHING AGENT (Sneaky Mode) ---'
# We launch in background as a daemon
export LD_LIBRARY_PATH=/lib:/usr/lib
/data/agentdeck-dyn --daemon </dev/null >/data/agentdeck-stdout.log 2>&1 &
"

echo "=== Hijack initiated. Check screen! ==="
sleep 2
adb -s "$SERIAL" shell "ps | busybox awk '/agentdeck/{print \$0}'"
