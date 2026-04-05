#!/bin/bash
SERIAL="0123456789ABCDEF"
cd "$(dirname "$0")"

echo "Waiting for D200H ($SERIAL) to connect... Please reboot the device now."
adb -s "$SERIAL" wait-for-device
echo "Device connected. Pushing new binary..."
adb -s "$SERIAL" push agentdeck-d200h-dyn /data/agentdeck-dyn 
if [ $? -ne 0 ]; then
  echo "Failed to push binary. The adb session may have dropped."
  exit 1
fi

echo "Push done. Executing single-shell takeover..."
stty -icanon -echo  # disable buffering
adb -s "$SERIAL" shell "
chmod 444 /sys/class/zkswe_usb/zkswe0/functions /sys/class/zkswe_usb/zkswe0/enable 2>/dev/null;
mount -o bind /dev/null /bin/zkgui 2>/dev/null;
mount -o bind /dev/null /bin/zkdisplay 2>/dev/null;
mount -o bind /dev/null /bin/zkdaemon 2>/dev/null;
for P in \$(ps | busybox awk '/zkgui_ui|\/bin\/zkgui|\/bin\/zkdisplay|\/bin\/zkdaemon/{print \$1}'); do kill \$P 2>/dev/null; done;
for P in \$(ps | busybox awk '/agentdeck/{print \$1}'); do kill \$P 2>/dev/null; done;
chmod +x /data/agentdeck-dyn 2>/dev/null;
echo '--- STARTING AGENT ---';
exec /data/agentdeck-dyn --stdin
"
echo "Takeover script finished."
