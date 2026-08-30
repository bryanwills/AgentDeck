#pragma once

// LilyGo T5 4.7" ePaper S3 V2.4 — ESP32-S3-WROOM-1-N16R8 + ED047TC2.
// The panel is driven by the board's 8-bit parallel/I2S bus inside the official
// LilyGo-EPD47 driver. GPIO21 is the only application button on the S3 model;
// GPIO0 is BOOT/recovery and RST is not a software control. The owned unit's
// panel is mounted opposite the controller's native scan orientation, so the
// UI framebuffer must be presented at rotation 2 (180 degrees).

#define BOARD_NAME "LilyGo T5 4.7 e-ink"
#define BOARD_EINK_ROTATION 2

#define BOARD_PIN_KEY1      21
#define BOARD_PIN_KEY2      21
#define BOARD_PIN_WAKE      21
#define BOARD_PIN_BATT_ADC  14

// Capacitive touch bus. Current boards use GT911; firmware also probes the
// older controller carried by the pinned vendor library. IRQ is not RTC-
// capable on the S3, so GPIO21 remains the deep-sleep wake/escape input.
#define BOARD_PIN_I2C_SDA    18
#define BOARD_PIN_I2C_SCL    17
#define BOARD_PIN_TOUCH_INT  47
#define BOARD_PIN_TOUCH_RST  -1
