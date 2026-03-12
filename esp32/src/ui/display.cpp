#include "display.h"
#include "config.h"
#include "../boards/board_config.h"
#include "fonts/font_noto_kr_12.h"

#include <lvgl.h>
#include <Arduino.h>

#if !defined(BOARD_ROUND_AMOLED)
#include <LovyanGFX.hpp>
#endif

// Platform-specific includes for ESP32-S3 Bus_RGB / Panel_RGB
#if defined(BOARD_BOX_86)
#include <lgfx/v1/platforms/esp32s3/Bus_RGB.hpp>
#include <lgfx/v1/platforms/esp32s3/Panel_RGB.hpp>
#endif


// ============================================================
// Board-specific display driver
// ============================================================

#if defined(BOARD_BOX_86)
// ===== ESP32-S3-4848S040: ST7701 RGB 16-bit parallel =====
// Verified pin map from factory firmware backup.
// ST7701 init via 3-wire SPI, display via RGB parallel bus.
class LGFX : public lgfx::LGFX_Device {
public:
    lgfx::Bus_RGB        _bus_instance;
    lgfx::Panel_ST7701_guition_esp32_4848S040 _panel_instance;
    lgfx::Light_PWM      _light_instance;
    lgfx::Touch_GT911    _touch_instance;

    LGFX() {
        // RGB parallel bus configuration
        {
            auto cfg = _bus_instance.config();
            cfg.freq_write = 10000000;  // 10MHz — balance between tearing and refresh rate
            cfg.panel = &_panel_instance;  // CRITICAL: Bus_RGB needs panel pointer

            cfg.pin_pclk    = BOARD_PIN_PCLK;   // 21
            cfg.pin_vsync   = BOARD_PIN_VSYNC;  // 17
            cfg.pin_hsync   = BOARD_PIN_HSYNC;  // 16
            cfg.pin_henable = BOARD_PIN_DE;      // 18

            // RGB565 data pins
            cfg.pin_d0  = BOARD_PIN_B0;   // 4
            cfg.pin_d1  = BOARD_PIN_B1;   // 5
            cfg.pin_d2  = BOARD_PIN_B2;   // 6
            cfg.pin_d3  = BOARD_PIN_B3;   // 7
            cfg.pin_d4  = BOARD_PIN_B4;   // 15
            cfg.pin_d5  = BOARD_PIN_G0;   // 8
            cfg.pin_d6  = BOARD_PIN_G1;   // 20
            cfg.pin_d7  = BOARD_PIN_G2;   // 3
            cfg.pin_d8  = BOARD_PIN_G3;   // 46
            cfg.pin_d9  = BOARD_PIN_G4;   // 9
            cfg.pin_d10 = BOARD_PIN_G5;   // 10
            cfg.pin_d11 = BOARD_PIN_R0;   // 11
            cfg.pin_d12 = BOARD_PIN_R1;   // 12
            cfg.pin_d13 = BOARD_PIN_R2;   // 13
            cfg.pin_d14 = BOARD_PIN_R3;   // 14
            cfg.pin_d15 = BOARD_PIN_R4;   // 0

            cfg.hsync_pulse_width  = 8;
            cfg.hsync_back_porch   = 50;
            cfg.hsync_front_porch  = 10;
            cfg.hsync_polarity     = 0;

            cfg.vsync_pulse_width  = 8;
            cfg.vsync_back_porch   = 20;
            cfg.vsync_front_porch  = 10;
            cfg.vsync_polarity     = 0;

            cfg.pclk_active_neg    = 0;
            cfg.de_idle_high       = 1;
            cfg.pclk_idle_high     = 0;

            _bus_instance.config(cfg);
        }
        _panel_instance.setBus(&_bus_instance);

        // Panel configuration
        {
            auto cfg = _panel_instance.config();
            cfg.memory_width  = 480;
            cfg.memory_height = 480;
            cfg.panel_width   = 480;
            cfg.panel_height  = 480;
            cfg.offset_x      = 0;
            cfg.offset_y      = 0;
            _panel_instance.config(cfg);
        }

        // ST7701 init via 3-wire SPI
        {
            auto cfg = _panel_instance.config_detail();
            cfg.pin_cs   = BOARD_PIN_3WIRE_CS;    // 39
            cfg.pin_sclk = BOARD_PIN_3WIRE_CLK;   // 48
            cfg.pin_mosi = BOARD_PIN_3WIRE_MOSI;  // 47
            _panel_instance.config_detail(cfg);
        }

        // Backlight
        {
            auto cfg = _light_instance.config();
            cfg.pin_bl = BOARD_PIN_BL;  // 38
            cfg.invert = false;
            cfg.freq   = 12000;
            cfg.pwm_channel = 0;
            _light_instance.config(cfg);
            _panel_instance.setLight(&_light_instance);
        }

        // Touch: GT911 I2C
        {
            auto cfg = _touch_instance.config();
            cfg.i2c_port = 0;
            cfg.i2c_addr = BOARD_TOUCH_ADDR;      // 0x5D
            cfg.pin_sda  = BOARD_PIN_TOUCH_SDA;    // 19
            cfg.pin_scl  = BOARD_PIN_TOUCH_SCL;    // 45
            cfg.pin_int  = BOARD_PIN_TOUCH_INT;     // -1
            cfg.pin_rst  = BOARD_PIN_TOUCH_RST;     // -1
            cfg.x_min = 0;
            cfg.x_max = 479;
            cfg.y_min = 0;
            cfg.y_max = 479;
            _touch_instance.config(cfg);
            _panel_instance.setTouch(&_touch_instance);
        }

        setPanel(&_panel_instance);
    }
};

