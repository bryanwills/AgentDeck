#!/bin/bash
SERIAL="0123456789ABCDEF"
cd "$(dirname "$0")"

pkill -f "adb -s $SERIAL"

echo "Waiting for D200H ($SERIAL) to disconnect... (Reboot it now)"
adb -s "$SERIAL" wait-for-disconnect
echo "Waiting for connection..."
adb -s "$SERIAL" wait-for-device
sleep 1

echo "Pushing fb-test..."
adb -s "$SERIAL" push fb-test /data/fb-test 
if [ $? -ne 0 ]; then
  echo "Failed."
  exit 1
fi

echo "Executing SINGLE TARGET TEST on 0x50121000..."
adb -s "$SERIAL" shell "
chmod 444 /sys/class/zkswe_usb/zkswe0/functions /sys/class/zkswe_usb/zkswe0/enable 2>/dev/null;
mount -o bind /dev/null /bin/zkgui;
mount -o bind /dev/null /bin/zkdisplay;
mount -o bind /dev/null /bin/zkdaemon;
for P in \$(ps | busybox awk '/zkgui_ui|\/bin\/zkgui|\/bin\/zkdisplay|\/bin\/zkdaemon/{print \$1}'); do kill \$P 2>/dev/null; done;
for P in \$(ps | busybox awk '/agentdeck/{print \$1}'); do kill \$P 2>/dev/null; done;
chmod +x /data/fb-test;
export LD_LIBRARY_PATH=/lib:/usr/lib;

echo 'Testing 0x50121000... (smem alias)';
/data/fb-test --gfx --gfx-bus 0x50121000 
"
