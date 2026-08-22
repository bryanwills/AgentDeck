/**
 * `agentdeck esp32 flash <board>` — the reliable half of the firmware install
 * story. (The browser flasher at /flash/ is the reachable half.)
 *
 * WHAT IT WRITES. One `agentdeck-<board>-merged.bin` at offset 0x0, on every
 * chip. `esptool merge-bin --target-offset 0x0` has already put each board's
 * bootloader where its ROM looks for it — classic ESP32 at 0x1000 inside the
 * image, P4 at 0x2000, S3/C6 at 0x0 — so nothing downstream branches on chip
 * family. The old release notes told users to write the app alone at 0x10000,
 * which cannot bring a board up: `boot_app0.bin` was never published, so a
 * stale otadata boots the previous slot.
 *
 * WHAT IT WILL NOT WRITE. The preflight in `@agentdeck/shared` is shared
 * verbatim with the browser, and there is no `--force`. Writing an S3 image to
 * a classic ESP32, or a 16MB-header image to an 8MB part, is how these boards
 * get bricked — and the recovery tool for a bricked board is this one.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ESPLoader, Transport } from './esptool-js-node.js';
import {
  ESP32_BOARD_BY_TARGET,
  esp32FlashIdIsUsable,
  esp32PreflightVerdict,
  type Esp32BoardSpec,
  type Esp32PreflightVerdict,
} from '@agentdeck/shared';
import { getDataDir } from './session-registry.js';
import { listCandidatePorts, loadSerialPort, NodeWebSerialPort } from './esp32-flash-transport.js';

const execFileAsync = promisify(execFile);

export const GITHUB_REPO = 'puritysb/AgentDeck';

/* ------------------------------------------------------------ board lookup */

export function resolveFlashBoard(target: string): Esp32BoardSpec {
  const board = ESP32_BOARD_BY_TARGET[target];
  if (!board) {
    const known = Object.keys(ESP32_BOARD_BY_TARGET).sort().join(', ');
    throw new Error(`unknown board "${target}". Known targets: ${known}`);
  }
  return board;
}

/* --------------------------------------------------------- release manifest
 * The CLI reads the manifest from the RELEASE, not from Pages. It is not in a
 * browser so CORS is irrelevant, and Pages can lag a firmware cut by a whole
 * master push — reading the release is both simpler and more current.
 */

export interface ManifestArtifact { file: string; size: number; sha256: string; offset: string }
export interface ManifestBoardEntry {
  id: string;
  chipFamily: string;
  flashSize: string;
  flashMode: string;
  flashFreq: string;
  uploadBaud: number;
  merged?: ManifestArtifact;
}
export interface ReleaseManifest {
  schema: number;
  release: string;
  firmwareVersion: string;
  boards: ManifestBoardEntry[];
}

const api = async (path: string): Promise<unknown> => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agentdeck-cli' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  return res.json();
};

/** Newest `esp32-v*` tag, or undefined when the repo has none. */
export async function latestFirmwareTag(): Promise<string | undefined> {
  const releases = (await api(`/repos/${GITHUB_REPO}/releases?per_page=100`)) as Array<{
    tag_name?: string;
    created_at?: string;
  }>;
  return releases
    .filter((r) => typeof r.tag_name === 'string' && r.tag_name.startsWith('esp32-v'))
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))[0]?.tag_name;
}

export function firmwareVersionFromCheckout(configH: string): string | undefined {
  const m = /FIRMWARE_VERSION\s*=\s*"([^"]+)"/.exec(configH);
  return m?.[1];
}

export function firmwareCacheDir(tag: string): string {
  return join(getDataDir(), 'firmware', tag);
}

const sha256 = (buf: Buffer | Uint8Array): string =>
  createHash('sha256').update(buf).digest('hex');

async function downloadAsset(tag: string, file: string, dest: string): Promise<void> {
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${file}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${file} → HTTP ${res.status} (${url})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, dest);
}

export interface ResolveFirmwareOptions {
  tag?: string;
  /** an explicit .bin — skips the download entirely, mirroring esp32-ota's -f */
  firmwarePath?: string;
  /** fail instead of reaching the network */
  offline?: boolean;
  /** the repo checkout's esp32/src/config.h, when running from a checkout */
  checkoutConfigH?: string;
  log?: (msg: string) => void;
}

export interface ResolvedFirmware {
  tag: string;
  image: Buffer;
  /** the manifest entry, when one was used; absent for --firmware */
  entry?: ManifestBoardEntry;
  source: 'file' | 'cache' | 'download';
  path?: string;
}

