/**
 * Phase 0 / Stage 0 probe — connectivity only, ZERO flash writes.
 *
 * Answers the questions that block the whole web-flasher design, without
 * putting a byte on any board:
 *   - does esptool-js drive this chip family at all (ESP32-P4 / -C6 are unproven here)?
 *   - is the `--no-stub` axis expressible? (`main()` always runs the stub, so the
 *     no-stub path is detectChip() + skip runStub(); writeFlash has real
 *     IS_STUB===false branches, so the library supports ROM-loader flashing.)
 *   - does the board's declared upload baud actually survive on this link?
 *   - does the DETECTED flash size equal the declared one? This is the
 *     `ips_35` 8MB-misdetect and TC001 8MB trap, caught before any write.
 */

import { ESPLoader, Transport } from "esptool-js";
import { chipFamilyOf } from "./boards";
import type { BoardProfile, Before } from "./boards";

export interface Strategy {
  label: string;
  before: Before;
  stub: boolean;
}

export interface AttemptResult {
  strategy: Strategy;
  ok: boolean;
  chip?: string;
  mac?: string;
  flashSizeDetected?: string;
  flashId?: string;
  /** false when the SPI read returned all-ones/all-zeros, i.e. no answer at all */
  flashIdUsable?: boolean;
  /** did the link survive changing to the board's declared upload baud? */
  baudOk?: boolean;
  baudTried?: number;
  elapsedMs: number;
  error?: string;
  log: string[];
}

export interface ProbeResult {
  board: string;
  usbInfo: string;
  usbPid?: number;
  attempts: AttemptResult[];
  /** first strategy that connected, if any */
  winner?: Strategy;
  chipMatchesProfile?: boolean;
  flashSizeMatchesProfile?: boolean;
  /**
   * S0 verdict. "unknown flash" is its own answer, not a failure: the merged
   * image bakes its flash size at build time from the SSOT (and CI asserts it
   * with `esptool image-info`), so a board whose SPI id cannot be read
   * stublessly still flashes correctly — the runtime guard just degrades to
   * chip-family only, and that has to be SAID rather than hidden.
   */
  verdict: "pass" | "pass-unknown-flash" | "fail";
  pass: boolean;
  agent: string;
  at: string;
}

/**
 * Strategies in the order they are tried. The board's own platformio.ini
 * combination goes FIRST — those flags are accident records, not defaults.
 */
export function strategiesFor(p: BoardProfile): Strategy[] {
  const out: Strategy[] = [
    { label: "declared", before: p.before, stub: p.stub },
    { label: "default+stub", before: "default_reset", stub: true },
    { label: "default+nostub", before: "default_reset", stub: false },
    { label: "noreset+nostub", before: "no_reset", stub: false },
  ];
  if (p.nativeUsb) out.push({ label: "usb_reset+stub", before: "usb_reset", stub: true });
  out.push({ label: "nosync+nostub", before: "no_reset_no_sync", stub: false });

  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.before}/${s.stub}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Every attempt is bounded. `no_reset_no_sync` deliberately skips the sync
 * handshake, so against a board that is not in the bootloader the very first
 * read has nothing to wait for and never returns — the attempt hangs instead of
 * failing. A probe that can hang is not a probe.
 */
