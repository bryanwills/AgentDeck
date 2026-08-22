/**
 * The write path — one merged image, one offset, one guard that cannot be
 * clicked through.
 *
 * SHAPE OF THE WRITE. `scripts/esp32-merge-firmware.mjs` produces
 * `agentdeck-<board>-merged.bin`, written at **0x0 on every chip**. Classic
 * ESP32 keeps its bootloader at 0x1000 *inside* the image behind 0xFF padding
 * the ROM never reads, so nothing here branches on chip family — the
 * three-valued `bootloaderOffset` is an audit field, not a runtime input. The
 * flash mode/freq/size come from the manifest (i.e. from the board SSOT), never
 * from `detect`/`keep`: `keep` would preserve whatever a bricked board has in
 * its header, which is the state a user is usually flashing to escape.
 *
 * ORDER OF OPERATIONS. Connect → identify → **preflight** → write. The
 * preflight runs after the chip answers and before a single byte is sent,
 * because the two mistakes worth preventing (an S3 image on a classic ESP32; a
 * 16MB-header image on an 8MB part) are only visible once the chip has spoken.
 */

import { ESPLoader, Transport } from "esptool-js";
import { esp32PreflightVerdict } from "../../shared/src/esp32-boards.js";
import type { Esp32PreflightVerdict } from "../../shared/src/esp32-boards.js";
import { flashIdIsUsable } from "./probe";
import type { BoardProfile } from "./boards";
import type { ManifestBoard } from "./manifest";
import { md5 } from "./md5";

export interface IdentifiedChip {
  chip: string;
  mac: string;
  flashId: string;
  /** undefined when the flash id was unreadable — see esp32FlashIdIsUsable */
  flashSize: string | undefined;
  verdict: Esp32PreflightVerdict;
}

export type FlashPhase = "connect" | "identify" | "erase" | "write" | "verify" | "done";

export interface FlashCallbacks {
  onPhase?: (phase: FlashPhase) => void;
  onProgress?: (written: number, total: number) => void;
  onLog?: (line: string) => void;
}

/** Everything a session needs after `connect()`, so the UI can identify then write. */
export interface FlashSession {
  loader: ESPLoader;
  transport: Transport;
  identified: IdentifiedChip;
}

function terminalFor(onLog?: (line: string) => void) {
  return {
    clean() {},
    writeLine(d: string) { onLog?.(d); },
    write(d: string) { onLog?.(d); },
  };
}

/**
 * Connect, identify, and decide. Returns a live session — the caller inspects
 * `identified.verdict` and only then calls `writeMerged`.
 */
export async function connectAndIdentify(
  device: SerialPort,
  profile: BoardProfile,
  entry: ManifestBoard | undefined,
  cb: FlashCallbacks = {},
): Promise<FlashSession> {
  cb.onPhase?.("connect");
  const transport = new Transport(device, false);
  const loader = new ESPLoader({
    transport,
    baudrate: profile.uploadBaud,
    terminal: terminalFor(cb.onLog),
    debugLogging: false,
  });

  // A FAILURE HERE MUST RELEASE THE PORT. Failing to connect is the COMMON
  // path — a board that is not in download mode — and Web Serial keeps the port
  // open and locked to this page until someone closes it. Leaking it makes the
  // user's next attempt fail with "already open", which this page reports as
  // "the daemon is holding the port": a diagnosis that is wrong and that the
  // user cannot act on, because the page itself is the holder.
  try {
    let chip: string;
    if (profile.stub) {
      chip = await loader.main(profile.before);
    } else {
      // The no-stub equivalent of main(): everything except runStub(). Measured
      // on a TTGO T-Display 2026-08-22 — writeFlash has real IS_STUB === false
      // branches, so the ROM loader really does flash.
      await loader.detectChip(profile.before);
      chip = await loader.chip.getChipDescription(loader);
      if (loader.chip.postConnect) await loader.chip.postConnect(loader);
      if (profile.uploadBaud !== 115200) await loader.changeBaud();
    }

    cb.onPhase?.("identify");
    const mac = await loader.chip.readMac(loader);
    const flashId = (await loader.readFlashId()).toString(16);
    // Ask for a size only when the id was real. detectFlashSize() answers "4MB"
    // when it cannot decode the id, so trusting it turns "no answer" into a
    // confident wrong number — and this number gates the write.
    const flashSize = flashIdIsUsable(flashId) ? await loader.detectFlashSize() : undefined;

    const verdict = esp32PreflightVerdict({
      board: profile,
      surface: "browser",
      detectedChip: chip,
      detectedFlashSize: flashSize,
      // The page ships from master; its manifest comes from whichever release
      // Pages deployed. So the geometry the guard checks and the geometry
      // written into the flash-params header can legitimately differ, and
      // checking only the bundled spec would validate a number nobody writes.
      imageGeometry: entry
        ? { chipFamily: entry.chipFamily, flashSize: entry.flashSize }
        : undefined,
    });

    // On SUCCESS the session stays open on purpose: a refusing verdict is
    // usually followed by "pick the right board", and making the user re-enter
    // download mode to hear a second refusal is how a guard earns a reputation
    // for being the problem. `finish()` is the caller's release.
    return { loader, transport, identified: { chip, mac, flashId, flashSize, verdict } };
  } catch (e) {
    await bounded(transport.disconnect(), 4000);
    throw e;
  }
}

