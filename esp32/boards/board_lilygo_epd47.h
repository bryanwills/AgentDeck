#pragma once

// LilyGo T5 4.7" ePaper S3 V2.4 — ESP32-S3-WROOM-1-N16R8 + ED047TC2.
// The panel is driven by the board's 8-bit parallel/I2S bus inside the official
// LilyGo-EPD47 driver. GPIO21 is the only application button on the S3 model;
// GPIO0 is BOOT/recovery and RST is not a software control.

#define BOARD_NAME "LilyGo T5 4.7 e-ink"

#define BOARD_PIN_KEY1      21
#define BOARD_PIN_KEY2      21
#define BOARD_PIN_WAKE      21
#define BOARD_PIN_BATT_ADC  14
