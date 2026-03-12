/**
 * ESP32 Serial Bridge — broadcasts BridgeEvents over USB serial.
 *
 * Detects ESP32 devices (CH340/CP210x) on USB serial ports,
 * opens the port, and sends newline-delimited JSON matching
 * the same protocol as WebSocket.
 *
 * ESP32 side reads lines starting with '{' and passes to Protocol::parseMessage().
 */

import { exec } from 'child_process';
import { createWriteStream, type WriteStream } from 'fs';
import type { BridgeEvent } from './types.js';
import { SERIAL_FORWARDED_EVENTS } from '@agentdeck/shared/protocol';
import { debug } from './logger.js';

// Serial port patterns for ESP32 devices
const ESP32_PORT_PATTERNS = [
  /\/dev\/cu\.usbserial-\d+/,   // CH340 (86 Box)
  /\/dev\/cu\.usbmodem\d+/,      // Native USB JTAG (IPS 3.5", Round AMOLED)
  /\/dev\/ttyUSB\d+/,            // Linux CH340
  /\/dev\/ttyACM\d+/,            // Linux native USB
];

// Exclude known non-ESP32 devices
const EXCLUDE_PATTERNS = [
  /Bluetooth/i,
  /WLAN/i,
];

interface SerialConnection {
  port: string;
  stream: WriteStream;
  connected: boolean;
}

let connections: SerialConnection[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let stateProvider: (() => BridgeEvent | null) | null = null;

// Events to forward — shared constant from @agentdeck/shared
const FORWARDED_EVENTS = SERIAL_FORWARDED_EVENTS;

/** Run a shell command with timeout, escalating to SIGKILL if SIGTERM fails. */
function execWithKill(cmd: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { encoding: 'utf-8', timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
    // When exec timeout fires, it sends SIGTERM. But stty stuck in kernel I/O
    // ignores SIGTERM. Schedule a SIGKILL as escalation.
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, timeoutMs + 1000);
    child.on('exit', () => clearTimeout(killTimer));
  });
}

async function detectESP32Ports(): Promise<string[]> {
  try {
    const platform = process.platform;
    let output: string;

    if (platform === 'darwin') {
      output = await execWithKill('ls /dev/cu.usb* 2>/dev/null || true');
    } else if (platform === 'linux') {
      output = await execWithKill('ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true');
    } else {
      return [];
    }

    const ports = output.trim().split('\n').filter(Boolean);

    // Filter to ESP32 patterns, exclude known non-ESP32
    return ports.filter(port => {
      if (EXCLUDE_PATTERNS.some(p => p.test(port))) return false;
      return ESP32_PORT_PATTERNS.some(p => p.test(port));
    });
  } catch {
    return [];
  }
}

async function openPort(port: string): Promise<SerialConnection | null> {
  try {
    // Configure baud rate + disable DTR/RTS to prevent ESP32 reset
    const platform = process.platform;
    if (platform === 'darwin') {
      await execWithKill(`stty -f ${port} 115200 cs8 -cstopb -parenb -hupcl`);
    } else if (platform === 'linux') {
      await execWithKill(`stty -F ${port} 115200 cs8 -cstopb -parenb -hupcl`);
    }

    const stream = createWriteStream(port, { flags: 'w' });
    const conn: SerialConnection = { port, stream, connected: true };

    stream.on('error', (err) => {
      debug('ESP32', `Serial error on ${port}: ${err.message}`);
      conn.connected = false;
    });

    stream.on('close', () => {
      debug('ESP32', `Serial port closed: ${port}`);
      conn.connected = false;
    });

    debug('ESP32', `Opened serial port: ${port}`);
    return conn;
  } catch (err: any) {
    debug('ESP32', `Failed to open ${port}: ${err.message}`);
    return null;
  }
}

function sendToConnection(conn: SerialConnection, json: string): void {
  if (!conn.connected) return;
  try {
    conn.stream.write(json + '\n');
  } catch {
    conn.connected = false;
  }
}

/**
 * Register a callback that returns the current state_update event.
 * Used to send periodic heartbeats so ESP32 gets data even without
 * state changes (e.g., after reboot while bridge is idle).
 */
export function setESP32StateProvider(provider: () => BridgeEvent | null): void {
  stateProvider = provider;
}

function sendHeartbeat(): void {
  if (connections.length === 0 || !stateProvider) return;
  const event = stateProvider();
  if (!event) return;
  const json = JSON.stringify(event);
  for (const conn of connections) {
    sendToConnection(conn, json);
  }
}

/**
 * Start ESP32 serial bridge.
 * Detects USB serial ports and opens connections.
 * Call broadcast() to send events to all connected ESP32 devices.
 *
 * Non-blocking: initial device detection runs in background so a hung
 * USB port (stty stuck in kernel I/O) cannot block bridge startup.
 */
export function startESP32Serial(): void {
  // Fire-and-forget initial detection (non-blocking)
  pollForDevices().catch(err => {
    debug('ESP32', `Initial poll failed: ${err.message}`);
  });

  // Poll for new/disconnected devices every 10 seconds
  pollTimer = setInterval(() => {
    pollForDevices().catch(err => {
      debug('ESP32', `Poll failed: ${err.message}`);
    });
  }, 10000);

  // Heartbeat: send current state every 5 seconds so ESP32 stays in sync
  heartbeatTimer = setInterval(sendHeartbeat, 5000);

  debug('ESP32', 'Serial bridge started');
}

async function pollForDevices(): Promise<void> {
  const ports = await detectESP32Ports();

  // Remove disconnected
  connections = connections.filter(c => {
    if (!c.connected) {
      try { c.stream.end(); } catch { /* ignore */ }
      return false;
    }
    return true;
  });

  // Add new ports
  for (const port of ports) {
    if (!connections.some(c => c.port === port)) {
      const conn = await openPort(port);
      if (conn) {
        connections.push(conn);
      }
    }
  }
}

/**
 * Broadcast a BridgeEvent to all connected ESP32 devices via serial.
 */
export function broadcastESP32(event: BridgeEvent): void {
  if (connections.length === 0) return;
  if (!FORWARDED_EVENTS.has(event.type)) return;

  const json = JSON.stringify(event);
  for (const conn of connections) {
    sendToConnection(conn, json);
  }
}

/**
 * Stop ESP32 serial bridge and close all connections.
 */
export function stopESP32Serial(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  for (const conn of connections) {
    conn.connected = false;
    try { conn.stream.end(); } catch { /* ignore */ }
  }
  connections = [];
  debug('ESP32', 'Serial bridge stopped');
}

/**
 * Get number of connected ESP32 devices.
 */
export function esp32ConnectionCount(): number {
  return connections.filter(c => c.connected).length;
}

/**
 * Get list of connected ESP32 serial port paths.
 */
export function getESP32Ports(): string[] {
  return connections.filter(c => c.connected).map(c => c.port);
}
