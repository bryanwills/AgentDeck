#pragma once

// RockBase NM-EPD-420 — ESP32-S3 N16R8 + 4.2" 400x300 tri-color panel.
// Pin map is from the board schematic and the manufacturer's reference
// firmware (RockBase-iot/NM-EPD-420, 66727fcf). The standard, non-BW SKU uses
// the GDEY042Z98 black/white/red panel. Although the SSD1683 driver advertises
// a black-plane differential mode, both full-screen and bounded red-free trials
// produced a dark wash on the on-hand tri-color glass. AgentDeck therefore
// forbids refresh_bw() on this SKU and uses stock full-color updates only.

#define BOARD_NAME "NM-EPD-420 4.2 e-ink"

#define BOARD_PIN_EPD_SCK   2
#define BOARD_PIN_EPD_MOSI  1
#define BOARD_PIN_EPD_CS   46
#define BOARD_PIN_EPD_DC    4
#define BOARD_PIN_EPD_RST   5
#define BOARD_PIN_EPD_BUSY  6

// BOOT is an RTC GPIO and is the deep-sleep wake/PTT control. USER is the
// invariant escape control while awake.
#define BOARD_PIN_KEY1      0
#define BOARD_PIN_KEY2     45
#define BOARD_PIN_WAKE      0

// ES8311 full-duplex codec + external PA hardware path (not enabled by this
// display-first firmware target): I2C 39/38, MCLK 21, BCLK 15, LRCLK 17,
// ESP->codec 18, codec->ESP 16, PA_EN 41, CODEC_EN 44.
#define BOARD_PIN_I2C_SDA   39
#define BOARD_PIN_I2C_SCL   38

#define BOARD_PIN_BATT_ADC   3
#define BOARD_PIN_BATT_EN   43
