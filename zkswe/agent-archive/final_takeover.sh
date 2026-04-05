#!/bin/bash
SERIAL="0123456789ABCDEF"
cd "$(dirname "$0")"

# Local cleanup on MAC to avoid background loop interference
pkill -f "adb -s $SERIAL" 2>/dev/null

echo "=== Pushing IMMORTAL agent binary ==="
adb -s "$SERIAL" push agentdeck-d200h-dyn /data/agentdeck-dyn
if [ $? -ne 0 ]; then
  echo "Push failed."
  exit 1
fi

echo "=== Executing takeover (Deep Scan Cleanup) ==="
adb -s "$SERIAL" shell "
# Lock USB to protect ADB connection
chmod 444 /sys/class/zkswe_usb/zkswe0/functions /sys/class/zkswe_usb/zkswe0/enable 2>/dev/null

# Neutralize stock UI
mount -o bind /dev/null /bin/zkgui 2>/dev/null
mount -o bind /dev/null /bin/zkdisplay 2>/dev/null
mount -o bind /dev/null /bin/zkdaemon 2>/dev/null

echo 'Cleaning up existing processes...'
for P in \$(ps | busybox awk '/zkgui|zkdisplay|zkdaemon|agentdeck/{print \$1}'); do
  kill -9 \$P 2>/dev/null
done

chmod +x /data/agentdeck-dyn
export LD_LIBRARY_PATH=/lib:/usr/lib

echo '--- LAUNCHING IMMORTAL DAEMON ---'
# We use /dev/null for stdin and redirect logs. 
# setsid() inside the binary handles terminal detachment.
# LD_LIBRARY_PATH is exported so the dynamic glibc binary can find MI libs.
/data/agentdeck-dyn --daemon </dev/null >/data/agentdeck-stdout.log 2>&1 &
"

echo "=== Takeover initiated. Waiting for startup... ==="
sleep 3

echo "=== Verification ==="
adb -s "$SERIAL" shell "ps | busybox awk '/agentdeck/{print \$0}'"
echo "--- Last 10 lines of stdout.log ---"
adb -s "$SERIAL" shell "tail -n 10 /data/agentdeck-stdout.log 2>/dev/null || cat /data/agentdeck-stdout.log | busybox tail -n 10"
echo "--- Last 10 lines of boot.log ---"
adb -s "$SERIAL" shell "cat /data/agentdeck-boot.log | busybox tail -n 10 2>/dev/null || cat /data/agentdeck-boot.log"
