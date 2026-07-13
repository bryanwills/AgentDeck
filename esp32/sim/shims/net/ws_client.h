#pragma once
// Host shim for <net/ws_client.h> — the outbound queue entry point (used by the
// HUD/steering paths). No-op definition in sim_globals.cpp.
namespace Net {
void queueOutbound(const char* json);
}  // namespace Net
