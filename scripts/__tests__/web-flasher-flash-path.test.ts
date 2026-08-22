/**
 * The browser flasher's write path, tested where it can be: the MD5 that
 * verifies a flash, and the guard that refuses one.
 *
 * The esptool-js driving code cannot be unit-tested without a board — but the
 * two things that decide whether a board survives can be, and both are the
 * kind that stay green while being wrong (a hash that is subtly off fails
 * EVERY flash and reads like a bad write; a guard whose polarity flips fails
 * nothing until someone picks the wrong board).
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { md5 } from '../../tools/web-flasher/md5.js';
import {
  ESP32_BOARDS,
  esp32BoardById,
  esp32PreflightVerdict,
  type Esp32BoardSpec,
} from '../../shared/src/esp32-boards.js';

describe('md5 (browser flasher)', () => {
  // Checked against node:crypto rather than against pasted digests: a table of
  // expected hashes is only as good as whoever typed it, and this hash is what
  // decides whether a write is reported as verified.
  const cases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['abc', new TextEncoder().encode('abc')],
    ['sentence', new TextEncoder().encode('The quick brown fox jumps over the lazy dog')],
    // The padding boundaries: 55 fits one block with the length field, 56 does
    // not and forces a second, 64 is exactly one block. Off-by-one padding is
    // correct for most inputs and wrong for exactly these.
    ['55 bytes', new Uint8Array(55).fill(7)],
    ['56 bytes', new Uint8Array(56).fill(9)],
    ['64 bytes', new Uint8Array(64).fill(1)],
    ['119 bytes', new Uint8Array(119).fill(0xab)],
    ['120 bytes', new Uint8Array(120).fill(0xcd)],
    // Multi-block, non-trivial content, at a size where the >>> vs / 2**32
    // split of the bit count starts to matter for the low word.
    ['600 KB', new Uint8Array(600_000).map((_, i) => (i * 31) & 0xff)],
  ];

  for (const [name, bytes] of cases) {
    it(`matches node:crypto for ${name}`, () => {
      expect(md5(bytes)).toBe(crypto.createHash('md5').update(bytes).digest('hex'));
    });
  }
});

const board = (id: string): Esp32BoardSpec => {
  const b = esp32BoardById(id);
  if (!b) throw new Error(`fixture board ${id} vanished from the SSOT`);
  return b;
};

describe('esp32PreflightVerdict', () => {
  it('passes when chip and flash both agree', () => {
    const v = esp32PreflightVerdict({
      board: board('86box'),
      surface: 'browser',
      detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
      detectedFlashSize: '16MB',
    });
    expect(v).toMatchObject({ code: 'ok', mayWrite: true });
  });

  it('refuses an S3 image on a classic ESP32 — the brick this guard exists for', () => {
    const v = esp32PreflightVerdict({
      board: board('86box'),
      surface: 'browser',
      detectedChip: 'ESP32-D0WDQ6 (revision v1.1)',
      detectedFlashSize: '16MB',
    });
    expect(v.code).toBe('chip-mismatch');
    expect(v.mayWrite).toBe(false);
  });

  it('refuses a 16MB-header image on an 8MB part', () => {
    const v = esp32PreflightVerdict({
      board: board('86box'),
      surface: 'browser',
      detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
      detectedFlashSize: '8MB',
    });
    expect(v.code).toBe('flash-too-small');
    expect(v.mayWrite).toBe(false);
  });

  it('ALLOWS a smaller declaration than the part reports — InkDeck is 16MB physical, 8MB declared', () => {
    // An equality test here would fail the one board doing the correct thing:
    // the XIAO ESP32-S3 Plus bakes an 8MB flash-size field in its BSP.
    const v = esp32PreflightVerdict({
      board: board('inkdeck'),
      surface: 'browser',
      detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
      detectedFlashSize: '16MB',
    });
    expect(v).toMatchObject({ code: 'ok', mayWrite: true });
  });

  it('treats an unreadable flash size as its own answer, not as a failure', () => {
    // TTGO through the ROM loader answers flashId 0xffffff, so the size is
    // unknown. The merged image's geometry was fixed at build time and asserted
    // in CI, so the write is still safe — what is lost is the runtime check,
    // and the distinct code is what lets the UI say so.
    const v = esp32PreflightVerdict({
      board: board('ttgo_t_display'),
      surface: 'browser',
      detectedChip: 'ESP32-D0WDQ6 (revision v1.1)',
      detectedFlashSize: undefined,
    });
    expect(v).toMatchObject({ code: 'ok-unknown-flash', mayWrite: true });
  });

  it('refuses when nothing answered at all', () => {
    const v = esp32PreflightVerdict({
      board: board('86box'),
      surface: 'browser',
      detectedChip: undefined,
      detectedFlashSize: undefined,
    });
    expect(v.mayWrite).toBe(false);
  });

  describe('surface polarity', () => {
    // webFlash means "offered in the browser", never "may be written at all".
    // Conflating them would leave esp32_c6_147 — which has no OTA slot, so USB
    // is its ONLY update path — with no way to be updated by anything.
    const c6 = board('esp32_c6_147');

    it('browser refuses a board it does not offer', () => {
      expect(c6.webFlash).toBe(false);
      const v = esp32PreflightVerdict({
        board: c6,
        surface: 'browser',
        detectedChip: 'ESP32-C6 (revision v0.0)',
        detectedFlashSize: '4MB',
      });
      expect(v).toMatchObject({ code: 'board-not-offered', mayWrite: false });
    });

    it('CLI writes the same board — USB is its only update path', () => {
      expect(c6.ota).toBe(false);
      const v = esp32PreflightVerdict({
        board: c6,
        surface: 'cli',
        detectedChip: 'ESP32-C6 (revision v0.0)',
        detectedFlashSize: '4MB',
      });
      expect(v).toMatchObject({ code: 'ok', mayWrite: true });
    });

    it('the CLI still applies the hardware guards to an unoffered board', () => {
      const v = esp32PreflightVerdict({
        board: c6,
        surface: 'cli',
        detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
        detectedFlashSize: '16MB',
      });
      expect(v.code).toBe('chip-mismatch');
    });
  });

  describe('image geometry', () => {
    // The guard must check the value that will actually be WRITTEN. The board
    // spec is bundled with the page/CLI; the geometry comes from a release
    // manifest resolved separately (--tag, or whichever release Pages
    // deployed), so the two can legitimately disagree.
    const b = board('86box');

    it('passes when the image agrees with the board spec', () => {
      const v = esp32PreflightVerdict({
        board: b,
        surface: 'cli',
        detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
        detectedFlashSize: '16MB',
        imageGeometry: { chipFamily: b.chipFamily, flashSize: b.flashSize },
      });
      expect(v).toMatchObject({ code: 'ok', mayWrite: true });
    });

    it('refuses a 16MB image for a board this build calls 4MB, even on an 8MB part', () => {
      // Without this check the size rule sees 4 <= 8 and passes, while a 16MB
      // flash-params header lands on an 8MB part — the brick every other rule
      // here exists to prevent, waved through on a value nobody writes.
      const corrected = { ...b, flashSize: '4MB' as const };
      const v = esp32PreflightVerdict({
        board: corrected,
        surface: 'cli',
        detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
        detectedFlashSize: '8MB',
        imageGeometry: { chipFamily: 'ESP32-S3', flashSize: '16MB' },
      });
      expect(v).toMatchObject({ code: 'image-geometry-mismatch', mayWrite: false });
    });

    it('refuses an image built for a different chip family', () => {
      const v = esp32PreflightVerdict({
        board: b,
        surface: 'cli',
        detectedChip: 'ESP32-S3 (QFN56) (revision v0.2)',
        detectedFlashSize: '16MB',
        imageGeometry: { chipFamily: 'ESP32', flashSize: b.flashSize },
      });
      expect(v).toMatchObject({ code: 'image-geometry-mismatch', mayWrite: false });
    });

    it('omitting it does not weaken the other guards', () => {
      // --firmware supplies an image with no manifest to disagree with. The
      // chip and size rules must still apply.
      const v = esp32PreflightVerdict({
        board: b,
        surface: 'cli',
        detectedChip: 'ESP32-D0WDQ6 (revision v1.1)',
        detectedFlashSize: '16MB',
      });
      expect(v.code).toBe('chip-mismatch');
    });
  });

  it('the erase refusal is reachable — a board the browser OFFERS flashes stubless', () => {
    // esptool-js honours `eraseAll` only on the stub path, so on a `stub: false`
    // board ticking "erase (clears saved Wi-Fi and pairing token)" was silently
    // dropped after showing an erase phase and "MD5 verified" — handing back a
    // board still carrying the previous owner's credentials.
    //
    // This pins WHY both surfaces refuse rather than skip: it is not a
    // hypothetical combination. If the fleet ever has no stubless offered board
    // this test goes red, and the refusal can then be reconsidered — it must not
    // quietly become dead code nobody re-reads.
    const stubless = ESP32_BOARDS.filter((b) => b.webFlash && !b.stub);
    expect(stubless.map((b) => b.id)).toContain('ttgo_t_display');
  });

  it('every board the browser offers accepts its own declared identity', () => {
    // Pins the invariant, not the membership: adding a verified board needs no
    // test edit, but a board whose SSOT row contradicts itself fails here.
    for (const b of ESP32_BOARDS.filter((x) => x.webFlash)) {
      const v = esp32PreflightVerdict({
        board: b,
        surface: 'browser',
        detectedChip: b.chipFamily,
        detectedFlashSize: b.flashSize,
        imageGeometry: { chipFamily: b.chipFamily, flashSize: b.flashSize },
      });
      expect(v.mayWrite, `${b.id} refuses itself`).toBe(true);
    }
  });
});