#elif defined(BOARD_IPS_35)
// ===== JC3248W535: AXS15231B QSPI =====
// QSPI not natively supported by LovyanGFX — use generic SPI with custom init.
// TODO: Implement via esp_lcd QSPI driver for proper support.
class LGFX : public lgfx::LGFX_Device {
public:
    lgfx::Bus_SPI        _bus_instance;
    lgfx::Panel_ST7789   _panel_instance;  // Fallback — init commands override
    lgfx::Light_PWM      _light_instance;
    lgfx::Touch_GT911    _touch_instance;

    LGFX() {
        // SPI bus (single-line fallback — QSPI needs esp_lcd for full speed)
        {
            auto cfg = _bus_instance.config();
            cfg.spi_host = SPI2_HOST;
            cfg.freq_write = 40000000;
            cfg.pin_sclk = BOARD_PIN_QSPI_CLK;  // 47
            cfg.pin_mosi = BOARD_PIN_QSPI_D0;   // 21
            cfg.pin_miso = -1;
            cfg.pin_dc   = -1;  // DC via command bit for QSPI panels
            _bus_instance.config(cfg);
        }
        _panel_instance.setBus(&_bus_instance);

        {
            auto cfg = _panel_instance.config();
            cfg.pin_cs   = BOARD_PIN_QSPI_CS;  // 45
            cfg.pin_rst  = -1;
            cfg.pin_busy = -1;
            cfg.memory_width  = BOARD_NATIVE_W;   // 320
            cfg.memory_height = BOARD_NATIVE_H;   // 480
            cfg.panel_width   = BOARD_NATIVE_W;
            cfg.panel_height  = BOARD_NATIVE_H;
            cfg.offset_rotation = BOARD_ROTATION;  // 1 = landscape
            _panel_instance.config(cfg);
        }

        {
            auto cfg = _light_instance.config();
            cfg.pin_bl = BOARD_PIN_BL;  // 1
            cfg.invert = false;
            cfg.freq   = 12000;
            cfg.pwm_channel = 0;
            _light_instance.config(cfg);
            _panel_instance.setLight(&_light_instance);
        }

        {
            auto cfg = _touch_instance.config();
            cfg.i2c_port = 0;
            cfg.i2c_addr = BOARD_TOUCH_ADDR;
            cfg.pin_sda  = BOARD_PIN_TOUCH_SDA;
            cfg.pin_scl  = BOARD_PIN_TOUCH_SCL;
            cfg.pin_int  = BOARD_PIN_TOUCH_INT;
            cfg.pin_rst  = BOARD_PIN_TOUCH_RST;
            cfg.x_min = 0;
            cfg.x_max = BOARD_NATIVE_W - 1;
            cfg.y_min = 0;
            cfg.y_max = BOARD_NATIVE_H - 1;
            _touch_instance.config(cfg);
            _panel_instance.setTouch(&_touch_instance);
        }

        setPanel(&_panel_instance);
    }
};

