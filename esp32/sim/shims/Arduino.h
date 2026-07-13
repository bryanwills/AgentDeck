#pragma once
// Host shim for <Arduino.h> — provides the tiny slice of the Arduino core that
// the AgentDeck terrarium render surface actually touches (millis/micros, a
// stderr Serial, map(), a deterministic random(), and ps_malloc → malloc).
//
// Deliberately does NOT define the Arduino min()/max() macros: the firmware
// uses `using std::min/max`, and the macros would break those call sites.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cstring>
#include <cstddef>

// Virtual clock. Advanced by the sim driver (SimDisplay::tick) so rendered
// frames are deterministic and reproducible instead of wall-clock dependent.
extern unsigned long g_sim_millis;
inline unsigned long millis() { return g_sim_millis; }
inline unsigned long micros() { return g_sim_millis * 1000UL; }
inline void delay(unsigned long) {}
inline void delayMicroseconds(unsigned int) {}

// Arduino map() — integer range remap.
inline long map(long x, long in_min, long in_max, long out_min, long out_max) {
  if (in_max == in_min) return out_min;
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// Deterministic Arduino random() (seeded in sim_main for reproducible frames).
long arduino_random(long howbig);
long arduino_random(long howsmall, long howbig);
void randomSeed(unsigned long seed);
// Arduino exposes these as random(); alias without colliding with POSIX random(void).
#define random(...) arduino_random(__VA_ARGS__)

// PSRAM allocators → host heap.
inline void* ps_malloc(size_t n) { return std::malloc(n); }
inline void* ps_calloc(size_t n, size_t s) { return std::calloc(n, s); }
inline void* ps_realloc(void* p, size_t n) { return std::realloc(p, n); }

// Minimal Serial → stderr (keeps stdout clean for potential piping).
struct SimSerial {
  void begin(unsigned long) {}
  void print(const char* s) { std::fputs(s, stderr); }
  void print(int v) { std::fprintf(stderr, "%d", v); }
  void println(const char* s) { std::fputs(s, stderr); std::fputc('\n', stderr); }
  void println(int v) { std::fprintf(stderr, "%d\n", v); }
  void println() { std::fputc('\n', stderr); }
  int printf(const char* fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int r = std::vfprintf(stderr, fmt, ap); va_end(ap); return r;
  }
};
extern SimSerial Serial;
