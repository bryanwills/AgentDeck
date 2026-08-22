/**
 * ESP32 board SSOT — the machine-readable half of the board table.
 *
 * WHY THIS FILE EXISTS. The same board set was written out by hand in four
 * places and only one edge had a gate:
 *
 *   docs/hardware-compatibility.md   (spec sheet — gated into docs/hardware/index.html)
 *   .github/workflows/esp32-release.yml  (build matrix — enforced by a COMMENT only)
 *   bridge/src/cli.ts                (ESP32_OTA_BOARDS)
 *   docs/esp32.md                    (alias table)
 *
 * A board missing from the release matrix ships no firmware and nothing fails —
 * which is exactly how `t_embed`, `t_display_pro` and `esp32_c6_147` had no
 * binaries at all in 1.0.1. This file is where those literals stop being
 * literals; `scripts/generate-esp32-board-matrix.mjs` emits the derived copies
 * and cross-checks the rest.
 *
 * DIVISION OF LABOUR with docs/hardware-compatibility.md: that file stays the
 * SSOT for the human columns (display, controller, input, peripherals, status)
 * and this one owns the machine fields. Two SSOTs over DISJOINT column sets,
 * bound by a gate — not a second copy. Drop the cross-check and this file makes
 * the duplication worse, not better.
 */

export type Esp32ChipFamily = 'ESP32' | 'ESP32-S3' | 'ESP32-P4' | 'ESP32-C6';
export type Esp32FlashSize = '4MB' | '8MB' | '16MB';
/** esptool `--before` values (esptool-js calls this the reset `mode`). */
export type Esp32ResetBefore = 'default_reset' | 'usb_reset' | 'no_reset' | 'no_reset_no_sync';
/** esptool `--after` values. */
export type Esp32ResetAfter = 'hard_reset' | 'soft_reset' | 'no_reset' | 'no_reset_stub';

/**
 * Whether the browser flasher may offer this board.
 * - `verified`          a hardware run connected and both guards agreed
 * - `verified-partial`  connected, but something is degraded (see the evidence)
 * - `unverified`        never measured — listed, disabled, with the reason shown
 * - `blocked`           measured and it cannot work here
 */
export type Esp32WebFlashStatus = 'verified' | 'verified-partial' | 'unverified' | 'blocked';

export interface Esp32BoardSpec {
  /** canonical `device_info.board` — the string every AgentDeck surface addresses */
  id: string;
  /** PlatformIO environment. A DIFFERENT namespace from `id`, deliberately. */
  env: string;
  name: string;
  /** panel summary, mirrored into the release notes table */
  display: string;
  /**
   * Extra CLI spellings accepted for `agentdeck esp32-ota <target>`. This list
   * is the CLI's existing set VERBATIM — adding a spelling here changes what
   * the command accepts, so it is a behaviour change, not bookkeeping.
   * `esp32/scripts/flash.sh` keeps its own friendlier names (`tft_114`,
   * `amoled_18`, …) for the local build path; those are deliberately NOT
   * merged in, because they were never valid daemon targets.
   */
  aliases: string[];

  chipFamily: Esp32ChipFamily;
  flashSize: Esp32FlashSize;
  flashMode: 'dio';
  flashFreq: '40m' | '80m';
  /**
   * Where the bootloader sits INSIDE the merged image. Audit field only —
   * consumers write the merged image at 0x0 and never branch on this.
   */
  bootloaderOffset: number;
  uploadBaud: number;
  /** verbatim `upload_flags` from platformio.ini, for the esptool CLI path */
  esptoolFlags: string[];
  /** the reset mode the env's flags imply */
  before: Esp32ResetBefore;
  after: Esp32ResetAfter;
  /** does the flasher stub load on this board? (some envs pin --no-stub) */
  stub: boolean;
  /** native-USB CDC/JTAG: entering download mode RE-ENUMERATES the device node */
  nativeUsb: boolean;

  /** has dual-OTA partitions, i.e. `agentdeck esp32-ota` can target it */
  ota: boolean;