#elif defined(BOARD_ROUND_AMOLED)
// ===== JC3636W518: ST77916 QSPI AMOLED =====
// LovyanGFX Bus_SPI doesn't support ST77916 QSPI.
// Use ESP-IDF spi_master directly with SPI_TRANS_MODE_QIO for quad pixel writes.
// QSPI AMOLED protocol:
//   cmd=0x02 + 24-bit addr + data(1-line) — for init commands
//   cmd=0x32 + 24-bit addr + data(4-line) — for pixel data

#include "driver/spi_master.h"
#include <Wire.h>

static spi_device_handle_t qspi_dev = nullptr;

// --- QSPI transaction helpers (Arduino_GFX ESP32QSPI pattern) ---
// Device configured with command_bits=0, address_bits=0.
// Each transaction uses spi_transaction_ext_t to set cmd/addr bits per-call.

// Send LCD command with parameters (single SPI, 0x02 prefix)
static void lcd_cmd(uint8_t cmd, const uint8_t* data = nullptr, size_t len = 0) {
    spi_transaction_ext_t t = {};
    t.base.flags = SPI_TRANS_MULTILINE_CMD | SPI_TRANS_MULTILINE_ADDR;
    t.base.cmd = 0x02;
    t.base.addr = ((uint32_t)cmd) << 8;   // 24-bit: 0x00, cmd, 0x00
    t.command_bits = 8;
    t.address_bits = 24;
    if (len > 0 && data) {
        t.base.tx_buffer = data;
        t.base.length = len * 8;
    }
    spi_device_polling_transmit(qspi_dev, (spi_transaction_t*)&t);
}

static void lcd_set_window(uint16_t x1, uint16_t y1, uint16_t x2, uint16_t y2) {
    uint8_t caset[] = {(uint8_t)(x1 >> 8), (uint8_t)(x1), (uint8_t)(x2 >> 8), (uint8_t)(x2)};
    uint8_t raset[] = {(uint8_t)(y1 >> 8), (uint8_t)(y1), (uint8_t)(y2 >> 8), (uint8_t)(y2)};
    lcd_cmd(0x2A, caset, 4);
    lcd_cmd(0x2B, raset, 4);
}

// Send pixel data in quad mode (0x32 prefix, data on 4 lines)
static void lcd_color(const uint8_t* data, size_t len) {
    const size_t CHUNK = 32768;
    bool first = true;
    while (len > 0) {
        size_t send = (len > CHUNK) ? CHUNK : len;
        spi_transaction_ext_t t = {};
        t.base.flags = SPI_TRANS_MODE_QIO | SPI_TRANS_MULTILINE_CMD | SPI_TRANS_MULTILINE_ADDR;
        t.base.cmd = 0x32;                // Quad write prefix
        t.base.addr = first ? 0x002C00 : 0x003C00;
        t.base.tx_buffer = data;
        t.base.length = send * 8;
        t.command_bits = 8;
        t.address_bits = 24;
        spi_device_polling_transmit(qspi_dev, (spi_transaction_t*)&t);
        data += send;
        len -= send;
        first = false;
    }
}

