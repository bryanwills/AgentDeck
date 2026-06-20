/**
 * Timebox Mini device settings CRUD.
 *
 * The Timebox Mini ships in two transport variants that drive the same 11x11
 * LED screen:
 *   - **SPP** — Bluetooth Classic SPP serial (`/dev/cu.TimeBox-Light-*`), paired
 *     as the "TimeBox-Light" endpoint. CLI-daemon only (needs a serial port).
 *   - **BLE** — BLE GATT (ISSC transparent-UART `49535343-…`), advertised as
 *     "TimeBox-mini-light". Driven over CoreBluetooth, so the App Store Swift
 *     daemon can drive it too; the Node daemon spawns `sync_ble.py` (bleak).
 *
 * A `TimeboxDevice` therefore carries exactly one of `port` (SPP) or `address`
 * (BLE) — `deviceId()` returns whichever is set as the stable key.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface TimeboxDevice {
  /** macOS Bluetooth SPP serial path, e.g. /dev/cu.TimeBox-Light-SPPDev. Set for the SPP variant. */
  port?: string;
  /** BLE address/UUID of the TimeBox-mini-light peripheral. Set for the BLE variant. */
  address?: string;
  name?: string;
  /** Software brightness scale applied while encoding pixels. */
  brightness?: number;
}

/** The configured transport for a device — derived from which field is set. */
export function deviceTransport(device: TimeboxDevice): 'ble' | 'spp' {
  return device.address ? 'ble' : 'spp';
}

/** Stable identity for a device — its BLE address or SPP serial path. */
export function deviceId(device: TimeboxDevice): string {
  return device.address ?? device.port ?? '';
}

const SETTINGS_DIR = join(homedir(), '.agentdeck');
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json');

function readSettings(): Record<string, unknown> {
  try {
    if (!existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

export function loadTimeboxDevices(): TimeboxDevice[] {
  const settings = readSettings();
  if (!Array.isArray(settings.timeboxDevices)) return [];
  return settings.timeboxDevices
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    // Keep a device only if it has exactly one transport identifier.
    .filter((d) => (typeof d.port === 'string') !== (typeof d.address === 'string'))
    .map((d) => ({
      port: typeof d.port === 'string' ? d.port : undefined,
      address: typeof d.address === 'string' ? d.address : undefined,
      name: typeof d.name === 'string' ? d.name : undefined,
      brightness: typeof d.brightness === 'number' ? d.brightness : undefined,
    }));
}

export function saveTimeboxDevices(devices: TimeboxDevice[]): void {
  const settings = readSettings();
  settings.timeboxDevices = devices;
  writeSettings(settings);
}

export function addTimeboxDevice(device: TimeboxDevice): boolean {
  const devices = loadTimeboxDevices();
  const id = deviceId(device);
  if (!id || devices.some((d) => deviceId(d) === id)) return false;
  devices.push(device);
  saveTimeboxDevices(devices);
  return true;
}

/** Remove a device by its BLE address or SPP serial path. */
export function removeTimeboxDevice(id: string): boolean {
  const devices = loadTimeboxDevices();
  const filtered = devices.filter((d) => deviceId(d) !== id);
  if (filtered.length === devices.length) return false;
  saveTimeboxDevices(filtered);
  return true;
}