/**
 * Get the merged image for a board, verifying its sha256 EVERY time — on a
 * fresh download and on every cache hit. The cache key proves which release a
 * file came from, never that its bits are still intact, and a bit-rotted cached
 * image is a bricked board.
 */
export async function resolveFirmware(
  board: Esp32BoardSpec,
  opts: ResolveFirmwareOptions = {},
): Promise<ResolvedFirmware> {
  const log = opts.log ?? (() => {});

  if (opts.firmwarePath) {
    if (!existsSync(opts.firmwarePath)) throw new Error(`no such firmware file: ${opts.firmwarePath}`);
    // An explicit path is the user overriding the manifest, so there is no hash
    // to check against — say so rather than implying it was verified.
    log(`Using ${opts.firmwarePath} (no manifest hash to check against)`);
    return {
      tag: 'local',
      image: readFileSync(opts.firmwarePath),
      source: 'file',
      path: opts.firmwarePath,
    };
  }

  let tag = opts.tag;
  if (!tag && opts.checkoutConfigH) {
    const v = firmwareVersionFromCheckout(opts.checkoutConfigH);
    if (v) tag = `esp32-v${v}`;
  }
  if (!tag) {
    if (opts.offline) throw new Error('--offline needs --tag or --firmware; nothing to resolve');
    tag = await latestFirmwareTag();
    if (!tag) throw new Error(`no esp32-v* release found in ${GITHUB_REPO}`);
  }

  const dir = firmwareCacheDir(tag);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    if (opts.offline) throw new Error(`--offline: no cached manifest for ${tag} at ${manifestPath}`);
    log(`Fetching manifest for ${tag}…`);
    try {
      await downloadAsset(tag, 'manifest.json', manifestPath);
    } catch (e) {
      // A 404 here is not a network fault — every esp32-v* up to 1.0.6 predates
      // the merged-image pipeline and publishes no manifest at all. Saying so
      // points at the fix; "HTTP 404" points at nothing.
      if (/HTTP 404/.test(String(e))) {
        throw new Error(
          `${tag} publishes no manifest.json — it predates the merged-image pipeline.\n` +
            '  Use a newer --tag, or pass --firmware with a locally built image.',
        );
      }
      throw e;
    }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
  const entry = manifest.boards.find((b) => b.id === board.id);
  if (!entry?.merged) {
    throw new Error(
      `${tag} publishes no merged image for ${board.id}. ` +
        'Releases before the merged-image pipeline have none — use a newer --tag, or --firmware.',
    );
  }

  const imagePath = join(dir, entry.merged.file);
  let source: ResolvedFirmware['source'] = 'cache';
  if (!existsSync(imagePath) || sha256(readFileSync(imagePath)) !== entry.merged.sha256) {
    if (opts.offline) throw new Error(`--offline: ${entry.merged.file} is not cached (or failed its hash)`);
    log(`Downloading ${entry.merged.file} (${(entry.merged.size / 1e6).toFixed(1)} MB)…`);
    await downloadAsset(tag, entry.merged.file, imagePath);
    source = 'download';
  }

  const image = readFileSync(imagePath);
  const got = sha256(image);
  if (got !== entry.merged.sha256) {
    throw new Error(
      `${entry.merged.file}: sha256 ${got} ≠ manifest ${entry.merged.sha256}. Refusing to write unverified bits.`,
    );
  }
  if (image.length !== entry.merged.size) {
    throw new Error(`${entry.merged.file}: ${image.length} bytes, manifest says ${entry.merged.size}`);
  }
  return { tag, image, entry, source, path: imagePath };
}

/* --------------------------------------------------------------- port state
 * `lsof` is the CLI's answer to the one thing the browser flasher genuinely
 * cannot do. The lease stops the NODE daemon, but the sandboxed Swift daemon
 * cannot read `~/.agentdeck`, so "I asked it to stand down" is not evidence
 * the port is free. Looking is.
 */

export interface PortHolder { command: string; pid: number }

export async function whoHoldsPort(port: string): Promise<PortHolder[]> {
  if (process.platform === 'win32') return []; // no lsof; the open() failure is the signal
  try {
    const { stdout } = await execFileAsync('lsof', ['-F', 'cp', port], { timeout: 5000 });
    const holders: PortHolder[] = [];
    let pid = 0;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('c')) holders.push({ command: line.slice(1), pid });
    }
    return holders;
  } catch {
    // lsof exits non-zero when nothing holds the file. That is the common case
    // and means "free", not "unknown".
    return [];
  }
}