// Fill screen with solid color (RGB565 big-endian)
static void lcd_fill(uint16_t color) {
    lcd_set_window(0, 0, SCREEN_W - 1, SCREEN_H - 1);
    constexpr size_t LINES = 40;
    size_t chunk_pixels = SCREEN_W * LINES;
    uint16_t* buf = (uint16_t*)heap_caps_malloc(chunk_pixels * 2, MALLOC_CAP_DMA);
    if (!buf) { Serial.println("[Display] lcd_fill alloc failed!"); return; }
    for (size_t i = 0; i < chunk_pixels; i++) buf[i] = color;
    size_t remaining = SCREEN_W * SCREEN_H;
    bool first = true;
    while (remaining > 0) {
        size_t send = (remaining > chunk_pixels) ? chunk_pixels : remaining;
        spi_transaction_ext_t t = {};
        t.base.flags = SPI_TRANS_MODE_QIO | SPI_TRANS_MULTILINE_CMD | SPI_TRANS_MULTILINE_ADDR;
        t.base.cmd = 0x32;
        t.base.addr = first ? 0x002C00 : 0x003C00;
        t.base.tx_buffer = buf;
        t.base.length = send * 2 * 8;
        t.command_bits = 8;
        t.address_bits = 24;
        spi_device_polling_transmit(qspi_dev, (spi_transaction_t*)&t);
        remaining -= send;
        first = false;
    }
    free(buf);
}

// Parse and send init commands in LovyanGFX byte-array format:
// [cmd, len_flags, data..., (delay_ms if 0x80 flag)] ... [0xFF, 0xFF] = end
static void lcd_send_init_sequence(const uint8_t* cmds) {
    const uint8_t* p = cmds;
    while (!(p[0] == 0xFF && p[1] == 0xFF)) {
        uint8_t cmd = *p++;
        uint8_t len_flags = *p++;
        uint8_t len = len_flags & 0x7F;
        bool has_delay = len_flags & 0x80;
        lcd_cmd(cmd, p, len);
        p += len;
        if (has_delay) {
            uint16_t ms = *p++;
            if (ms == 0) ms = 500;
            delay(ms);
        }
    }
}

// CST816S touch read via Wire I2C
static bool touch_read_cst816s(uint16_t* x, uint16_t* y) {
    Wire.beginTransmission(BOARD_TOUCH_ADDR);
    Wire.write(0x01);  // Num touch points register
    Wire.endTransmission(false);
    if (Wire.requestFrom((uint8_t)BOARD_TOUCH_ADDR, (uint8_t)6) < 6) return false;
    uint8_t buf[6];
    for (int i = 0; i < 6; i++) buf[i] = Wire.read();
    if (buf[0] == 0) return false;
    *x = ((buf[2] & 0x0F) << 8) | buf[3];
    *y = ((buf[4] & 0x0F) << 8) | buf[5];
    return true;
}

