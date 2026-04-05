#!/bin/bash
SERIAL="0123456789ABCDEF"
cd "$(dirname "$0")"

adb -s "$SERIAL" push agentdeck-d200h-dyn /data/agentdeck-dyn 
if [ $? -ne 0 ]; then
  echo "Push failed."
  exit 1
fi

echo "Pushed. Restarting agent..."
adb -s "$SERIAL" shell "
killall agentdeck-d200h-dyn 2>/dev/null;
chmod +x /data/agentdeck-dyn;
echo '--- STARTING UPDATED AGENT ---';
exec /data/agentdeck-dyn --stdin
"