  webFlash: boolean;
  webFlashStatus: Esp32WebFlashStatus;
  /**
   * The evidence for `webFlash`. A flag nobody measured is indistinguishable
   * from one a board produced, so this string is what tells them apart — and it
   * is required whenever `webFlash` is true (gated in tests).
   */
  webFlashVerified: string;
  notes: string[];
}

/**
 * esptool's own default bootloader offsets. Three values, not two — ESP32-P4 at
 * 0x2000 is the one that gets missed, because every other chip in this fleet is
 * 0x0 or 0x1000 and a "two cases" assumption survives review right up until a
 * P4 is bricked.
 */
export const ESP32_BOOTLOADER_OFFSET: Record<Esp32ChipFamily, number> = {
  ESP32: 0x1000,
  'ESP32-S3': 0x0,
  'ESP32-C6': 0x0,
  'ESP32-P4': 0x2000,
};

const EV = '2026-08-22 · esptool-js 0.6.1 · Node 26.5 serialport adapter · ';

/** Ordered as the release matrix builds them, so the generated diff stays small. */
export const ESP32_BOARDS: Esp32BoardSpec[] = [
  {
    id: '86box', env: 'box_86', name: '86 Box', display: '4" 480x480 ST7701',
    aliases: ['box_86', 'box_40'],
    chipFamily: 'ESP32-S3', flashSize: '16MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: false,
    ota: true,
    webFlash: true, webFlashStatus: 'verified',
    webFlashVerified: EV + 'default_reset/stub · ESP32-S3 (QFN56) rev v0.2 · flash 16MB · 460800 ok',
    notes: ['CH340 USB-serial bridge.'],
  },
  {
    id: 'ips_35', env: 'ips35', name: 'IPS 3.5"', display: '3.5" 480x320 AXS15231B',
    aliases: ['ips35'],
    chipFamily: 'ESP32-S3', flashSize: '16MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800,
    esptoolFlags: ['--before', 'no_reset', '--no-stub'],
    before: 'no_reset', after: 'hard_reset', stub: false, nativeUsb: true,
    ota: true,
    webFlash: false, webFlashStatus: 'unverified',
    webFlashVerified:
      '2026-08-22 · owned and live on Wi-Fi, but not USB-attached during the spike. A --no-stub board like the TTGO that did pass, so it is the best next candidate.',
    notes: ['esptool misdetects the flash as 8MB during a bootloop — 16MB must be explicit.'],
  },
  {
    id: 'round_amoled', env: 'amoled', name: 'Round AMOLED', display: '1.8" 360x360 ST77916',
    // `amoled_18` was documented in docs/esp32.md but absent from the CLI, so
    // a user following the docs got "No online WiFi ESP32 target matches". The
    // CLI already accepts the other flash.sh friendly names (box_40, ips_101,
    // knob, ticker, s3pro), so this was a gap, not a deliberate exclusion.
    aliases: ['amoled', 'amoled_18'],
    chipFamily: 'ESP32-S3', flashSize: '8MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800,
    esptoolFlags: ['--before', 'no_reset', '--no-stub'],
    before: 'no_reset', after: 'hard_reset', stub: false, nativeUsb: true,
    ota: true,
    webFlash: false, webFlashStatus: 'unverified',
    webFlashVerified: '2026-08-22 · owned and live on Wi-Fi, but not USB-attached during the spike.',
    notes: [],
  },
  {
    id: 'ips_10', env: 'ips10', name: 'IPS 10.1"', display: '10.1" 800x1280 JD9365',
    aliases: ['ips10', 'ips_101'],
    chipFamily: 'ESP32-P4', flashSize: '16MB', flashMode: 'dio', flashFreq: '40m',
    bootloaderOffset: 0x2000, uploadBaud: 115200,
    esptoolFlags: ['--before', 'no_reset', '--after', 'no_reset', '--no-stub'],
    before: 'no_reset', after: 'no_reset', stub: false, nativeUsb: false,
    ota: true,
    webFlash: false, webFlashStatus: 'blocked',
    webFlashVerified:
      '2026-08-22 · enters download mode but never answers. esptool.py v5.1.2 reports "Download mode successfully detected, but getting no sync reply: The serial TX path seems to be down" — board-side, not esptool-js.',
    notes: ['ESP32-P4: the bootloader lives at 0x2000, not 0x0.'],
  },
  {
    id: 'inkdeck', env: 'inkdeck', name: 'InkDeck', display: '7.5" 800x480 e-ink UC8179',
    aliases: [],
    chipFamily: 'ESP32-S3', flashSize: '8MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: true,
    ota: true,
    webFlash: true, webFlashStatus: 'verified',
    webFlashVerified:
      EV +
      'default_reset/stub · ESP32-S3 (QFN56) rev v0.2 · flash 16MB detected vs 8MB declared (BSP-correct) · 460800 ok. Connected on the DOWNLOAD-MODE node, which is a different device node from the running one.',
    notes: [
      'The XIAO ESP32-S3 Plus is physically 16MB, but its BSP bakes an 8MB flash-size field — 8MB is the correct declaration, not a mistake.',
      'Pick the download-mode port, not the running one.',
    ],
  },
  {
    id: 'ttgo_t_display', env: 'ttgo', name: 'TTGO T-Display', display: '1.14" 240x135 ST7789',
    aliases: ['ttgo'],
    chipFamily: 'ESP32', flashSize: '16MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x1000, uploadBaud: 115200, esptoolFlags: ['--no-stub'],
    before: 'default_reset', after: 'hard_reset', stub: false, nativeUsb: false,
    ota: true,
    webFlash: true, webFlashStatus: 'verified-partial',
    webFlashVerified:
      EV +
      'BOTH default_reset/stub and default_reset/no-stub connect · ESP32-D0WDQ6 rev v1.1. This is the measurement that proves the --no-stub path works. Flash size reads 16MB WITH the stub and is unreadable without it (flashId 0xffffff), so the size guard is unavailable stubless.',
    notes: ['Stubless SPI flash-id reads return 0xffffff on this board; the size guard degrades to chip-family only.'],
  },
  {
    id: 'ulanzi_tc001', env: 'led8x32', name: 'Ulanzi TC001', display: '32x8 WS2812B matrix',
    aliases: ['led8x32'],
    chipFamily: 'ESP32', flashSize: '8MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x1000, uploadBaud: 115200, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: false,
    ota: true,
    webFlash: true, webFlashStatus: 'verified',
    webFlashVerified: EV + 'default_reset/stub · ESP32-D0WD rev 1 · flash 8MB',
    notes: [
      'Flash size MUST be 8MB — the 4MB default leaves the bootloader misbehaving (GPIO15 buzzer stuck HIGH, no display).',
      'This board does NOT answer device_info_request: its CH340 TX is hardware-broken. Verify a flash by the matrix render plus Wi-Fi registration, never by a serial probe.',
    ],
  },
  {
    id: 't_embed', env: 't_embed', name: 'T-Embed CC1101', display: '1.9" 320x170 ST7789',
    aliases: ['tembed', 'knob'],
    chipFamily: 'ESP32-S3', flashSize: '16MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: true,
    ota: true,
    webFlash: false, webFlashStatus: 'unverified',
    webFlashVerified:
      '2026-08-22 · no auto entry into download mode; esptool.py v5.1.2 fails identically ("No serial data received"), so this is the board, not esptool-js. Needs a physical BOOT press to verify.',
    notes: [
      'Native USB CDC needs esptool\'s NORMAL reset — copying the no_reset/no-stub flags from the CH340 envs made every upload fail (2026-07-26).',
    ],
  },
  {
    id: 't_display_pro', env: 't_display_pro', name: 'T-Display-S3-Pro', display: '2.33" 480x222 ST7796U',
    aliases: ['tdisplaypro', 'ticker', 's3pro'],
    chipFamily: 'ESP32-S3', flashSize: '16MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 230400, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: true,
    ota: true,
    webFlash: true, webFlashStatus: 'verified',
    webFlashVerified:
      EV + 'default_reset/stub · ESP32-S3 (QFN56) rev v0.2 · flash 16MB · 230400 ok (the pinned rate held)',
    notes: ['USB CDC corrupts the esptool stream above 230400 — stub + 230400 is the proven-stable combination.'],
  },
  {
    id: 'esp32_c6_147', env: 'esp32_c6_147', name: 'Waveshare C6-LCD-1.47', display: '1.47" 172x320 ST7789',
    aliases: [],
    chipFamily: 'ESP32-C6', flashSize: '4MB', flashMode: 'dio', flashFreq: '80m',
    bootloaderOffset: 0x0, uploadBaud: 460800, esptoolFlags: [],
    before: 'default_reset', after: 'hard_reset', stub: true, nativeUsb: true,
    // Single-app 4MB layout: no OTA slot, so USB is this board's ONLY update
    // path. Stated here rather than inferred from an absent line in the CLI's
    // OTA list, which is how it read before.
    ota: false,
    webFlash: false, webFlashStatus: 'unverified',
    webFlashVerified:
      '2026-08-22 · not present on serial or Wi-Fi during the spike, and the only ESP32-C6 in the fleet, so the entire C6 path is unverified.',
    notes: ['No OTA partitions — USB is the only way to update this board.'],
  },
];