// ST77916 init sequence (from LovyanGFX Panel_ST77961, register-compatible)
static constexpr uint8_t st77916_init_list[] = {
    // Command Set Control
    0xF0, 1, 0x08,
    0xF2, 1, 0x08,
    0x9B, 1, 0x51,
    0x86, 1, 0x53,
    0xF2, 1, 0x80,
    0xF0, 1, 0x00,
    0xF0, 1, 0x01,  // Command 2 enable
    0xF1, 1, 0x01,  // Command 2 enable

    // Power settings
    0xB0, 1, 0x54,
    0xB1, 1, 0x3F,
    0xB2, 1, 0x2A,
    0xB4, 1, 0x46,
    0xB5, 1, 0x34,
    0xB6, 1, 0xD5,
    0xB7, 1, 0x30,
    0xB8, 1, 0x04,
    0xBA, 1, 0x00,
    0xBB, 1, 0x08,
    0xBC, 1, 0x08,
    0xBD, 1, 0x00,

    // Frame rate control
    0xC0, 1, 0x80,
    0xC1, 1, 0x10,
    0xC2, 1, 0x37,
    0xC3, 1, 0x80,
    0xC4, 1, 0x10,
    0xC5, 1, 0x37,

    // Power control
    0xC6, 1, 0xA9,
    0xC7, 1, 0x41,
    0xC8, 1, 0x51,
    0xC9, 1, 0xA9,
    0xCA, 1, 0x41,
    0xCB, 1, 0x51,

    // Resolution
    0xD0, 1, 0x91,
    0xD1, 1, 0x68,
    0xD2, 1, 0x69,

    0xF5, 2, 0x00, 0xA5,
    0xDD, 1, 0x35,
    0xDE, 1, 0x35,

    // Exit cmd set 2
    0xF1, 1, 0x10,
    0xF0, 1, 0x00,

    // Gamma correction
    0xF0, 1, 0x02,
    0xE0, 14, 0x70, 0x09, 0x12, 0x0C, 0x0B, 0x27, 0x38, 0x54,
              0x4E, 0x19, 0x15, 0x15, 0x2C, 0x2F,
    0xE1, 14, 0x70, 0x08, 0x11, 0x0C, 0x0B, 0x27, 0x38, 0x43,
              0x4C, 0x18, 0x14, 0x14, 0x2B, 0x2D,
    0xF0, 1, 0x10,

    // GIP settings
    0xF3, 1, 0x10,
    0xE0, 1, 0x0A,  0xE1, 1, 0x00,  0xE2, 1, 0x0B,  0xE3, 1, 0x00,
    0xE4, 1, 0xE0,  0xE5, 1, 0x06,  0xE6, 1, 0x21,  0xE7, 1, 0x00,
    0xE8, 1, 0x05,  0xE9, 1, 0x82,  0xEA, 1, 0xDF,  0xEB, 1, 0x89,
    0xEC, 1, 0x20,  0xED, 1, 0x14,  0xEE, 1, 0xFF,  0xEF, 1, 0x00,
    0xF8, 1, 0xFF,  0xF9, 1, 0x00,  0xFA, 1, 0x00,  0xFB, 1, 0x30,
    0xFC, 1, 0x00,  0xFD, 1, 0x00,  0xFE, 1, 0x00,  0xFF, 1, 0x00,
    0x60, 1, 0x42,  0x61, 1, 0xE0,  0x62, 1, 0x40,  0x63, 1, 0x40,
    0x64, 1, 0x02,  0x65, 1, 0x00,  0x66, 1, 0x40,  0x67, 1, 0x03,
    0x68, 1, 0x00,  0x69, 1, 0x00,  0x6A, 1, 0x00,  0x6B, 1, 0x00,
    0x70, 1, 0x42,  0x71, 1, 0xE0,  0x72, 1, 0x40,  0x73, 1, 0x40,
    0x74, 1, 0x02,  0x75, 1, 0x00,  0x76, 1, 0x40,  0x77, 1, 0x03,
    0x78, 1, 0x00,  0x79, 1, 0x00,  0x7A, 1, 0x00,  0x7B, 1, 0x00,
    0x80, 1, 0x38,  0x81, 1, 0x00,  0x82, 1, 0x04,  0x83, 1, 0x02,
    0x84, 1, 0xDC,  0x85, 1, 0x00,  0x86, 1, 0x00,  0x87, 1, 0x00,
    0x88, 1, 0x38,  0x89, 1, 0x00,  0x8A, 1, 0x06,  0x8B, 1, 0x02,
    0x8C, 1, 0xDE,  0x8D, 1, 0x00,  0x8E, 1, 0x00,  0x8F, 1, 0x00,
    0x90, 1, 0x38,  0x91, 1, 0x00,  0x92, 1, 0x08,  0x93, 1, 0x02,
    0x94, 1, 0xE0,  0x95, 1, 0x00,  0x96, 1, 0x00,  0x97, 1, 0x00,
    0x98, 1, 0x38,  0x99, 1, 0x00,  0x9A, 1, 0x0A,  0x9B, 1, 0x02,
    0x9C, 1, 0xE2,  0x9D, 1, 0x00,  0x9E, 1, 0x00,  0x9F, 1, 0x00,
    0xA0, 1, 0x38,  0xA1, 1, 0x00,  0xA2, 1, 0x03,  0xA3, 1, 0x02,
    0xA4, 1, 0xDB,  0xA5, 1, 0x00,  0xA6, 1, 0x00,  0xA7, 1, 0x00,
    0xA8, 1, 0x38,  0xA9, 1, 0x00,  0xAA, 1, 0x05,  0xAB, 1, 0x02,
    0xAC, 1, 0xDD,  0xAD, 1, 0x00,  0xAE, 1, 0x00,  0xAF, 1, 0x00,
    0xB0, 1, 0x38,  0xB1, 1, 0x00,  0xB2, 1, 0x07,  0xB3, 1, 0x02,
    0xB4, 1, 0xDF,  0xB5, 1, 0x00,  0xB6, 1, 0x00,  0xB7, 1, 0x00,
    0xB8, 1, 0x38,  0xB9, 1, 0x00,  0xBA, 1, 0x09,  0xBB, 1, 0x02,
    0xBC, 1, 0xE1,  0xBD, 1, 0x00,  0xBE, 1, 0x00,  0xBF, 1, 0x00,
    0xC0, 1, 0x22,  0xC1, 1, 0xAA,  0xC2, 1, 0x65,  0xC3, 1, 0x74,
    0xC4, 1, 0x47,  0xC5, 1, 0x56,  0xC6, 1, 0x00,  0xC7, 1, 0x88,
    0xC8, 1, 0x99,  0xC9, 1, 0x33,
    0xD0, 1, 0x11,  0xD1, 1, 0xAA,  0xD2, 1, 0x65,  0xD3, 1, 0x74,
    0xD4, 1, 0x47,  0xD5, 1, 0x56,  0xD6, 1, 0x00,  0xD7, 1, 0x88,
    0xD8, 1, 0x99,  0xD9, 1, 0x33,
    0xF3, 1, 0x01,  // Exit GIP
    0xF0, 1, 0x00,

    // OTP settings
    0xF0, 1, 0x01,
    0xF1, 1, 0x01,
    0xA0, 1, 0x0B,
    0xA3, 1, 0x2A,
    0xA5, 1 + 0x80, 0xC3, 1,   // + 1ms delay
    0xA3, 1, 0x2B,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x2C,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x2D,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x2E,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x2F,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x30,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x31,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x32,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA3, 1, 0x33,
    0xA5, 1 + 0x80, 0xC3, 1,
    0xA0, 1, 0x09,
    0xF1, 1, 0x10,
    0xF0, 1, 0x00,

    // Column/Row address for 360x360
    0x2A, 4, 0x00, 0x00, 0x01, 0x67,
    0x2B, 4, 0x00, 0x00, 0x01, 0x67,

    // Clear RAM
    0x4D, 1, 0x00,
    0x4E, 1, 0x00,
    0x4F, 1, 0x00,
    0x4C, 1 + 0x80, 0x01, 10,  // + 10ms delay
    0x4C, 1, 0x00,

    // Display on sequence — COLMOD before SLPOUT
    0x3A, 1, 0x55,                    // COLMOD: RGB565
    0x35, 1, 0x00,                    // TEON: TE line enable
    0x21, 0,                          // INVON
    0x11, 0 + 0x80, 120,             // SLPOUT + 120ms delay
    0x29, 0,                          // DISPON

    0xFF, 0xFF  // end
};

