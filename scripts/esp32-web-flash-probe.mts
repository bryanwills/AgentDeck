/**
 * Phase 0 / Stage 0 headless probe — runs the SAME esptool-js code the web
 * flasher will run, against real boards, with ZERO flash writes.
 *
 * Why not just click through the browser page: `navigator.serial.requestPort()`
 * opens a native Chrome chooser that no automation can drive. esptool-js only
 * touches six members of a Web Serial port (open/close/readable/writable/
 * setSignals/getInfo), so a small adapter over `serialport` lets the identical
 * probe run headlessly across the whole fleet. That adapter is also exactly what
 * `agentdeck esp32 flash` needs later, so this is not throwaway scaffolding.
 *
 * Usage:
 *   npx tsx scripts/esp32-web-flash-probe.mts                # every on-hand board it can match
 *   npx tsx scripts/esp32-web-flash-probe.mts --board 86box  # one board
 *   npx tsx scripts/esp32-web-flash-probe.mts --port /dev/cu.x --board ips_10
 *
 * ALWAYS free the serial port first (`agentdeck daemon stop`, quit the macOS
 * app). Every open() toggles DTR/RTS and resets the attached board.
 */
import { SerialPort as NodeSerialPort } from "serialport";
import { Readable, Writable } from "node:stream";
import { writeFileSync, mkdirSync } from "node:fs";
import { BOARDS, boardById, type BoardProfile } from "../tools/web-flasher/boards.js";
import { probeBoard, type ProbeResult } from "../tools/web-flasher/probe.js";

/* ------------------------------------------------ Web Serial shim over serialport */
interface OpenOpts {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  bufferSize?: number;
  flowControl?: string;
}

class NodeWebSerialPort {
  private port?: NodeSerialPort;
  private webReadable?: ReadableStream<Uint8Array>;
  private webWritable?: WritableStream<Uint8Array>;

  constructor(
    private readonly path: string,
    private readonly info: { usbVendorId?: number; usbProductId?: number },
  ) {}

  getInfo() {
    return this.info;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.webReadable ?? null;
  }
  get writable(): WritableStream<Uint8Array> | null {
    return this.webWritable ?? null;
  }

  async open(opts: OpenOpts): Promise<void> {
    // A fresh handle per open: Transport.connect() re-opens at a new baud, and
    // reusing streams across a close would hand back a locked reader.
    await this.close();
    await new Promise<void>((resolve, reject) => {
      this.port = new NodeSerialPort(
        {
          path: this.path,
          baudRate: opts.baudRate,
          dataBits: (opts.dataBits ?? 8) as 8,
          stopBits: (opts.stopBits ?? 1) as 1,
          parity: (opts.parity ?? "none") as "none",
          autoOpen: false,
          // Do NOT let the driver assert DTR/RTS on open: esptool drives the
          // reset sequence itself, and an implicit strobe here would reset the
          // board at a moment the reset strategy is not expecting.
          hupcl: false,
        },
        (err) => { if (err) reject(err); },
      );
      this.port.open((err) => (err ? reject(err) : resolve()));
    });
    this.webReadable = Readable.toWeb(this.port!) as ReadableStream<Uint8Array>;
    this.webWritable = Writable.toWeb(this.port!) as WritableStream<Uint8Array>;
  }

