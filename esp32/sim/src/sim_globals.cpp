// Host-side definitions for firmware globals that live in main.cpp / display.cpp
// on-device (which the sim does not compile), plus the Arduino shim's Serial and
// deterministic random() backing.
#include <Arduino.h>
#include <lvgl.h>
#include <FastLED.h>
#include <WiFi.h>
#include "config.h"
#include "state/agent_state.h"

// Korean-fallback label font. On-device (display.cpp) this is a RAM copy of
// lv_font_montserrat_12 with a Noto Sans KR fallback pointer. The sim has no
// CJK glyphs bundled, so it falls back to plain Montserrat 12 — Latin labels
// (agent names, states) render identically; CJK would show as .notdef boxes.
lv_font_t font_kr_12 = lv_font_montserrat_12;
#if defined(BOARD_IPS10)
// Larger Korean-safe faces for the IPS10 detail overlay (display.h declares these
// only under BOARD_IPS10). Latin falls back to Montserrat at size; CJK unbundled.
lv_font_t font_kr_16 = lv_font_montserrat_16;
lv_font_t font_kr_20 = lv_font_montserrat_20;
#endif

// Firmware state singletons (defined in main.cpp on-device).
DashboardState g_state;
SemaphoreHandle_t g_stateMutex = (SemaphoreHandle_t)1;

// Runtime screen dimensions (defined in display.cpp on-device). Seeded from the
// board's SCREEN_W/SCREEN_H build flags.
int16_t g_screenW = SCREEN_W;
int16_t g_screenH = SCREEN_H;

// Arduino shim backing.
unsigned long g_sim_millis = 0;
SimSerial Serial;

// Deterministic PRNG (xorshift32) so successive runs produce identical frames.
static uint32_t s_rng = 0x1234567u;
void randomSeed(unsigned long seed) { s_rng = seed ? (uint32_t)seed : 1u; }
static uint32_t rngNext() {
  s_rng ^= s_rng << 13; s_rng ^= s_rng >> 17; s_rng ^= s_rng << 5;
  return s_rng;
}
long arduino_random(long howbig) {
  if (howbig <= 0) return 0;
  return (long)(rngNext() % (uint32_t)howbig);
}
long arduino_random(long howsmall, long howbig) {
  if (howbig <= howsmall) return howsmall;
  return howsmall + arduino_random(howbig - howsmall);
}

// ── Net / device-status shims ────────────────────────────────────────────────
// Scenes render as an online device (serial + WiFi connected). Definitions back
// the sim/shims/net/*.h declarations.
namespace Net {
bool serialConnected() { return true; }
void serialWriteJsonLine(const char*) {}
bool wifiConnected() { return true; }
const char* wifiLocalIP() { return "192.168.1.42"; }
void queueOutbound(const char*) {}
}  // namespace Net

// ── Display accessors (defined in display.cpp on-device) ─────────────────────
// The HUD queries orientation; the sim has no runtime rotation, so derive it
// from the compile-time screen dimensions.
namespace UI {
bool isLandscape() { return g_screenW >= g_screenH; }
void setBrightness(int) {}   // no backlight on host
}  // namespace UI

// ── TC001 matrix backing (defined in matrix_display.cpp on-device) ───────────
// The sim drives MatrixPages::render* directly, so it owns this global instead.
namespace Matrix { float smoothBrightness = 80.0f; }

// ── FastLED / WiFi shim instances ────────────────────────────────────────────
const CRGB CRGB::Black = CRGB(0, 0, 0);
SimFastLED FastLED;
SimWiFiClass WiFi;
