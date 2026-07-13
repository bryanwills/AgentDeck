#pragma once
// Host shim for <FastLED.h> — just enough of the CRGB pixel type + the FastLED
// controller no-ops that the TC001 matrix render path uses. The matrix renderer
// draws into a CRGB[] buffer (LVGL-free); the sim reads that buffer back out to
// PNG, so CRGB must expose r/g/b.
#include <cstdint>

struct CRGB {
  uint8_t r = 0, g = 0, b = 0;
  CRGB() = default;
  CRGB(uint8_t rr, uint8_t gg, uint8_t bb) : r(rr), g(gg), b(bb) {}
  CRGB(uint32_t hex) : r((hex >> 16) & 0xFF), g((hex >> 8) & 0xFF), b(hex & 0xFF) {}
  // Common in-place ops FastLED renderers reach for (kept faithful).
  CRGB& nscale8(uint8_t s) {
    r = (uint16_t)r * (s + 1) >> 8;
    g = (uint16_t)g * (s + 1) >> 8;
    b = (uint16_t)b * (s + 1) >> 8;
    return *this;
  }
  CRGB& fadeToBlackBy(uint8_t s) { return nscale8(255 - s); }
  static const CRGB Black;
};

inline bool operator==(const CRGB& a, const CRGB& b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
inline bool operator!=(const CRGB& a, const CRGB& b) { return !(a == b); }

inline void fill_solid(CRGB* leds, int n, CRGB c) { for (int i = 0; i < n; i++) leds[i] = c; }

// Linear per-channel blend, matching FastLED's blend(existing, overlay, amount).
inline CRGB blend(const CRGB& a, const CRGB& b, uint8_t amt) {
  return CRGB(
    (uint8_t)(a.r + (((int)b.r - a.r) * amt >> 8)),
    (uint8_t)(a.g + (((int)b.g - a.g) * amt >> 8)),
    (uint8_t)(a.b + (((int)b.b - a.b) * amt >> 8)));
}
inline CRGB& nblend(CRGB& existing, const CRGB& overlay, uint8_t amt) {
  existing = blend(existing, overlay, amt); return existing;
}

enum EOrder { RGB = 0x012, GRB = 0x102, BRG = 0x120 };
enum ELEDType { WS2812B };

struct SimFastLED {
  template <int, int, int> void addLeds(CRGB*, int) {}
  template <ELEDType, int, EOrder> void addLeds(CRGB*, int) {}
  void setBrightness(uint8_t) {}
  void setDither(uint8_t) {}
  void setMaxRefreshRate(uint16_t) {}
  void show() {}
  void clear(bool = false) {}
};
extern SimFastLED FastLED;
