#include "splash.h"
#include "../theme.h"
#include "../assets/logo.h"
#include "config.h"

static lv_obj_t* screen = nullptr;
static lv_obj_t* imgLogo = nullptr;
static lv_obj_t* lblTitle = nullptr;
static lv_obj_t* lblStatus = nullptr;
static lv_obj_t* lblWifiStatus = nullptr;
static lv_obj_t* spinner = nullptr;

namespace Screens {

lv_obj_t* splashCreate() {
    screen = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x163B5C), 0);  // ShallowWater — brighter
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Brand icon — AD shield logo
    imgLogo = lv_image_create(screen);
    lv_image_set_src(imgLogo, &img_logo_48);
#if defined(BOARD_TTGO)
    lv_obj_align(imgLogo, LV_ALIGN_CENTER, 0, -40);
#else
    lv_obj_align(imgLogo, LV_ALIGN_CENTER, 0, -55);
#endif

    // Title
    lblTitle = lv_label_create(screen);
    lv_obj_set_style_text_color(lblTitle, lv_color_hex(Theme::HUDText), 0);
    lv_obj_set_style_text_font(lblTitle, &lv_font_montserrat_20, 0);
    lv_label_set_text(lblTitle, "AgentDeck");
#if defined(BOARD_TTGO)
    lv_obj_align(lblTitle, LV_ALIGN_CENTER, 0, -18);
#else
    lv_obj_align(lblTitle, LV_ALIGN_CENTER, 0, -25);
#endif

    // Spinner
    spinner = lv_spinner_create(screen);
    lv_obj_set_size(spinner, 40, 40);
#if defined(BOARD_TTGO)
    lv_obj_align(spinner, LV_ALIGN_CENTER, 0, 10);
#else
    lv_obj_align(spinner, LV_ALIGN_CENTER, 0, 15);
#endif
    lv_spinner_set_anim_params(spinner, 1000, 200);

    // Status text
    lblStatus = lv_label_create(screen);
    lv_obj_set_style_text_color(lblStatus, lv_color_hex(Theme::HUDDim), 0);
    lv_obj_set_style_text_font(lblStatus, &lv_font_montserrat_12, 0);
    lv_label_set_text(lblStatus, "Searching for bridges...");
#if defined(BOARD_TTGO)
    lv_obj_align(lblStatus, LV_ALIGN_CENTER, 0, 38);
#else
    lv_obj_align(lblStatus, LV_ALIGN_CENTER, 0, 55);
#endif

    // WiFi provisioning sub-status (below main status)
    lblWifiStatus = lv_label_create(screen);
    lv_obj_set_style_text_color(lblWifiStatus, lv_color_hex(Theme::HUDDim), 0);
    lv_obj_set_style_text_font(lblWifiStatus, &lv_font_montserrat_10, 0);
    lv_label_set_text(lblWifiStatus, "");
#if defined(BOARD_TTGO)
    lv_obj_align(lblWifiStatus, LV_ALIGN_CENTER, 0, 52);
#else
    lv_obj_align(lblWifiStatus, LV_ALIGN_CENTER, 0, 73);
#endif

    return screen;
}

void splashSetStatus(const char* text) {
    if (lblStatus) {
        lv_label_set_text(lblStatus, text);
    }
}

void splashSetWifiStatus(const char* text) {
    if (lblWifiStatus) {
        lv_label_set_text(lblWifiStatus, text);
    }
}

}  // namespace Screens
