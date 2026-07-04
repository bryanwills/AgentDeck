#pragma once

namespace Net {

/**
 * Initialize serial JSON listener.
 * Reads newline-delimited JSON from Serial (same USB used for debug).
 * Lines starting with '{' are parsed as bridge protocol messages.
 */
void serialInit();

/**
 * Poll serial for incoming JSON messages. Call from network task loop.
 * Non-blocking — returns immediately if no data available.
 */
void serialLoop();

/**
 * Check if we've received any serial JSON recently (within timeout).
 */
bool serialConnected();

/**
 * Write one newline-terminated protocol JSON line to Serial, intact.
 * On native-USB (HWCDC) boards the driver can drop a whole 64-byte hardware
 * FIFO block mid-write, splicing the line — this paces the write one FIFO
 * block at a time with a drain in between. UART boards get a plain println.
 */
void serialWriteJsonLine(const char* buf);

}  // namespace Net