/** Processes AgentDeck itself is responsible for, and can therefore ask to let go. */
const OURS = /^(node|agentdeck|AgentDeck)$/;

export function classifyHolders(holders: PortHolder[]): { ours: PortHolder[]; foreign: PortHolder[] } {
  return {
    ours: holders.filter((h) => OURS.test(h.command)),
    foreign: holders.filter((h) => !OURS.test(h.command)),
  };
}

/* -------------------------------------------------------------- the write */

export interface FlashProgress {
  onPhase?: (phase: string) => void;
  onProgress?: (written: number, total: number) => void;
  log?: (msg: string) => void;
}

export interface FlashOutcome {
  chip: string;
  mac: string;
  flashSize?: string;
  verdict: Esp32PreflightVerdict;
  bytes: number;
  elapsedMs: number;
}

/**
 * Connect, identify, refuse-or-write, verify by MD5. Mirrors the browser's
 * `flash.ts` step for step; the two share `esp32PreflightVerdict` so they can
 * never disagree about which board may be written.
 */
export async function flashBoard(
  board: Esp32BoardSpec,
  portPath: string,
  image: Buffer,
  geometry: Pick<ManifestBoardEntry, 'flashMode' | 'flashFreq' | 'flashSize'>,
  opts: { eraseAll?: boolean; baud?: number } = {},
  cb: FlashProgress = {},
): Promise<FlashOutcome> {
  const SerialPort = await loadSerialPort();
  if (!SerialPort) {
    throw new Error(
      'serialport is not installed (it is an optional native dependency).\n' +
        '  Install it with:  npm install -g serialport\n' +
        '  or reinstall AgentDeck so the optional dependency builds:  npx @agentdeck/setup\n' +
        '  Alternatively flash from a browser at https://puritysb.github.io/AgentDeck/flash/',
    );
  }

  const info = (await listCandidatePorts()).find((p) => p.path === portPath);
  const device = new NodeWebSerialPort(portPath, {
    usbVendorId: info?.usbVendorId,
    usbProductId: info?.usbProductId,
  });

  const t0 = Date.now();
  const transport = new Transport(device as unknown as SerialPort, false);
  const loader = new ESPLoader({
    transport,
    baudrate: opts.baud ?? board.uploadBaud,
    terminal: {
      clean() {},
      writeLine: (d: string) => cb.log?.(d),
      write: (d: string) => cb.log?.(d),
    },
    debugLogging: false,
  });

  try {
    cb.onPhase?.('connect');
    let chip: string;
    if (board.stub) {
      chip = await loader.main(board.before);
    } else {
      // The no-stub equivalent of main(): everything except runStub(). Some
      // envs pin --no-stub and some REQUIRE the stub (t_display_pro's
      // "stub + 230400" is a verified combination; t_embed broke when the
      // CH340 envs' no-stub flags were copied onto it) — that axis is in the
      // SSOT, not decided here.
      await loader.detectChip(board.before);
      chip = await loader.chip.getChipDescription(loader);
      if (loader.chip.postConnect) await loader.chip.postConnect(loader);
      if ((opts.baud ?? board.uploadBaud) !== 115200) await loader.changeBaud();
    }

    cb.onPhase?.('identify');
    const mac = await loader.chip.readMac(loader);
    const flashId = (await loader.readFlashId()).toString(16);
    // detectFlashSize() answers "4MB" when it cannot decode the id, so an
    // unusable id must stay unknown rather than becoming a confident wrong
    // number that then gates the write.
    const flashSize = esp32FlashIdIsUsable(flashId) ? await loader.detectFlashSize() : undefined;

    const verdict = esp32PreflightVerdict({
      board,
      surface: 'cli',
      detectedChip: chip,
      detectedFlashSize: flashSize,
    });
    if (!verdict.mayWrite) {
      throw new Error(
        `refusing to write ${board.id}: ${verdict.code}\n` +
          `  detected: ${chip}${flashSize ? `, flash ${flashSize}` : ''}\n` +
          `  expected: ${board.chipFamily}, flash ${board.flashSize}\n` +
          '  There is no --force. Pick the board you actually have.',
      );
    }

    cb.onPhase?.(opts.eraseAll ? 'erase' : 'write');
    await loader.writeFlash({
      fileArray: [{ data: new Uint8Array(image), address: 0x0 }],
      flashMode: geometry.flashMode as 'dio',
      flashFreq: geometry.flashFreq as '80m',
      flashSize: geometry.flashSize as '16MB',
      // Only honoured on the stub path; a no-op rather than an error on a
      // --no-stub board.
      eraseAll: opts.eraseAll ?? false,
      compress: true,
      reportProgress: (_i, written, total) => cb.onProgress?.(written, total),
      // Hashed AFTER esptool-js patches the flash-params header, which is why
      // this is a callback and not a hash of `image`. A mismatch throws.
      calculateMD5Hash: (patched: Uint8Array) => createHash('md5').update(patched).digest('hex'),
    });

    cb.onPhase?.('verify');
    try {
      await loader.after(board.after === 'no_reset' ? 'no_reset' : 'hard_reset');
    } catch { /* best effort — the write already landed and was verified */ }

    return { chip, mac, flashSize, verdict, bytes: image.length, elapsedMs: Date.now() - t0 };
  } finally {
    try { await transport.disconnect(); } catch { /* ignore */ }
    await device.close();
  }
}

