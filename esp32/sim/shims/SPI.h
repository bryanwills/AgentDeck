#pragma once
// Host shim for <SPI.h> — the e-ink path calls SPI.begin() for the panel bus;
// no real transfer happens on host.
#include <cstdint>
struct SimSPIClass {
  void begin(int = -1, int = -1, int = -1, int = -1) {}
  void end() {}
};
extern SimSPIClass SPI;