export const esp32BoardById = (id: string): Esp32BoardSpec | undefined =>
  ESP32_BOARDS.find((b) => b.id === id);

/**
 * alias / canonical id / env → the board it means.
 *
 * Built as a declaration rather than a top-level loop: this package is
 * published with `sideEffects: false`, so import-time statements are work a
 * bundler is allowed to delete (gated by shared/src/__tests__/no-side-effects.test.ts).
 */
export const ESP32_BOARD_BY_TARGET: Record<string, Esp32BoardSpec> = Object.fromEntries(
  ESP32_BOARDS.flatMap((b) => [b.id, b.env, ...b.aliases].map((key) => [key, b] as const)),
);

/**
 * esptool reports a chip DESCRIPTION, not a family: "ESP32-D0WD (revision 1)",
 * "ESP32-S3 (QFN56) (revision v0.2)". Order matters — every variant string also
 * contains the substring "ESP32", so the classic case has to be the fallback or
 * it swallows the whole family.
 */
export function esp32ChipFamilyOf(description: string): Esp32ChipFamily | 'other' {
  const d = description.toUpperCase();
  if (/ESP32-S3/.test(d)) return 'ESP32-S3';
  if (/ESP32-P4/.test(d)) return 'ESP32-P4';
  if (/ESP32-C6/.test(d)) return 'ESP32-C6';
  if (/ESP32-(S2|C2|C3|C5|C61|H2)/.test(d)) return 'other';
  if (/ESP32/.test(d)) return 'ESP32';
  return 'other';
}

