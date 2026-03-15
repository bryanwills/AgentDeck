#pragma once

// ===== JC3248W535 — 3.5" IPS 320x480 (AXS15231B QSPI + integrated touch) =====
// Port: cu.usbmodem83201 (Native JTAG)
// MAC: 3C:0F:02:D2:F7:38
// Manufacturer: Guition (Jingcai)

// Display: AXS15231B (QSPI interface)
#define BOARD_DISPLAY_TYPE   DISPLAY_AXS15231B_QSPI
#define BOARD_PIN_QSPI_CS   45
#define BOARD_PIN_QSPI_CLK  47
#define BOARD_PIN_QSPI_D0   21
#define BOARD_PIN_QSPI_D1   48
#define BOARD_PIN_QSPI_D2   40
#define BOARD_PIN_QSPI_D3   39
#define BOARD_PIN_BL         1
#define BOARD_PIN_TE         38    // Tearing effect sync

// Touch: AXS15231B integrated (I2C)
#define BOARD_TOUCH_TYPE     TOUCH_AXS15231B
#define BOARD_TOUCH_ADDR     0x3B
#define BOARD_PIN_TOUCH_SDA  4
#define BOARD_PIN_TOUCH_SCL  8
#define BOARD_PIN_TOUCH_INT  11
#define BOARD_PIN_TOUCH_RST  12

// Display settings
#define BOARD_ROTATION       1     // Landscape (320→width, 480→height becomes 480×320)
#define BOARD_INVERT         false
#define BOARD_NATIVE_W       320   // Panel native width
#define BOARD_NATIVE_H       480   // Panel native height

// SD card (SDMMC 4-bit)
#define BOARD_HAS_SD         1
