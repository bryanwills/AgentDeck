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

// Capacitive touch bus. Current boards use GT911 (measured 0x5D on the owned
// unit, 2026-08-30); firmware also probes the older controller carried by the
// pinned vendor library. IRQ is not RTC-capable on the S3, so GPIO21 remains
// the deep-sleep wake/escape input.
//
// The touch panel reaches this bus through its own 8-pin 0.5mm FPC into header
// P6 (1=VDD3V3, 2=GND, 3=SDA18, 4=SCL17, 5=INT47, 6=T_RST, 7/8=NC) -- a
// separate flex from the e-paper tail. T_RST is a 4.7K pull-up plus 1uF RC with
// no GPIO, so the GT911 re-runs power-on reset and I2C address selection only
// when 3V3 actually falls; a USB reset or reflash never re-arms it.
#define BOARD_PIN_I2C_SDA    18
#define BOARD_PIN_I2C_SCL    17
#define BOARD_PIN_TOUCH_INT  47
#define BOARD_PIN_TOUCH_RST  -1
