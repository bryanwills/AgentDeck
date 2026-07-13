#pragma once
// Minimal Arduino Print base class — enough for Adafruit_GFX (which extends Print
// and overrides write(uint8_t) to render glyphs). display.print(str) walks the
// string through write(), so text renders via the GFX font path.
#include <cstddef>
#include <cstdint>
#include <cstring>

class Print {
public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) = 0;
  virtual size_t write(const uint8_t* buf, size_t n) {
    size_t c = 0; while (n--) c += write(*buf++); return c;
  }
  size_t write(const char* s) { return s ? write((const uint8_t*)s, std::strlen(s)) : 0; }
  size_t print(const char* s) { return write(s); }
  size_t print(char c) { return write((uint8_t)c); }
  size_t println(const char* s) { size_t n = print(s); n += write((uint8_t)'\n'); return n; }
  size_t println() { return write((uint8_t)'\n'); }
};
