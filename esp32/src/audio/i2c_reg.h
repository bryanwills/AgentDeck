#pragma once

#include <stdint.h>

// The ES8311 driver needs exactly two functions from the host: an 8-bit
// register read and write. Those live in `namespace UI` and used to be reached
// by including ui/display.h — which pulls in <lvgl.h> and therefore cannot be
// compiled on an e-ink board, where LVGL is excluded from the build entirely.
//
// Declaring the contract here instead lets the codec link against whichever
// implementation the board's build selected: ui/display.cpp on an LVGL board,
// ui/eink/eink_i2c.cpp on an e-ink board with a codec. Neither implementation
// changed; only the header dependency did.
namespace UI {
bool hwI2cReadReg8(uint8_t addr, uint8_t reg, uint8_t* out);
bool hwI2cWriteReg8(uint8_t addr, uint8_t reg, uint8_t val);
}  // namespace UI