export const ATTEMPT_TIMEOUT_MS = 45_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms (${label})`)), ms);
    work.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export {
  esp32FlashIdIsUsable as flashIdIsUsable,
  esp32FlashSizeIsSafe as flashSizeIsSafe,
} from "../../shared/src/esp32-boards.js";
import {
  esp32FlashIdIsUsable as flashIdIsUsable,
  esp32FlashSizeIsSafe as flashSizeIsSafe,
} from "../../shared/src/esp32-boards.js";

async function runOne(
  device: SerialPort,
  profile: BoardProfile,
  strategy: Strategy,
  testBaud: boolean,
): Promise<AttemptResult> {
  const log: string[] = [];
  const t0 = performance.now();
  const bounded = <T>(w: Promise<T>, label: string) => withTimeout(w, ATTEMPT_TIMEOUT_MS, label);
  const terminal = {
    clean() {},
    writeLine(d: string) { log.push(d); },
    write(d: string) { log.push(d); },
  };
  let transport: Transport | undefined;
  try {
    transport = new Transport(device, false);
    const loader = new ESPLoader({
      transport,
      baudrate: profile.uploadBaud,
      terminal,
      debugLogging: false,
    });

    let chip: string;
    if (strategy.stub) {
      // main() = detectChip + describe + runStub + changeBaud + readFlashId
      chip = await bounded(loader.main(strategy.before), "main");
    } else {
      // The no-stub equivalent of main(): everything except runStub().
      await bounded(loader.detectChip(strategy.before), "detectChip");
      chip = await loader.chip.getChipDescription(loader);
      if (loader.chip.postConnect) await loader.chip.postConnect(loader);
    }

    const mac = await bounded(loader.chip.readMac(loader), "readMac");
    const flashId = (await bounded(loader.readFlashId(), "readFlashId")).toString(16);
    const usable = flashIdIsUsable(flashId);
    // Only ask for a size when the id was real; otherwise record "unknown"
    // rather than letting detectFlashSize() invent 4MB.
    const flashSizeDetected = usable
      ? await bounded(loader.detectFlashSize(), "detectFlashSize")
      : undefined;

    let baudOk: boolean | undefined;
    let baudTried: number | undefined;
    if (testBaud && profile.uploadBaud !== 115200) {
      baudTried = profile.uploadBaud;
      try {
        // changeBaud() works on the ROM loader too (secondArg = IS_STUB ? romBaudrate : 0).
        // main() already did this for the stub path; only the no-stub path needs it here.
        if (!strategy.stub) await bounded(loader.changeBaud(), "changeBaud");
        // prove the link still answers after the baud change
        await bounded(loader.readFlashId(), "readFlashId@baud");
        baudOk = true;
      } catch (e) {
        baudOk = false;
        log.push(`baud ${profile.uploadBaud} failed: ${String(e)}`);
      }
    }

    // Leave the board running. after('hard_reset') on a no_reset profile would
    // contradict its declared --after, so honour the profile.
    try { await loader.after(profile.after === "no_reset" ? "no_reset" : "hard_reset"); } catch { /* best effort */ }

    return {
      strategy, ok: true, chip, mac, flashId, flashIdUsable: usable, flashSizeDetected,
      baudOk, baudTried, elapsedMs: Math.round(performance.now() - t0), log,
    };
  } catch (e) {
    return {
      strategy, ok: false, error: e instanceof Error ? e.message : String(e),
      elapsedMs: Math.round(performance.now() - t0), log,
    };
  } finally {
    try { await transport?.disconnect(); } catch { /* ignore */ }
  }
}

export async function probeBoard(
  device: SerialPort,
  profile: BoardProfile,
  opts: { testBaud?: boolean; only?: string; onAttempt?: (r: AttemptResult) => void } = {},
): Promise<ProbeResult> {
  const attempts: AttemptResult[] = [];
  let winner: Strategy | undefined;

  const list = opts.only
    ? strategiesFor(profile).filter((s) => s.label === opts.only)
    : strategiesFor(profile);
  for (const strategy of list) {
    const r = await runOne(device, profile, strategy, opts.testBaud ?? true);
    attempts.push(r);
    opts.onAttempt?.(r);
    if (r.ok) { winner = strategy; break; }
    // a failed attempt can leave the chip mid-handshake; let it settle
    await new Promise((res) => setTimeout(res, 400));
  }

  const win = attempts.find((a) => a.ok);
  const chipMatchesProfile = win?.chip ? chipFamilyOf(win.chip) === profile.chipFamily : undefined;
  const flashSizeMatchesProfile = flashSizeIsSafe(profile.flashSize, win?.flashSizeDetected);

  let usbInfo = "";
  let usbPid: number | undefined;
  try {
    const t = new Transport(device, false);
    usbInfo = t.getInfo();
    usbPid = t.getPid();
  } catch { /* ignore */ }

  return {
    board: profile.id,
    usbInfo,
    usbPid,
    attempts,
    winner,
    chipMatchesProfile,
    flashSizeMatchesProfile,
    verdict: !win || !chipMatchesProfile
      ? "fail"
      : flashSizeMatchesProfile === undefined
        ? "pass-unknown-flash"
        : flashSizeMatchesProfile
          ? "pass"
          : "fail",
    pass: Boolean(win && chipMatchesProfile && flashSizeMatchesProfile !== false),
    agent: navigator.userAgent,
    at: new Date().toISOString(),
  };
}
