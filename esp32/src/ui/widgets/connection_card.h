#pragma once

#include <lvgl.h>
#include "../theme.h"

// Shared dark connection/empty-state card for the two interaction-first ESP32
// companions (T-Embed knob and T-Display Pro strip). The caller rebuilds its
// bounded LVGL body only when the visible signature changes. This helper adds
// only a fixed set of LVGL widgets: no dynamic buffers, STL containers, timers,
// or per-frame allocations of its own.
namespace ConnectionCard {

inline lv_obj_t* label(lv_obj_t* parent, const lv_font_t* font,
                       uint32_t color, const char* text) {
    lv_obj_t* out = lv_label_create(parent);
    lv_obj_set_style_text_font(out, font, 0);
    lv_obj_set_style_text_color(out, lv_color_hex(color), 0);
    lv_label_set_text(out, text);
    return out;
}

inline void render(lv_obj_t* parent, int width, int height,
                   const char* status, const char* detail,
                   bool connectedEmpty = false) {
    const int panelW = width >= 400 ? width - 64 : width - 40;
    const int panelH = height >= 150 ? height - 28 : height - 20;

    lv_obj_t* panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_set_size(panel, panelW, panelH);
    lv_obj_set_style_bg_color(panel, lv_color_hex(Theme::DeepSea), 0);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(panel, lv_color_hex(Theme::MidWater), 0);
    lv_obj_set_style_border_width(panel, 1, 0);
    lv_obj_set_style_radius(panel, 10, 0);
    lv_obj_align(panel, LV_ALIGN_CENTER, 0, 0);

    lv_obj_t* rail = lv_obj_create(panel);
    lv_obj_remove_style_all(rail);
    lv_obj_set_size(rail, 4, panelH - 24);
    lv_obj_set_style_bg_color(
        rail, lv_color_hex(connectedEmpty ? Theme::StatusGreen : Theme::StatusCyan), 0);
    lv_obj_set_style_bg_opa(rail, connectedEmpty ? LV_OPA_50 : LV_OPA_70, 0);
    lv_obj_set_style_radius(rail, 2, 0);
    lv_obj_align(rail, LV_ALIGN_LEFT_MID, 12, 0);

    lv_obj_t* brand = label(panel, &lv_font_montserrat_12,
                            Theme::StatusCyan, "AGENTDECK");
    lv_obj_align(brand, LV_ALIGN_TOP_LEFT, 30, 13);

    lv_obj_t* title = label(panel, &lv_font_montserrat_20,
                            Theme::HUDText, status);
    lv_obj_align(title, LV_ALIGN_LEFT_MID, 30, 2);

    lv_obj_t* sub = label(panel, &lv_font_montserrat_12,
                          Theme::HUDDim, detail);
    lv_obj_align(sub, LV_ALIGN_BOTTOM_LEFT, 30, -12);
}

}  // namespace ConnectionCard
