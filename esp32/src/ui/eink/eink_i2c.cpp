// I2C register transport for e-ink boards.
//
// Es8311::begin() reaches its codec through UI::hwI2cReadReg8/hwI2cWriteReg8,
// whose only implementation lived in ui/display.cpp — the LVGL module every
// e-ink env excludes from its build_src_filter. That coupling is why the
// RockBase NM-EPD-420's ES8311 sat unreachable despite the codec driver, the
// pin map and the host voice pipeline all already existing: the missing piece
// was a transport, not a feature.
//
// This provides the same two-function contract over Arduino Wire on the board's
// documented I2C pins. It is compiled only for an e-ink board that declares a
// codec, so the boards that genuinely have no audio hardware link nothing.
#include "../../../boards/board_config.h"

#if defined(BOARD_EINK_SURFACE) && defined(BOARD_SPK_CODEC_ES8311)

#include <Arduino.h>
#include <Wire.h>

#include "../../audio/i2c_reg.h"

namespace UI {
namespace {
bool s_begun = false;
void ensureBus() {
    if (s_begun) return;
    // Idempotent: the touch probe on other boards calls Wire.begin() with the
    // same pins, and Arduino's TwoWire tolerates a repeat begin.
    Wire.begin(BOARD_PIN_I2C_SDA, BOARD_PIN_I2C_SCL);
    Wire.setClock(100000);
    s_begun = true;
}
}  // namespace

bool hwI2cReadReg8(uint8_t addr, uint8_t reg, uint8_t* out) {
    if (!out) return false;
    ensureBus();
    Wire.beginTransmission(addr);
    Wire.write(reg);
    // Repeated START, not STOP: the ES8311 aborts a register read that is split
    // by a bus release.
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom((int)addr, 1) != 1) return false;
    *out = (uint8_t)Wire.read();
    return true;
}

bool hwI2cWriteReg8(uint8_t addr, uint8_t reg, uint8_t val) {
    ensureBus();
    Wire.beginTransmission(addr);
    Wire.write(reg);
    Wire.write(val);
    return Wire.endTransmission() == 0;
}

}  // namespace UI

#endif  // BOARD_EINK_SURFACE && BOARD_SPK_CODEC_ES8311