/* --------------------------------------------------------- post-write check
 * MD5 proves the bytes landed. It does NOT prove the board boots them — a
 * correct image with a wrong flash-size header verifies perfectly and then
 * bootloops. So the board is asked to introduce itself.
 */

export interface DeviceIdentity {
  board?: string;
  version?: string;
  buildHash?: string;
}

/**
 * Reopen the port at 115200 and wait for the firmware's `device_info`.
 *
 * `ulanzi_tc001` MUST SKIP THIS. Its CH340 TX is broken in hardware, so it
 * never answers any serial probe — running this on a TC001 reports a perfectly
 * good flash as a failure. The exception is named in the SSOT's notes, in
 * docs/esp32.md, and in the browser flasher's done-state copy.
 */
export const SERIAL_PROBE_UNAVAILABLE = new Set(['ulanzi_tc001']);

export async function readDeviceIdentity(
  portPath: string,
  timeoutMs = 20_000,
): Promise<DeviceIdentity | null> {
  const SerialPort = await loadSerialPort();
  if (!SerialPort) return null;

  return new Promise<DeviceIdentity | null>((resolve) => {
    // Every handle `done` touches is declared before anything can call it.
    // `done` is reachable from the `error` listener, and a synchronous failure
    // would otherwise run it while `const timer` / `const asker` were still in
    // their temporal dead zone — a ReferenceError instead of the `null` this
    // function promises. Which matters because it runs AFTER a successful
    // write: a throw here reports a good flash as a failure.
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asker: ReturnType<typeof setInterval> | undefined;
    let port: InstanceType<typeof SerialPort> | undefined;

    const done = (v: DeviceIdentity | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (asker) clearInterval(asker);
      try { port?.close(() => {}); } catch { /* already closed, or never opened */ }
      resolve(v);
    };
    // Bounded, always: a board that boots into a crash loop writes nothing and
    // an unbounded wait here would hang the command after a SUCCESSFUL write.
    timer = setTimeout(() => done(null), timeoutMs);

    try {
      port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    } catch {
      // A vanished device node (a native-USB board re-enumerating after its
      // reset) throws from the constructor. That is "did not report in", not a
      // failed flash.
      return done(null);
    }
    let buf = '';
    port.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      // Firmware speaks newline-delimited JSON with plain debug lines mixed in.
      for (const line of buf.split('\n').slice(0, -1)) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.type === 'device_info') {
            done({
              board: typeof msg.board === 'string' ? msg.board : undefined,
              version: typeof msg.version === 'string' ? msg.version : undefined,
              buildHash: typeof msg.buildHash === 'string' ? msg.buildHash : undefined,
            });
            return;
          }
        } catch { /* a partial or non-JSON line — keep reading */ }
      }
      // Keep only the trailing partial line, so a complete line is parsed once.
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
      // A board stuck printing a panic dump without newlines would otherwise
      // grow this string for the whole timeout. Nothing this long is a protocol
      // line, so drop it rather than accumulate it.
      if (buf.length > 64 * 1024) buf = '';
    });
    port.on('error', () => done(null));
    port.open((err: Error | null) => {
      if (err) return done(null);
      port?.write('{"type":"device_info_request"}\n');
    });
    // The board may still be booting when the first ask goes out.
    asker = setInterval(() => {
      if (port?.isOpen) port.write('{"type":"device_info_request"}\n');
    }, 3000);
  });
}