/* --------------------------------------------------------------- flash guards
 * These two rules decide whether it is safe to write to a board, so the browser
 * flasher and the CLI must apply them IDENTICALLY — which makes them SSOT
 * material, not per-surface helpers.
 */

/**
 * esptool-js's `detectFlashSize()` silently returns `"4MB"` when it cannot
 * decode the size id, so "4MB" means either a 4MB part or "no idea". Measured
 * 2026-08-22: a TTGO T-Display read through the ROM loader (no stub) answers
 * `0xffffff` and was reported as 4MB, while the same board with the stub reads
 * `0x1840ef` → 16MB, and esptool.py reads 16MB either way.
 *
 * So the id is checked first and "unknown" is allowed to stay unknown.
 */
export function esp32FlashIdIsUsable(flashIdHex: string | undefined): boolean {
  if (!flashIdHex) return false;
  const n = Number.parseInt(flashIdHex, 16);
  return Number.isFinite(n) && n !== 0xffffff && n !== 0x000000;
}

/**
 * The flash-size guard is DIRECTIONAL.
 *
 * Declaring MORE flash than the part has is the brick: the bootloader header
 * claims a geometry the chip cannot serve and the partition table is rejected.
 * Declaring LESS is merely conservative — and on InkDeck it is mandatory, since
 * the XIAO ESP32-S3 Plus is physically 16MB but its BSP bakes an 8MB field. An
 * equality test fails that board for doing the correct thing.
 *
 * Returns undefined when the detected size is unknown; that is its own answer,
 * not a pass and not a failure.
 */
