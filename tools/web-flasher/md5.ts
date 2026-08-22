/**
 * MD5 over a byte array — the post-write verification esptool-js asks for.
 *
 * `writeFlash({ calculateMD5Hash })` compares this against the chip's own
 * `SPI_FLASH_MD5` reply, so it is the only check that proves the bytes on the
 * board are the bytes we sent. Without it a write "succeeds" whenever the
 * protocol acknowledges, which is exactly the failure mode that leaves a board
 * half-written.
 *
 * Implemented here rather than pulled in (esptool-js's own examples use
 * crypto-js) because SubtleCrypto has no MD5 — deliberately, it is broken for
 * signatures — and a whole crypto library for one non-cryptographic checksum is
 * a poor trade in a bundle this page has to ship. RFC 1321, ~70 lines.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(2^32 * abs(sin(i + 1))), computed rather than pasted: a
// mistyped digit in a 64-entry table produces a wrong hash for *some* inputs,
// which is the kind of bug a smoke test misses.
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));

export function md5(input: Uint8Array): string {
  const len = input.length;
  // padded length: message + 0x80 + zeros to 56 mod 64 + 8-byte bit length
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit little-endian bit count. Lengths here are firmware images (< 512MB),
  // so the high word is written as the true carry rather than assumed zero.
  const bits = len * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0]
    .map((w) =>
      [0, 8, 16, 24].map((s) => ((w >>> s) & 0xff).toString(16).padStart(2, "0")).join(""),
    )
    .join("");
}
