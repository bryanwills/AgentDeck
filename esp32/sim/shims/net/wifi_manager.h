#pragma once
// Host shim for <net/wifi_manager.h> — Net:: WiFi status accessors used by the
// matrix/eink render paths. Definitions in sim_globals.cpp.
namespace Net {
bool wifiConnected();
const char* wifiLocalIP();
}  // namespace Net
