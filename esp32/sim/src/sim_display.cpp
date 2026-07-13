// Headless LVGL display for host rendering. Creates a full-screen RGB565 display
// whose flush callback copies rendered pixels into an in-memory framebuffer,
// which the caller then encodes to PNG. No SDL / windowing dependency, so it runs
// unattended in CI just like the Node preview tools.
#include "sim.h"
#include <lvgl.h>
#include <cstdlib>
#include <cstring>

// Virtual clock, defined in sim_globals.cpp (backs the Arduino shim's millis()).
extern unsigned long g_sim_millis;

namespace {
lv_display_t* s_disp = nullptr;
uint16_t* s_fb = nullptr;       // final framebuffer, tightly packed (w*h RGB565)
uint8_t*  s_drawbuf = nullptr;  // LVGL full-screen render buffer (stride-padded)
int s_w = 0, s_h = 0;
uint32_t s_stride = 0;          // LVGL row stride in bytes (>= w*2, 32-aligned)

// LVGL pads each row up to LV_DRAW_BUF_STRIDE_ALIGN (32 B here), so a board whose
// width*2 isn't a multiple of 32 (e.g. 360px AMOLED, 135/144px TTGO) gets padded
// rows. Copy stride-aware into the tightly-packed framebuffer, dropping the pad.
void flush_cb(lv_display_t* d, const lv_area_t* area, uint8_t* px_map) {
  for (int32_t y = area->y1; y <= area->y2; y++) {
    const uint16_t* row = reinterpret_cast<const uint16_t*>(px_map + (size_t)y * s_stride);
    for (int32_t x = area->x1; x <= area->x2; x++) {
      s_fb[(size_t)y * s_w + x] = row[x];
    }
  }
  lv_display_flush_ready(d);
}
}  // namespace

void SimDisplay::init(int w, int h) {
  s_w = w; s_h = h;
  lv_init();
  s_stride = lv_draw_buf_width_to_stride(w, LV_COLOR_FORMAT_RGB565);
  s_fb = static_cast<uint16_t*>(std::calloc((size_t)w * h, sizeof(uint16_t)));
  s_drawbuf = static_cast<uint8_t*>(std::calloc((size_t)s_stride * h, 1));
  s_disp = lv_display_create(w, h);
  lv_display_set_color_format(s_disp, LV_COLOR_FORMAT_RGB565);
  lv_display_set_buffers(s_disp, s_drawbuf, nullptr,
                         s_stride * h, LV_DISPLAY_RENDER_MODE_FULL);
  lv_display_set_flush_cb(s_disp, flush_cb);
}

lv_obj_t* SimDisplay::screen() { return lv_screen_active(); }
void SimDisplay::loadScreen(lv_obj_t* scr) { lv_screen_load(scr); }

void SimDisplay::tick(uint32_t ms) {
  g_sim_millis += ms;
  lv_tick_inc(ms);
}

void SimDisplay::refresh() {
  lv_timer_handler();   // process pending timers/animations
  lv_refr_now(s_disp);  // synchronous composite + flush into s_fb
}

const uint16_t* SimDisplay::framebuffer() { return s_fb; }
int SimDisplay::width() { return s_w; }
int SimDisplay::height() { return s_h; }
