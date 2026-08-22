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
 *
 * The session stays OPEN on a refusing verdict rather than disconnecting: the
 * user's next move is usually "pick the right board", and making them re-enter
 * download mode to hear a second refusal is how a guard earns a reputation for
 * being the problem.
 */
export async function connectAndIdentify(
  device: SerialPort,
  profile: BoardProfile,
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

  let chip: string;
  if (profile.stub) {
    chip = await loader.main(profile.before);
  } else {
    // The no-stub equivalent of main(): everything except runStub(). Measured on
    // a TTGO T-Display 2026-08-22 — writeFlash has real IS_STUB === false
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
  });

  return { loader, transport, identified: { chip, mac, flashId, flashSize, verdict } };
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
    // esptool-js only honours eraseAll on the stub path (`IS_STUB === true`),
    // so on a --no-stub board this is a no-op rather than an error. Said here
    // because a silently ignored "erase everything" is worth knowing about.
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

/** Reset the board into the firmware and drop the port. */
export async function finish(session: FlashSession, profile: BoardProfile): Promise<void> {
  try {
    await session.loader.after(profile.after === "no_reset" ? "no_reset" : "hard_reset");
  } catch { /* best effort — the write already landed */ }
  try { await session.transport.disconnect(); } catch { /* ignore */ }
}
