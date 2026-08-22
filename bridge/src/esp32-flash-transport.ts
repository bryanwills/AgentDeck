/**
 * A Web Serial-shaped port over `serialport`, so the CLI can drive esptool-js.
 *
 * WHY A SHIM AND NOT AN EXTENSION OF `esp32-serial.ts`. That module opens a raw
 * fd and configures the line with `stty`, which can set baud and framing but
 * **cannot touch DTR or RTS** — those need `ioctl(TIOCMSET)`. DTR/RTS *are* the
 * ROM download-mode entry sequence, so there is no path from the existing
 * serial code to a flasher. `serialport`'s `set({dtr, rts})` is the missing
 * primitive, and once you have it, esptool-js needs only six members of a Web
 * Serial port — open/close/readable/writable/setSignals/getInfo — which is what
 * this class is.
 *
 * This exact adapter was what made the Phase 0 hardware spike possible: the
 * browser's `requestPort()` opens a native chooser no automation can drive, so
 * seven boards were measured headlessly through this code path before a byte
 * was ever written. It is not scaffolding that got reused; it is the thing that
 * was validated.
 *
 * `serialport` is an OPTIONAL dependency (native module, same class as
 * `node-pty` / `better-sqlite3` / `@resvg/resvg-js`), so every entry point here
 * has to survive its absence with an actionable message rather than a
 * MODULE_NOT_FOUND stack.
 */

import { Readable, Writable } from 'node:stream';

/** Loaded lazily so importing this module never fails on a machine without it. */
type SerialPortCtor = typeof import('serialport').SerialPort;

let cached: SerialPortCtor | null | undefined;

export async function loadSerialPort(): Promise<SerialPortCtor | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = await import('serialport');
    cached = mod.SerialPort;
  } catch {
    cached = null;
  }
  return cached;
}

/** @internal test seam — lets the absent-module path run without uninstalling anything. */
export function __setSerialPortForTests(ctor: SerialPortCtor | null | undefined): void {
  cached = ctor;
}

export interface PortCandidate {
  path: string;
  usbVendorId?: number;
  usbProductId?: number;
  manufacturer?: string;
}

/**
 * macOS exposes each USB serial device twice: `/dev/tty.*` blocks on open until
 * DCD asserts, `/dev/cu.*` does not. Only the callout node is usable here.
 */
const toCallout = (p: string): string => p.replace('/dev/tty.', '/dev/cu.');

/** Same predicate the serial bridge uses, so both agree on what is a candidate. */
const CANDIDATE = /usbserial|wchusbserial|usbmodem|ttyUSB|ttyACM/;
const EXCLUDE = /Bluetooth|WLAN|debug/i;

export async function listCandidatePorts(): Promise<PortCandidate[]> {
  const SerialPort = await loadSerialPort();
  if (!SerialPort) return [];
  const list = await SerialPort.list();
  return list
    .filter((p) => CANDIDATE.test(p.path) && !EXCLUDE.test(p.path))
    .map((p) => ({
      path: toCallout(p.path),
      usbVendorId: p.vendorId ? Number.parseInt(p.vendorId, 16) : undefined,
      usbProductId: p.productId ? Number.parseInt(p.productId, 16) : undefined,
      manufacturer: p.manufacturer,
    }));
}

interface OpenOpts {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  bufferSize?: number;
  flowControl?: string;
}

/**
 * The six members esptool-js touches, and nothing else. Structurally compatible
 * with `SerialPort` from the Web Serial types; cast at the call site.
 */
export class NodeWebSerialPort {
  private port?: InstanceType<SerialPortCtor>;
  private webReadable?: ReadableStream<Uint8Array>;
  private webWritable?: WritableStream<Uint8Array>;

  constructor(
    private readonly path: string,
    private readonly info: { usbVendorId?: number; usbProductId?: number } = {},
    private readonly ctor?: SerialPortCtor,
  ) {}

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return this.info;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.webReadable ?? null;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.webWritable ?? null;
  }

  async open(opts: OpenOpts): Promise<void> {
    const SerialPort = this.ctor ?? (await loadSerialPort());
    if (!SerialPort) throw new Error('serialport is not installed');
    // A fresh handle per open: Transport.connect() re-opens at a new baud, and
    // reusing the streams across a close would hand back a locked reader.
    await this.close();
    await new Promise<void>((resolve, reject) => {
      this.port = new SerialPort(
        {
          path: this.path,
          baudRate: opts.baudRate,
          dataBits: (opts.dataBits ?? 8) as 8,
          stopBits: (opts.stopBits ?? 1) as 1,
          parity: (opts.parity ?? 'none') as 'none',
          autoOpen: false,
          // Do NOT let the driver assert DTR/RTS on open. esptool drives the
          // reset sequence itself, and an implicit strobe here resets the board
          // at a moment the chosen strategy is not expecting.
          hupcl: false,
        },
        (err) => { if (err) reject(err); },
      );
      this.port.open((err) => (err ? reject(err) : resolve()));
    });
    this.webReadable = Readable.toWeb(this.port as unknown as Readable) as ReadableStream<Uint8Array>;
    this.webWritable = Writable.toWeb(this.port as unknown as Writable) as WritableStream<Uint8Array>;
  }

  /* --------------------------------------------------------------- signals */

  /**
   * ALWAYS WRITE BOTH LINES. This is the single most expensive thing the spike
   * learned.
   *
   * Web Serial lets a caller move one signal and leave the other alone;
   * `serialport`'s `set()` applies its OWN defaults to whatever you omit, so a
   * single-signal call silently moves the other line too. esptool-js's
   * `Transport.setRTS()` re-sends DTR immediately after RTS (a usbser.sys
   * work-around), so the clobber lands on every reset strobe and the board
   * never enters the ROM bootloader. The symptom is only ever "failed to
   * connect" — nothing points at the adapter. Every strategy failed on the
   * first probe run for exactly this reason.
   *
   * So the two lines are held here and both are written every time.
   */
  private dtr = false;
  private rts = false;

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    const p = this.port;
    if (!p?.isOpen) return;
    if (signals.dataTerminalReady !== undefined) this.dtr = signals.dataTerminalReady;
    if (signals.requestToSend !== undefined) this.rts = signals.requestToSend;
    await new Promise<void>((resolve, reject) =>
      p.set({ dtr: this.dtr, rts: this.rts }, (e: Error | null) => (e ? reject(e) : resolve())),
    );
  }

  async close(): Promise<void> {
    const p = this.port;
    this.webReadable = undefined;
    this.webWritable = undefined;
    this.port = undefined;
    if (!p) return;
    await new Promise<void>((resolve) => {
      if (!p.isOpen) return resolve();
      p.close(() => resolve());
    });
  }
}
