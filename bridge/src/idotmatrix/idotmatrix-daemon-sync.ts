/**
 * iDotMatrix daemon-managed BLE sync.
 *
 * The Node daemon cannot speak BLE in-process, so when an iDotMatrix device is
 * configured we auto-spawn the Python `sync.py` client (bleak) and manage its
 * lifecycle — start on daemon boot, respawn with backoff if it dies, kill on
 * shutdown. This is what lets the device run with **only the CLI daemon up**
 * (no separate `agentdeck idotmatrix sync`, no Swift app holding the BLE link).
 *
 * sync.py polls the daemon's `/pixoo/frame?size=32` and pushes over BLE, so it
 * tracks the same frames every other surface shows. Only the first configured
 * device is driven (BLE is single-connection; matches the CLI behaviour).
 *
 * This is daemon-only (terminal-managed / Homebrew) code — it never runs in the
 * App Store Swift build, so spawning a subprocess here does not touch the
 * Apple 2.5.2 sandbox invariants.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadIDotMatrixDevices } from './idotmatrix-settings.js';

let child: ChildProcess | null = null;
let stopping = false;
let respawnTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let startedAt = 0;

const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 5_000;
/** If the process stayed up at least this long, treat the next exit as fresh. */
const HEALTHY_UPTIME_MS = 30_000;

function log(msg: string): void {
  // Match the daemon's `[agentdeck]` stderr prefix.
  console.error(`[agentdeck] [idotmatrix] ${msg}`);
}

function resolvePaths(): { venvPython: string; syncScript: string } {
  // This file compiles to bridge/dist/idotmatrix/idotmatrix-daemon-sync.js, so
  // the repo root is three levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(here, '..', '..', '..');
  return {
    venvPython: join(projectRoot, '.venv', 'bin', 'python'),
    syncScript: join(projectRoot, 'bridge', 'src', 'idotmatrix', 'sync.py'),
  };
}

/**
 * Start (or no-op if already running) the managed BLE sync for the first
 * configured iDotMatrix device, fed by the daemon at `httpPort`.
 */
export function startIDotMatrixSync(httpPort: number): void {
  stopping = false;
  if (child) return; // already running

  const devices = loadIDotMatrixDevices();
  if (devices.length === 0) return; // nothing configured → nothing to drive

  const { venvPython, syncScript } = resolvePaths();
  if (!existsSync(venvPython) || !existsSync(syncScript)) {
    log(
      `BLE sync unavailable (missing ${!existsSync(venvPython) ? 'Python venv (.venv)' : 'sync.py'}); ` +
        `iDotMatrix will not be driven by the daemon`,
    );
    return;
  }

  spawnSync(venvPython, syncScript, httpPort);
}

function spawnSync(venvPython: string, syncScript: string, httpPort: number): void {
  if (stopping) return;
  const devices = loadIDotMatrixDevices();
  if (devices.length === 0) return; // device removed while we were backing off
  const device = devices[0];
  const addr = device.address;
  const brightness = device.brightness ?? 100;
  const url = `http://127.0.0.1:${httpPort}`;

  log(`Starting BLE sync for ${device.name ?? addr} (bridge ${url}, brightness ${brightness}%)`);
  startedAt = Date.now();
  const proc = spawn(
    venvPython,
    // iDotMatrix software brightness boost canonical = 1.6 — keep in sync:
    // sync.py (run_sync boost default), IDotMatrixModule.swift (boostBrightnessContrast).
    [syncScript, '-a', addr, '-u', url, '-b', String(brightness), '--boost', '1.6'],
    { stdio: 'ignore' }, // long-lived daemon; don't let sync.py's debug flood daemon stdout
  );
  child = proc;

  proc.on('error', (err) => {
    log(`BLE sync failed to spawn: ${err.message}`);
  });

  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (stopping) return;
    // A long healthy run resets the backoff so a one-off crash recovers fast.
    if (Date.now() - startedAt > HEALTHY_UPTIME_MS) consecutiveFailures = 0;
    consecutiveFailures += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * consecutiveFailures);
    log(`BLE sync exited (code=${code} signal=${signal}); respawning in ${Math.round(delay / 1000)}s`);
    respawnTimer = setTimeout(() => spawnSync(venvPython, syncScript, httpPort), delay);
    if (respawnTimer.unref) respawnTimer.unref();
  });
}

/** Stop the managed BLE sync and cancel any pending respawn (daemon shutdown). */
export function stopIDotMatrixSync(): void {
  stopping = true;
  if (respawnTimer) {
    clearTimeout(respawnTimer);
    respawnTimer = null;
  }
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    child = null;
  }
}
