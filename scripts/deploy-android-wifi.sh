#!/usr/bin/env bash
# WiFi adb deploy for AgentDeck Android dashboard devices (e-ink readers, tablets).
#
#   enable            switch every USB-attached adb device to tcpip:5555,
#                     record its wlan0 IP, and connect over WiFi
#   deploy [--build]  connect to all recorded devices and install the newest
#                     dist/agentdeck-v*.apk (--build runs the release build first)
#   status            connect to recorded IPs and show device states
#
# tcpip mode does not survive a device reboot: after a reboot, plug the device
# in over USB once and re-run `enable`.

set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${AGENTDECK_DATA_DIR:-$HOME/.agentdeck}/android-adb-devices.json"
PKG=dev.agentdeck
ACTIVITY="$PKG/.MainActivity"

newest_apk() { ls -t dist/agentdeck-v*.apk 2>/dev/null | head -1; }

config_ips() {
  [ -f "$CONFIG" ] || return 0
  python3 -c "import json,sys; [print(d['ip']) for d in json.load(open('$CONFIG')).get('devices',[])]"
}

save_device() { # serial ip model
  python3 - "$1" "$2" "$3" <<'PY'
import json, os, sys
serial, ip, model = sys.argv[1:4]
path = os.path.expanduser(os.environ.get("AGENTDECK_DATA_DIR", "~/.agentdeck")) + "/android-adb-devices.json"
data = {"devices": []}
if os.path.exists(path):
    data = json.load(open(path))
devices = [d for d in data.get("devices", []) if d.get("serial") != serial and d.get("ip") != ip]
devices.append({"serial": serial, "ip": ip, "model": model})
data["devices"] = devices
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(data, open(path, "w"), indent=1)
print(f"    saved {model} ({serial}) -> {ip}")
PY
}

connect_all() {
  for ip in $(config_ips); do
    adb connect "$ip:5555" >/dev/null 2>&1 || echo "!! unreachable: $ip"
  done
  sleep 1
}

wifi_serials() { adb devices | awk '$1 ~ /:5555$/ && $2 == "device" {print $1}'; }

cmd_enable() {
  local usb_serials
  usb_serials=$(adb devices -l | awk '/usb:/ && $2 == "device" {print $1}')
  [ -n "$usb_serials" ] || { echo "no USB adb devices attached"; exit 1; }
  for s in $usb_serials; do
    local ip model
    ip=$(adb -s "$s" shell "ip -f inet addr show wlan0 2>/dev/null" | awk '/inet /{print $2}' | cut -d/ -f1 | head -1 | tr -d '\r')
    model=$(adb -s "$s" shell getprop ro.product.model | tr -d '\r')
    if [ -z "$ip" ]; then
      echo "!! $model ($s): no wlan0 IP (WiFi off?) — skipped"
      continue
    fi
    echo "==> $model ($s) -> tcpip:5555 @ $ip"
    adb -s "$s" tcpip 5555 >/dev/null
    sleep 2
    adb connect "$ip:5555" >/dev/null
    save_device "$s" "$ip" "$model"
  done
  adb devices -l | grep ":5555" || true
}

cmd_deploy() {
  if [ "${1:-}" = "--build" ]; then
    bash scripts/build-android-release.sh
  fi
  local apk
  apk=$(newest_apk)
  [ -n "$apk" ] || { echo "no APK under dist/ — run with --build"; exit 1; }
  echo "==> APK: $apk"
  connect_all
  local serials
  serials=$(wifi_serials)
  [ -n "$serials" ] || { echo "no WiFi adb devices online (run 'enable' with USB attached first)"; exit 1; }
  for s in $serials; do
    echo "==> install on $s"
    adb -s "$s" install -r "$apk"
    adb -s "$s" shell am start -n "$ACTIVITY" >/dev/null 2>&1 || \
      adb -s "$s" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  done
  echo "==> done: $(echo "$serials" | wc -l | tr -d ' ') device(s)"
}

cmd_status() {
  connect_all
  adb devices -l
}

case "${1:-deploy}" in
  enable) cmd_enable ;;
  deploy) shift || true; cmd_deploy "${1:-}" ;;
  status) cmd_status ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