  /**
   * Web Serial lets a caller move ONE signal and leave the other alone;
   * serialport's set() applies its own defaults to whatever you omit, so a
   * single-signal call silently moves the other line too. esptool-js's
   * Transport.setRTS() re-sends DTR immediately after RTS (a usbser.sys
   * work-around), so the clobber lands on every reset strobe and the board
   * never enters the ROM bootloader — which reads as "failed to connect",
   * not as "the adapter is wrong".
   *
   * So: hold both lines here and always write both.
   */
  private dtr = false;
  private rts = false;

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    const p = this.port;
    if (!p?.isOpen) return;
    if (signals.dataTerminalReady !== undefined) this.dtr = signals.dataTerminalReady;
    if (signals.requestToSend !== undefined) this.rts = signals.requestToSend;
    await new Promise<void>((resolve, reject) =>
      p.set({ dtr: this.dtr, rts: this.rts }, (e) => (e ? reject(e) : resolve())),
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

/* ------------------------------------------------------------------ port lookup */
const CU = (ttyPath: string) => ttyPath.replace("/dev/tty.", "/dev/cu.");

async function listPorts() {
  const list = await NodeSerialPort.list();
  return list
    .filter((p) => /usbserial|wchusbserial|usbmodem|ttyUSB|ttyACM/.test(p.path))
    .filter((p) => !/Bluetooth|WLAN|debug/i.test(p.path))
    .map((p) => ({
      path: CU(p.path),
      usbVendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
      usbProductId: p.productId ? parseInt(p.productId, 16) : undefined,
    }));
}

/* --------------------------------------------------------------------- runner */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const wantBoard = arg("board");
  const wantPort = arg("port");
  const ports = await listPorts();

  if (ports.length === 0) {
    console.error("No candidate serial ports. Is anything plugged in?");
    process.exit(1);
  }

  console.log("Ports:");
  for (const p of ports) {
    console.log(
      `  ${p.path}  ${p.usbVendorId ? `${p.usbVendorId.toString(16)}:${p.usbProductId?.toString(16)}` : "(no usb ids)"}`,
    );
  }
  console.log();

  // Pairing is explicit on purpose. There is no VID/PID → board mapping in this
  // repo (identity comes from the firmware's own device_info), and guessing a
  // board from a usbmodem number is the exact mistake esp32/scripts/flash.sh
  // refuses to make.
  const targets: { profile: BoardProfile; path: string }[] = [];
  if (wantBoard && wantPort) {
    const p = boardById(wantBoard);
    if (!p) throw new Error(`unknown board ${wantBoard}`);
    targets.push({ profile: p, path: wantPort });
  } else if (wantBoard) {
    throw new Error("--board needs --port (this tool never guesses which board is on which port)");
  } else {
    const map = process.env.PROBE_MAP;
    if (!map) {
      console.error(
        "Set PROBE_MAP='board=port,board=port' or pass --board X --port Y.\n" +
          "Boards: " + BOARDS.filter((b) => b.onHand).map((b) => b.id).join(", "),
      );
      process.exit(1);
    }
    for (const pair of map.split(",")) {
      const [id, path] = pair.split("=");
      const prof = boardById(id.trim());
      if (!prof) throw new Error(`unknown board ${id}`);
      targets.push({ profile: prof, path: path.trim() });
    }
  }

  const results: ProbeResult[] = [];
  for (const { profile, path } of targets) {
    const info = ports.find((p) => p.path === path) ?? {};
    console.log(`=== ${profile.id} (${profile.chipFamily}) on ${path}`);
    const device = new NodeWebSerialPort(path, {
      usbVendorId: (info as { usbVendorId?: number }).usbVendorId,
      usbProductId: (info as { usbProductId?: number }).usbProductId,
    });
    const res = await probeBoard(device as unknown as SerialPort, profile, {
      testBaud: true,
      only: arg("strategy"),
      onAttempt: (a) =>
        console.log(
          `   ${a.ok ? "ok  " : "FAIL"} ${a.strategy.label.padEnd(16)} ` +
            `${a.strategy.before}/${a.strategy.stub ? "stub" : "no-stub"} ` +
            `${a.chip ?? ""} ${a.flashSizeDetected ?? ""} ` +
            `${a.baudTried ? `baud${a.baudTried}:${a.baudOk ? "ok" : "FAIL"}` : ""}` +
            `${a.error ? ` — ${a.error.slice(0, 90)}` : ""}`,
        ),
    });
    console.log(
      `   → ${res.verdict.toUpperCase()} chipMatch=${res.chipMatchesProfile} flashMatch=${res.flashSizeMatchesProfile ?? "unknown"}\n`,
    );
    results.push(res);
    await device.close();
  }

  mkdirSync("diagnostics/esp32-web-flash-probe", { recursive: true });
  const out = `diagnostics/esp32-web-flash-probe/probe-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${out}`);
  console.log(
    "\nSummary:\n" +
      results
        .map(
          (r) =>
            `  ${r.verdict.padEnd(19)} ${r.board.padEnd(16)} ` +
            `${r.winner ? `${r.winner.before}/${r.winner.stub ? "stub" : "no-stub"}` : "no strategy connected"}`,
        )
        .join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
