import type { BridgeContext, DeviceModule } from './types.js';
import { loadTimeboxDevices, deviceTransport, deviceId } from '../timebox/timebox-settings.js';
import { startTimeboxSync, stopTimeboxSync } from '../timebox/timebox-daemon-sync.js';

export class TimeboxModule implements DeviceModule {
  readonly name = 'timebox';

  async shouldActivate(config: 'auto' | boolean): Promise<boolean> {
    if (config === false) return false;
    if (config === true) return true;
    return loadTimeboxDevices().length > 0;
  }

  async start(ctx: BridgeContext): Promise<void> {
    startTimeboxSync(ctx.port);
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
        transport: deviceTransport(d),
        port: d.port,
        address: d.address,
        name: d.name ?? 'Timebox Mini',
        brightness: d.brightness ?? 100,
      })),
    };
  }
}