export function esp32FlashSizeIsSafe(
  declared: string,
  detected: string | undefined,
): boolean | undefined {
  const mb = (s: string | undefined): number | undefined => {
    if (!s) return undefined;
    const m = /(\d+)\s*MB/i.exec(s);
    return m ? Number(m[1]) : undefined;
  };
  const want = mb(declared);
  const have = mb(detected);
  if (want === undefined || have === undefined) return undefined;
  return want <= have;
}

/** The `--chip` argument esptool expects for a board's family. */
export const ESP32_ESPTOOL_CHIP: Record<Esp32ChipFamily, string> = {
  ESP32: 'esp32',
  'ESP32-S3': 'esp32s3',
  'ESP32-C6': 'esp32c6',
  'ESP32-P4': 'esp32p4',
};

/** Chip ID `esptool image-info` prints, per family — used to self-check a merged image. */
export const ESP32_IMAGE_CHIP_ID: Record<Esp32ChipFamily, number> = {
  ESP32: 0,
  'ESP32-S3': 9,
  'ESP32-C6': 13,
  'ESP32-P4': 18,
};

/** Where the partition table lives; also where the bootloader region ends. */
export const ESP32_PARTITION_TABLE_OFFSET = 0x8000;
/** boot_app0 (the OTA-selection blob) offset. Absent, a board can boot a stale slot. */
export const ESP32_BOOT_APP0_OFFSET = 0xe000;
/** app0 — the first application slot. Same on every board here. */
export const ESP32_APP0_OFFSET = 0x10000;

/* ------------------------------------------------------- write-time preflight
 * The guards above answer two narrow questions. This function answers the one
 * the user actually faces — *may this image be written to the board in front of
 * me?* — and it is SSOT material for the same reason the guards are: the browser
 * flasher and `agentdeck esp32 flash` must refuse the SAME boards. A rule that
 * exists twice is a rule that will disagree once, and the disagreement here is a
 * bricked board.
 *
 * The two runtimes do NOT share the esptool-js driving code (one runs on Web
 * Serial, the other on a `serialport` shim), so this decision is the seam that
 * holds them together.
 */
export type Esp32PreflightCode =
  /** every check the link could answer agreed */
  | 'ok'
  /** connected, but the flash id was unreadable — chip family is all we verified */
  | 'ok-unknown-flash'
  /** the chip on the wire is not the family this image was built for */
  | 'chip-mismatch'
  /** the image declares more flash than the part reports having */
  | 'flash-too-small'
  /** this SURFACE does not offer the board (browser only — see `surface`) */
  | 'board-not-offered'
  /** the image about to be written was built for different geometry than this board's spec */
  | 'image-geometry-mismatch';

/**
 * Which tool is asking. It changes exactly one thing, and getting it wrong in
 * either direction is a real defect:
 *
 * - `'browser'` additionally requires `webFlash`, because the page only offers
 *   boards a hardware run measured.
 * - `'cli'` does NOT. `webFlash` means "offered in the browser", never "may be
 *   written at all" — and `esp32_c6_147` has no OTA slot, so USB is its ONLY
 *   update path. A CLI that inherited the browser's list would leave that board
 *   with no way to be updated at all.
 */
export type Esp32FlashSurface = 'browser' | 'cli';