#else
#error "No board defined — cannot configure display"
#endif

// ============================================================
// Common LVGL integration
// ============================================================

#if !defined(BOARD_ROUND_AMOLED)
static LGFX tft;
#endif
static lv_display_t* disp = nullptr;

// Montserrat 12 + Korean fallback (initialized in displayInit)
lv_font_t font_kr_12;

// LVGL flush callback
static void disp_flush(lv_display_t* display, const lv_area_t* area, uint8_t* px_map) {
    uint32_t w = (area->x2 - area->x1 + 1);
    uint32_t h = (area->y2 - area->y1 + 1);

#if defined(BOARD_BOX_86)
    // RGB panel: pushImage writes directly to DMA framebuffer
    // swap565_t tells LovyanGFX data is already byte-swapped (RGB565_SWAPPED from LVGL)
    tft.pushImage(area->x1, area->y1, w, h, (lgfx::swap565_t*)px_map);
#elif defined(BOARD_ROUND_AMOLED)
    // QSPI: set window then send pixel data in quad mode
    lcd_set_window(area->x1, area->y1, area->x2, area->y2);
    lcd_color(px_map, w * h * 2);
#else
    tft.startWrite();
    tft.setAddrWindow(area->x1, area->y1, w, h);
    tft.writePixels((uint16_t*)px_map, w * h);
    tft.endWrite();
#endif

    lv_display_flush_ready(display);
}

