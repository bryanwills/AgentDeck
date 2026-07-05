import type { DeviceModule, BridgeContext } from './types.js';
import {
  startESP32Serial,
  stopESP32Serial,
  broadcastESP32,
  setESP32StateProvider,
  setESP32UsageProvider,
  setESP32DisplayStateProvider,
  setESP32SessionsListProvider,
  setESP32InitialStateProvider,
} from '../esp32-serial.js';
import type { BridgeEvent } from '../types.js';
import { existsSync } from 'fs';

export class SerialModule implements DeviceModule {
  readonly name = 'serial';
  private stateProvider: (() => BridgeEvent | null) | null = null;

  async shouldActivate(config: 'auto' | boolean): Promise<boolean> {
    if (config === false) return false;
    // Always activate for 'auto' or true: startESP32Serial() polls /dev every 10s
    // internally, so the module is harmless when no device is attached at daemon start.
    // Checking /dev at startup caused a bug where plugging in ESP32 *after* the daemon
    // started would never be detected (pollForDevices never ran).
    return true;
  }

  /** Set a function that provides the latest state event for ESP32 heartbeat.
   *  Can be called before or after start() — if already started, wires immediately. */
  setStateProvider(provider: () => BridgeEvent | null): void {
    this.stateProvider = provider;
    setESP32StateProvider(provider);
  }

  /** Set a function that provides the latest usage event for ESP32 heartbeat. */
  setUsageProvider(provider: () => BridgeEvent | null): void {
    setESP32UsageProvider(provider);
  }

  /** Set a function that provides the current display_state for heartbeat re-sync. */
  setDisplayStateProvider(provider: () => BridgeEvent | null): void {
    setESP32DisplayStateProvider(provider);
  }

  /** Set a function that provides the current sessions_list for heartbeat re-sync. */
  setSessionsListProvider(provider: () => BridgeEvent | null): void {
    setESP32SessionsListProvider(provider);
  }

  private initialStateProvider: (() => BridgeEvent[]) | null = null;

  /** Set a provider that returns all initial state events for newly connected devices. */
  setInitialStateProvider(provider: () => BridgeEvent[]): void {
    this.initialStateProvider = provider;
    setESP32InitialStateProvider(provider);
  }

  async start(ctx: BridgeContext): Promise<void> {
    startESP32Serial();
    if (this.stateProvider) {
      setESP32StateProvider(this.stateProvider);
    }
    ctx.wsServer.onBroadcast(broadcastESP32);
  }

  async stop(): Promise<void> {
    stopESP32Serial();
  }
}