export interface Esp32PreflightInput {
  board: Esp32BoardSpec;
  surface: Esp32FlashSurface;
  /** raw `getChipDescription()` output, e.g. "ESP32-S3 (QFN56) (revision v0.2)" */
  detectedChip: string | undefined;
  /** `detectFlashSize()` output, or undefined when the flash id was unusable */
  detectedFlashSize: string | undefined;
  /**
   * What the IMAGE says, read from the release manifest — as opposed to what
   * this build's SSOT says the board is.
   *
   * These are not the same fact and they are deliberately decoupled: the CLI
   * takes its manifest from a release tag (`--tag`, or the newest published
   * one) while its board spec is bundled, and the browser page ships from
   * master while its manifest comes from whichever release Pages deployed. So
   * the value the guard checks and the value actually written into the
   * flash-params header can differ, and the guard would be validating a number
   * nobody writes.
   *
   * Omit when writing a hand-supplied image (`--firmware`), where there is no
   * manifest to disagree with.
   */
  imageGeometry?: { chipFamily: string; flashSize: string };
}

export interface Esp32PreflightVerdict {
  code: Esp32PreflightCode;
  /** the only field a caller may branch on to start a write */
  mayWrite: boolean;
  /** what was compared, for the UI to show detected-vs-expected */
  detectedFamily?: Esp32ChipFamily | 'other';
}

/**
 * There is deliberately no `force` parameter.
 *
 * Writing a 16MB-header image to an 8MB part, or an S3 image to a classic
 * ESP32, is precisely how these boards are bricked — and the recovery for a
 * bricked board is the very tool that refused. An override switch would make
 * the guard advisory, and an advisory guard is the one that gets clicked
 * through at 2am. Callers that legitimately need to bypass have esptool.
 */
export function esp32PreflightVerdict(input: Esp32PreflightInput): Esp32PreflightVerdict {
  const { board, surface, detectedChip, detectedFlashSize } = input;
  if (surface === 'browser' && !board.webFlash) {
    return { code: 'board-not-offered', mayWrite: false };
  }

  const detectedFamily = detectedChip ? esp32ChipFamilyOf(detectedChip) : undefined;
  if (detectedFamily !== board.chipFamily) {
    return { code: 'chip-mismatch', mayWrite: false, detectedFamily };
  }

  // The guard must check the value that will actually be WRITTEN. Concretely:
  // the SSOT corrects a board down to 4MB, a pinned manifest still says 16MB,
  // the part reports 8MB — `4 <= 8` passes while a 16MB header lands on an 8MB
  // part, which is precisely the brick every other rule here exists to prevent.
  //
  // STRICT EQUALITY, NOT DIRECTIONAL, and deliberately so. Unlike the size rule
  // below, these two values are not "declared vs actual": they are two
  // descriptions of the SAME board from two sources that are supposed to agree
  // (a release manifest, and this build's SSOT). A disagreement in either
  // direction means they describe different boards and there is no way to tell
  // which one is true.
  //
  // It is also the ONLY size check left when the flash id is unreadable — a
  // stubless TTGO answers 0xffffff, `esp32FlashSizeIsSafe` returns undefined,
  // and the size axis goes unchecked. Loosening this to a directional test
  // would remove the sole guard in exactly the case with the least information.
  //
  // The cost is a release-ordering constraint, not a defect: after any SSOT
  // flash-size change, the browser flasher refuses against the previously
  // deployed release until Pages redeploys with the new manifest. Cut the esp32
  // release, then push master. See RELEASING.md.
  const { imageGeometry } = input;
  if (imageGeometry &&
      (imageGeometry.flashSize !== board.flashSize || imageGeometry.chipFamily !== board.chipFamily)) {
    return { code: 'image-geometry-mismatch', mayWrite: false, detectedFamily };
  }

  const sizeSafe = esp32FlashSizeIsSafe(board.flashSize, detectedFlashSize);
  if (sizeSafe === false) return { code: 'flash-too-small', mayWrite: false, detectedFamily };
  // Unknown is its own answer, and it is a PASS: the merged image bakes its
  // flash-size field at build time from this same SSOT and CI asserts it with
  // `esptool image-info`, so the geometry is already correct in the bits. What
  // is lost is the runtime cross-check, and that has to be said in the UI
  // rather than quietly downgraded to a full pass.
  if (sizeSafe === undefined) return { code: 'ok-unknown-flash', mayWrite: true, detectedFamily };
  return { code: 'ok', mayWrite: true, detectedFamily };
}
