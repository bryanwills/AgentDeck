// Self-contained RGB565 → PNG encoder. No libpng / zlib dependency: the pixel
// data is wrapped in a zlib stream of *stored* (uncompressed) DEFLATE blocks, so
// the only algorithms needed are CRC32 (chunk integrity) and Adler32 (zlib
// checksum). Matches the "no image deps" ethos of the other AgentDeck preview
// tools (pixoo-preview.ts et al.).
#include "sim.h"
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

namespace {

uint32_t crc32_of(const uint8_t* p, size_t n, uint32_t crc = 0xFFFFFFFFu) {
  static uint32_t table[256];
  static bool init = false;
  if (!init) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      table[i] = c;
    }
    init = true;
  }
  for (size_t i = 0; i < n; i++) crc = table[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
  return crc;
}

void put_u32(std::vector<uint8_t>& v, uint32_t x) {
  v.push_back((x >> 24) & 0xFF); v.push_back((x >> 16) & 0xFF);
  v.push_back((x >> 8) & 0xFF);  v.push_back(x & 0xFF);
}

void chunk(std::vector<uint8_t>& out, const char* type, const std::vector<uint8_t>& data) {
  put_u32(out, (uint32_t)data.size());
  size_t crcStart = out.size();
  out.insert(out.end(), type, type + 4);
  out.insert(out.end(), data.begin(), data.end());
  uint32_t crc = crc32_of(&out[crcStart], out.size() - crcStart) ^ 0xFFFFFFFFu;
  put_u32(out, crc);
}

// Wrap raw bytes in a zlib stream using stored DEFLATE blocks (max 65535 each).
std::vector<uint8_t> zlib_store(const std::vector<uint8_t>& raw) {
  std::vector<uint8_t> z;
  z.push_back(0x78); z.push_back(0x01);  // zlib header: CM=8, no dict, level 0
  size_t off = 0;
  while (off < raw.size()) {
    size_t block = raw.size() - off;
    if (block > 65535) block = 65535;
    bool last = (off + block >= raw.size());
    z.push_back(last ? 1 : 0);                       // BFINAL, BTYPE=00 (stored)
    uint16_t len = (uint16_t)block, nlen = ~len;
    z.push_back(len & 0xFF); z.push_back((len >> 8) & 0xFF);
    z.push_back(nlen & 0xFF); z.push_back((nlen >> 8) & 0xFF);
    z.insert(z.end(), raw.begin() + off, raw.begin() + off + block);
    off += block;
  }
  // Adler32 of the raw data.
  uint32_t a = 1, b = 0;
  for (uint8_t byte : raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  uint32_t adler = (b << 16) | a;
  z.push_back((adler >> 24) & 0xFF); z.push_back((adler >> 16) & 0xFF);
  z.push_back((adler >> 8) & 0xFF);  z.push_back(adler & 0xFF);
  return z;
}

}  // namespace

bool SimPng::writeRgb565(const char* path, const uint16_t* fb, int w, int h) {
  // Build raw scanlines: each row prefixed with filter byte 0 (None), RGB8.
  std::vector<uint8_t> raw;
  raw.reserve((size_t)h * (1 + w * 3));
  for (int y = 0; y < h; y++) {
    raw.push_back(0);
    for (int x = 0; x < w; x++) {
      uint16_t px = fb[(size_t)y * w + x];
      uint8_t r5 = (px >> 11) & 0x1F, g6 = (px >> 5) & 0x3F, b5 = px & 0x1F;
      raw.push_back((r5 << 3) | (r5 >> 2));
      raw.push_back((g6 << 2) | (g6 >> 4));
      raw.push_back((b5 << 3) | (b5 >> 2));
    }
  }

  std::vector<uint8_t> out;
  const uint8_t sig[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  out.insert(out.end(), sig, sig + 8);

  std::vector<uint8_t> ihdr;
  put_u32(ihdr, (uint32_t)w); put_u32(ihdr, (uint32_t)h);
  ihdr.push_back(8);   // bit depth
  ihdr.push_back(2);   // color type 2 = truecolor RGB
  ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);  // deflate, no filter, no interlace
  chunk(out, "IHDR", ihdr);
  chunk(out, "IDAT", zlib_store(raw));
  chunk(out, "IEND", {});

  FILE* f = std::fopen(path, "wb");
  if (!f) return false;
  size_t wrote = std::fwrite(out.data(), 1, out.size(), f);
  std::fclose(f);
  return wrote == out.size();
}
