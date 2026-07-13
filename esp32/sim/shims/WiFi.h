#pragma once
// Host shim for <WiFi.h>. The matrix/eink render paths include it but query
// connection state through the Net:: wrappers (net/wifi_manager.h), not WiFi
// directly, so this only needs to exist. Minimal WiFiClass keeps any stray
// reference compiling.
#include <cstdint>

struct SimWiFiClass {
  int status() { return 3; /* WL_CONNECTED */ }
  const char* localIP() { return "192.168.1.42"; }
};
extern SimWiFiClass WiFi;