export interface WriteResult {
  bytes: number;
  elapsedMs: number;
}

/**
 * Write the merged image at 0x0 and verify it by MD5 against the chip.
 *
 * `mayWrite` is re-checked here even though the caller already saw it. The
 * button that starts a write and the code that performs it must not share a
 * failure mode: a UI state left enabled by a rendering bug would otherwise be
 * the whole guard.
 */
export async function writeMerged(
  session: FlashSession,
  board: ManifestBoard,
  image: Uint8Array,
  opts: { eraseAll?: boolean } = {},
  cb: FlashCallbacks = {},
): Promise<WriteResult> {
  if (!session.identified.verdict.mayWrite) {
    throw new Error(`refusing to write: preflight verdict ${session.identified.verdict.code}`);
  }
  if (opts.eraseAll && !board.stub) {
    // esptool-js honours eraseAll only on the stub path. Silently skipping it
    // returns a board still holding the previous owner's Wi-Fi credentials and
    // pairing token, having just shown "erase" and "MD5 verified".
    throw new Error("erase-unavailable");
  }
  const t0 = performance.now();
  cb.onPhase?.(opts.eraseAll ? "erase" : "write");

  await session.loader.writeFlash({
    // ONE file, at 0x0, on every chip. `esptool merge-bin --target-offset 0x0`
    // already placed each board's bootloader where its ROM looks for it, so no
    // consumer branches on chip family.
    fileArray: [{ data: image, address: 0x0 }],
    // Never "keep": that would preserve whatever header a bricked board is
    // carrying, and escaping a bad header is usually why someone is here. These
    // come from the manifest, i.e. from the same SSOT that baked them into the
    // merged image at build time.
    flashMode: board.flashMode,
    flashFreq: board.flashFreq,
    flashSize: board.flashSize,
    // Reachable only for stub boards — the no-stub case was refused above,
    // because esptool-js drops eraseAll silently on the ROM loader.
    eraseAll: opts.eraseAll ?? false,
    compress: true,
    reportProgress: (_i, written, total) => {
      cb.onPhase?.("write");
      cb.onProgress?.(written, total);
    },
    // The chip hashes what it stored; we hash what we sent, AFTER esptool-js has
    // patched the flash-params header — which is why this is a callback and not
    // a hash of `image`. A mismatch throws out of writeFlash, so this is a real
    // gate, not a printed statistic.
    calculateMD5Hash: (patched: Uint8Array) => md5(patched),
  });

  cb.onPhase?.("verify");
  return { bytes: image.length, elapsedMs: Math.round(performance.now() - t0) };
}

/**
 * Bound a teardown await that can never be trusted to return.
 *
 * `Transport.disconnect()` spins in `waitForUnlock()` with no deadline, and
 * `Transport.write()` has no try/finally — so a write rejected by an unplugged
 * board leaves the stream locked and that spin never exits. Here the cost of
 * inheriting the hang is the probe button staying disabled forever with no
 * explanation, which reads as a frozen page.
 */
async function bounded(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Reset the board into the firmware and drop the port. Never throws, never hangs. */
export async function finish(session: FlashSession, profile: BoardProfile): Promise<void> {
  await bounded(
    session.loader.after(profile.after === "no_reset" ? "no_reset" : "hard_reset"),
    4000,
  );
  await bounded(session.transport.disconnect(), 4000);
}
