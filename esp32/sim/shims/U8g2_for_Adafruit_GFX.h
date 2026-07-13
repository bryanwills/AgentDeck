#pragma once
// Host shim for <U8g2_for_Adafruit_GFX.h>. The e-ink renderer uses U8g2 only for
// multibyte (Korean) text — ASCII labels stay on the crisp GFX FreeFonts. The sim
// scenes are ASCII, so this path is effectively unused; stubbed to no-ops. CJK
// would be absent (matches the sim's documented Latin-only limitation).
#include <cstdint>
#include <cstring>

// The Korean unifont symbol referenced by the e-ink font setup.
inline const uint8_t* const u8g2_font_unifont_t_korean2 = nullptr;

class U8G2_FOR_ADAFRUIT_GFX {
public:
  template <typename Display> void begin(Display&) {}
  void setFont(const uint8_t*) {}
  void setFontMode(uint8_t) {}
  void setForegroundColor(uint16_t) {}
  void setCursor(int16_t, int16_t) {}
  void print(const char*) {}
  int16_t getUTF8Width(const char* s) { return s ? (int16_t)(std::strlen(s) * 8) : 0; }
};
