#pragma once

// InkDeck — Seeed TRMNL 7.5" OG DIY Kit
// XIAO ESP32-S3 Plus (16MB flash / 8MB octal PSRAM) + 7.5" 800×480 1-bit
// e-ink panel (Good Display GDEY075T7, UC8179 driver) on the kit's EE04
// driver board. Pin map per the Seeed ESPHome cookbook, cross-checked with
// usetrmnl/trmnl-firmware include/config.h (VBAT/battery pins agree).

#define BOARD_NAME "InkDeck 7.5 e-ink"

// E-paper SPI (hardware FSPI on the XIAO S3)
#define BOARD_PIN_EPD_SCK   7
#define BOARD_PIN_EPD_MOSI  9
#define BOARD_PIN_EPD_CS    44
#define BOARD_PIN_EPD_DC    10
#define BOARD_PIN_EPD_RST   38
#define BOARD_PIN_EPD_BUSY  4

// Front keys (INPUT_PULLUP, active low)
#define BOARD_PIN_KEY1      2
#define BOARD_PIN_KEY2      3

// Battery telemetry (unused — InkDeck runs USB-powered)
#define BOARD_PIN_VBAT_EN   6
#define BOARD_PIN_VBAT_ADC  1