// LVGL touch read callback
static void touch_read(lv_indev_t* indev, lv_indev_data_t* data) {
    uint16_t x, y;
#if defined(BOARD_ROUND_AMOLED)
    if (touch_read_cst816s(&x, &y)) {
#else
    if (tft.getTouch(&x, &y)) {
#endif
        data->point.x = x;
        data->point.y = y;
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

namespace UI {

void displayInit() {
#if defined(BOARD_ROUND_AMOLED)
    // === ST77916 QSPI AMOLED init via spi_master ===

    // Wait for USB CDC Serial to enumerate (native JTAG USB)
    delay(2000);
    Serial.println("[Display] === Round AMOLED ST77916 QSPI init ===");

    // Hardware reset
    pinMode(BOARD_PIN_RST, OUTPUT);
    digitalWrite(BOARD_PIN_RST, LOW);
    delay(20);
    digitalWrite(BOARD_PIN_RST, HIGH);
    delay(150);
    Serial.println("[Display] Panel RST toggled");

    // AMOLED power/backlight enable
    pinMode(BOARD_PIN_BL, OUTPUT);
    digitalWrite(BOARD_PIN_BL, HIGH);
    delay(100);
    Serial.println("[Display] BL pin HIGH");

    // Initialize SPI bus with QSPI (4 data lines)
    spi_bus_config_t buscfg = {};
    buscfg.sclk_io_num = BOARD_PIN_QSPI_CLK;
    buscfg.data0_io_num = BOARD_PIN_QSPI_D0;
    buscfg.data1_io_num = BOARD_PIN_QSPI_D1;
    buscfg.data2_io_num = BOARD_PIN_QSPI_D2;
    buscfg.data3_io_num = BOARD_PIN_QSPI_D3;
    buscfg.max_transfer_sz = SCREEN_W * 40 * sizeof(uint16_t);
    buscfg.flags = SPICOMMON_BUSFLAG_MASTER | SPICOMMON_BUSFLAG_QUAD;

    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO);
    Serial.printf("[Display] SPI bus init: %s (0x%x)\n", esp_err_to_name(ret), ret);

    // Add SPI device — half-duplex required for quad mode
    spi_device_interface_config_t devcfg = {};
    devcfg.command_bits = 8;
    devcfg.address_bits = 24;
    devcfg.mode = 0;
    devcfg.clock_speed_hz = 40 * 1000 * 1000;
    devcfg.spics_io_num = BOARD_PIN_QSPI_CS;
    devcfg.queue_size = 10;
    devcfg.flags = SPI_DEVICE_HALFDUPLEX;

    ret = spi_bus_add_device(SPI2_HOST, &devcfg, &qspi_dev);
    Serial.printf("[Display] SPI device add: %s (0x%x)\n", esp_err_to_name(ret), ret);

    // Send ST77916 init sequence
    lcd_send_init_sequence(st77916_init_list);
    Serial.println("[Display] ST77916 init sequence sent");

    // Fill test
    Serial.println("[Display] Fill test: RED...");
    lcd_fill(0x00F8);  // RED in big-endian RGB565
    delay(1000);
    Serial.println("[Display] Fill test: GREEN...");
    lcd_fill(0xE007);  // GREEN in big-endian RGB565
    delay(1000);
    Serial.println("[Display] Fill test complete");

    // Init touch I2C
    pinMode(BOARD_PIN_TOUCH_RST, OUTPUT);
    digitalWrite(BOARD_PIN_TOUCH_RST, LOW);
    delay(10);
    digitalWrite(BOARD_PIN_TOUCH_RST, HIGH);
    delay(50);
    Wire.begin(BOARD_PIN_TOUCH_SDA, BOARD_PIN_TOUCH_SCL);
    Serial.println("[Display] Touch CST816S initialized");

#else
    // LovyanGFX path for BOX_86 / IPS_35
    Serial.println("[Display] Calling tft.init()...");
    tft.init();
    Serial.println("[Display] tft.init() complete");
    tft.setRotation(BOARD_ROTATION);
    tft.setBrightness(255);
#endif

    lv_init();

    // Korean font fallback: create a RAM copy of montserrat_12 with fallback pointer set.
    // Can't modify the built-in font directly (it's in flash .rodata).
    // Instead, each UI file that needs Korean should use &font_kr_12 from display.h.
    font_kr_12 = lv_font_montserrat_12;  // Copy struct to RAM
    font_kr_12.fallback = &font_noto_kr_12;  // Set Korean fallback

    disp = lv_display_create(SCREEN_W, SCREEN_H);
    lv_display_set_flush_cb(disp, disp_flush);

#if defined(BOARD_BOX_86)
    // RGB panel: LVGL renders into internal SRAM buffer (fast), then memcpy to DMA
    // RGB565_SWAPPED = LVGL outputs big-endian RGB565 matching DMA byte order
    // Use internal SRAM (not PSRAM) for LVGL buffer to avoid PSRAM bus contention
    static constexpr size_t BUF_LINES = 40;
    size_t bufPixels = SCREEN_W * BUF_LINES;
    size_t bufSize = bufPixels * sizeof(uint16_t);
    // Try internal SRAM first for speed, fall back to PSRAM
    uint16_t* buf1 = (uint16_t*)heap_caps_malloc(bufSize, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    uint16_t* buf2 = (uint16_t*)heap_caps_malloc(bufSize, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    if (!buf1 || !buf2) {
        // Fallback to PSRAM
        if (buf1) free(buf1);
        if (buf2) free(buf2);
        buf1 = (uint16_t*)ps_malloc(bufSize);
        buf2 = (uint16_t*)ps_malloc(bufSize);
        Serial.println("[Display] Using PSRAM buffers (SRAM unavailable)");
    } else {
        Serial.println("[Display] Using internal SRAM buffers (fast)");
    }
    if (!buf1 || !buf2) {
        Serial.println("[Display] Buffer alloc failed!");
        return;
    }
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565_SWAPPED);
    lv_display_set_buffers(disp, buf1, buf2, bufSize,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    Serial.printf("[Display] LVGL initialized %dx%d (RGB565 swapped, partial)\n", SCREEN_W, SCREEN_H);
#else
    // SPI/QSPI panels: partial render with double PSRAM buffer, big-endian RGB565
    static constexpr size_t BUF_LINES = 40;
    size_t bufPixels = SCREEN_W * BUF_LINES;
    size_t bufSize = bufPixels * sizeof(uint16_t);
    uint16_t* buf1 = (uint16_t*)ps_malloc(bufSize);
    uint16_t* buf2 = (uint16_t*)ps_malloc(bufSize);
    if (!buf1 || !buf2) {
        Serial.println("[Display] PSRAM alloc failed!");
        return;
    }
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565_SWAPPED);
    lv_display_set_buffers(disp, buf1, buf2, bufSize,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    Serial.printf("[Display] LVGL initialized %dx%d (RGB565 swapped)\n", SCREEN_W, SCREEN_H);
#endif

    lv_indev_t* indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, touch_read);
}

lv_display_t* getDisplay() {
    return disp;
}

void setBrightness(int level) {
    if (level < 0) level = 0;
    if (level > 255) level = 255;
#if defined(BOARD_ROUND_AMOLED)
    // AMOLED: simple on/off via BL pin (no PWM)
    digitalWrite(BOARD_PIN_BL, level > 0 ? HIGH : LOW);
#else
    tft.setBrightness(level);
#endif
}

void lvglTick() {
    lv_tick_inc(LVGL_TICK_MS);
}

void lvglLoop() {
    lv_timer_handler();
}

}  // namespace UI
