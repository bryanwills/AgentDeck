import type { DeviceModule, BridgeContext } from './types.js';
import { startPixooBridge, stopPixooBridge, broadcastPixoo, setPixooBroadcast } from '../pixoo/pixoo-bridge.js';
import { loadPixooDevices, isPixooAutoDiscoverEnabled } from '../pixoo/pixoo-settings.js';
import { autoDiscoverPixoo } from '../pixoo/pixoo-discover.js';

export class PixooModule implements DeviceModule {
  readonly name = 'pixoo';

  async shouldActivate(config: 'auto' | boolean): Promise<boolean> {
    if (config === false) return false;
    if (config === true) return true;
    // auto: a configured device OR auto-discovery may find one on the LAN.
    return loadPixooDevices().length > 0 || isPixooAutoDiscoverEnabled();
  }

  async start(ctx: BridgeContext): Promise<void> {
    const devices = loadPixooDevices();
    setPixooBroadcast((event) => ctx.wsServer.broadcast(event));
    startPixooBridge(devices);
    ctx.wsServer.onBroadcast(broadcastPixoo);

    // No device configured → run a background LAN discovery (cloud API, then a
    // bounded subnet sweep). startPixooBridge([]) above returned early without
    // registering its status listener, so re-calling it after discovery adds
    // devices wires the listener exactly once.
    if (devices.length === 0 && isPixooAutoDiscoverEnabled()) {
      void autoDiscoverPixoo().then((added) => {
        if (added > 0) startPixooBridge(loadPixooDevices());
      });
    }
  }

  async stop(): Promise<void> {
    await stopPixooBridge();
  }
}
