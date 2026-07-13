#pragma once
// Host shim for <net/serial_client.h>. Declares only the Net:: entry points the
// render surfaces call; definitions live in sim_globals.cpp (connected = true so
// scenes render as an online device). The real header pulls in the serial/USB
// stack, which the sim must not compile.
namespace Net {
bool serialConnected();
void serialWriteJsonLine(const char* buf);
}  // namespace Net
