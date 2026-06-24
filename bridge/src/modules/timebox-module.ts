import type { BridgeContext, DeviceModule } from './types.js';
import {
  loadTimeboxDevices,
  deviceId,
  isTimeboxAutoDiscoverEnabled,
} from '../timebox/timebox-settings.js';
import { startTimeboxSync, stopTimeboxSync } from '../timebox/timebox-daemon-sync.js';
import { autoDiscoverTimebox } from '../timebox/timebox-discover.js';

export class TimeboxModule implements DeviceModule {
  readonly name = 'timebox';

  async shouldActivate(config: 'auto' | boolean): Promise<boolean> {
    if (config === false) return false;
    if (config === true) return true;
    // Activate when a device is configured OR auto-discovery may find one.
    return loadTimeboxDevices().length > 0 || isTimeboxAutoDiscoverEnabled();
  }

  async start(ctx: BridgeContext): Promise<void> {
    // Start sync for any already-configured device immediately, then run a
    // background BLE scan if none is configured. Discovery is non-blocking so
    // daemon startup isn't delayed by the ~5s scan; when it adds a device we
    // re-invoke startTimeboxSync (idempotent per-address) to pick it up.
    startTimeboxSync(ctx.port);
    if (loadTimeboxDevices().length === 0 && isTimeboxAutoDiscoverEnabled()) {
      void autoDiscoverTimebox().then((added) => {
        if (added > 0) startTimeboxSync(ctx.port);
      });
    }
  }

  async stop(): Promise<void> {
    stopTimeboxSync();
  }

  statusSnapshot(): Record<string, unknown> {
    const devices = loadTimeboxDevices();
    return {
      configuredDeviceCount: devices.length,
      devices: devices.map((d) => ({
        id: deviceId(d),
        transport: 'ble',
        address: d.address,
        name: d.name ?? 'Timebox Mini',
        brightness: d.brightness ?? 100,
      })),
    };
  }
}

