/**
 * The Web Serial-shaped adapter over `serialport`.
 *
 * `serialport` is an OPTIONAL native dependency, so the absent-module path is a
 * real production path — on any machine where the native build did not run. An
 * untested fallback is not a fallback, so it is driven here through a seam
 * rather than by uninstalling anything.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  NodeWebSerialPort,
  __setSerialPortForTests,
  listCandidatePorts,
  loadSerialPort,
} from '../esp32-flash-transport.js';

afterEach(() => {
  // undefined = "not resolved yet", which restores the real lazy import.
  __setSerialPortForTests(undefined);
});

describe('optional dependency', () => {
  it('reports absence rather than throwing MODULE_NOT_FOUND', async () => {
    __setSerialPortForTests(null);
    expect(await loadSerialPort()).toBeNull();
  });

  it('lists no candidates when serialport is missing — never a crash', async () => {
    __setSerialPortForTests(null);
    expect(await listCandidatePorts()).toEqual([]);
  });

  it('open() names the missing module instead of failing obscurely', async () => {
    __setSerialPortForTests(null);
    const port = new NodeWebSerialPort('/dev/cu.fake');
    await expect(port.open({ baudRate: 115200 })).rejects.toThrow(/serialport is not installed/);
  });
});

describe('port enumeration', () => {
  const fakeCtor = (list: Array<Record<string, string>>) =>
    ({ list: async () => list }) as never;

  it('keeps USB serial candidates and prefers the callout node', async () => {
    // macOS exposes each device twice; /dev/tty.* blocks on open until DCD
    // asserts, so only /dev/cu.* is usable here.
    __setSerialPortForTests(
      fakeCtor([
        { path: '/dev/tty.usbserial-1420', vendorId: '1a86', productId: '7523' },
        { path: '/dev/cu.usbmodem3111101' },
      ]),
    );
    const ports = await listCandidatePorts();
    expect(ports.map((p) => p.path)).toEqual(['/dev/cu.usbserial-1420', '/dev/cu.usbmodem3111101']);
    expect(ports[0].usbVendorId).toBe(0x1a86);
    expect(ports[0].usbProductId).toBe(0x7523);
  });

  it('drops Bluetooth and debug nodes', async () => {
    __setSerialPortForTests(
      fakeCtor([
        { path: '/dev/cu.Bluetooth-Incoming-Port' },
        { path: '/dev/cu.debug-console' },
        { path: '/dev/cu.wchusbserial56230292001' },
      ]),
    );
    expect((await listCandidatePorts()).map((p) => p.path)).toEqual([
      '/dev/cu.wchusbserial56230292001',
    ]);
  });

  it('accepts the Linux node names too', async () => {
    __setSerialPortForTests(fakeCtor([{ path: '/dev/ttyUSB0' }, { path: '/dev/ttyACM0' }]));
    expect((await listCandidatePorts()).map((p) => p.path)).toEqual(['/dev/ttyUSB0', '/dev/ttyACM0']);
  });
});

describe('setSignals', () => {
  /**
   * THE expensive lesson of the hardware spike: `serialport`'s `set()` applies
   * its own defaults to whatever you omit, while Web Serial lets a caller move
   * one line and leave the other. esptool-js re-sends DTR immediately after
   * every RTS change (a usbser.sys work-around), so a single-signal call
   * clobbers the other line on every reset strobe and the board never enters
   * the bootloader. The only symptom is "failed to connect".
   */
  it('writes BOTH lines on every call, whichever one was named', async () => {
    const sets: Array<{ dtr: boolean; rts: boolean }> = [];
    const fake = {
      isOpen: true,
      set(opts: { dtr: boolean; rts: boolean }, cb: (e: Error | null) => void) {
        sets.push({ ...opts });
        cb(null);
      },
    };
    const port = new NodeWebSerialPort('/dev/cu.fake');
    // Inject an already-open handle; open() itself needs real hardware.
    (port as unknown as { port: unknown }).port = fake;

    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await port.setSignals({ requestToSend: false });   // DTR must stay false
    await port.setSignals({ dataTerminalReady: true }); // RTS must stay false

    expect(sets).toEqual([
      { dtr: false, rts: true },
      { dtr: false, rts: false },
      { dtr: true, rts: false },
    ]);
    // Every call named both keys — never a partial write.
    expect(sets.every((s) => 'dtr' in s && 'rts' in s)).toBe(true);
  });

  it('is a no-op on a closed port rather than an error', async () => {
    const port = new NodeWebSerialPort('/dev/cu.fake');
    await expect(port.setSignals({ dataTerminalReady: true })).resolves.toBeUndefined();
  });
});
