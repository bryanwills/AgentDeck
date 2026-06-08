#include "aquarium.h"
#include "../terrarium/renderer.h"
#include "../widgets/hud_bar.h"
#include "../display.h"
#include "../theme.h"
#include "../assets/logo.h"
#include "../../state/agent_state.h"
#include "config.h"

#if defined(BOARD_TTGO)
#include "ttgo_overlay.h"
#endif

static lv_obj_t* screen = nullptr;
static lv_obj_t* connScrim = nullptr;
static lv_obj_t* connCard = nullptr;
static lv_obj_t* connLogoImg = nullptr;
static lv_obj_t* connTitleLabel = nullptr;
static lv_obj_t* connSpinner = nullptr;
static lv_obj_t* connStatusLabel = nullptr;
static bool lastHostDisplayOn = true;

#if defined(BOARD_IPS35)
static lv_obj_t* btnRotate = nullptr;
static lv_obj_t* lblRotate = nullptr;
#endif

// Manual swipe detection — LVGL gesture events unreliable on some touch drivers (GT911)
static lv_point_t touchStart;
static bool tracking = false;
static constexpr int SWIPE_THRESHOLD = 40;  // minimum pixels for swipe

static void gestureEvent(lv_event_t* e) {
    lv_dir_t dir = lv_indev_get_gesture_dir(lv_indev_active());
    if (dir == LV_DIR_TOP) {
        lockState();
        g_state.timelineView = true;
        unlockState();
    }
}

static void screenTouchEvent(lv_event_t* e) {
    lv_event_code_t code = lv_event_get_code(e);

    if (code == LV_EVENT_PRESSED) {
        lv_indev_t* indev = lv_indev_active();
        if (indev) {
            lv_indev_get_point(indev, &touchStart);
            tracking = true;
        }
    } else if (code == LV_EVENT_RELEASED && tracking) {
        tracking = false;
        lv_point_t touchEnd;
        lv_indev_t* indev = lv_indev_active();
        if (indev) {
            lv_indev_get_point(indev, &touchEnd);
            int dy = touchEnd.y - touchStart.y;
            int dx = touchEnd.x - touchStart.x;
            int absDy = (dy < 0) ? -dy : dy;
            int absDx = (dx < 0) ? -dx : dx;
            if (absDy > SWIPE_THRESHOLD && absDy > absDx) {
                if (dy < 0) {
                    // Swipe up → timeline
                    lockState();
                    g_state.timelineView = true;
                    unlockState();
                }
            }
        }
    } else if (code == LV_EVENT_SHORT_CLICKED) {
        // Tap → toggle HUD visibility (only if no swipe detected)
        HUD::setVisible(!HUD::isVisible());
    }
}

namespace Screens {

lv_obj_t* aquariumCreate() {
    screen = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x000000), 0);
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Create terrarium canvas (full screen)
    Terrarium::init(screen);

#if defined(BOARD_TTGO)
    // TTGO: Use simplified overlay (state + activity switching)
    TTGO::Overlay::init(screen);
#else
    // Create HUD overlay
    HUD::init(screen);
#endif

    // Connection overlay — full-screen scrim + centered card (Android/Apple style)
    connScrim = lv_obj_create(screen);
    lv_obj_set_size(connScrim, LV_PCT(100), LV_PCT(100));
    lv_obj_set_style_bg_color(connScrim, lv_color_hex(0x0F172A), 0);
    lv_obj_set_style_bg_opa(connScrim, 204, 0);   // 80% — matches Android 0xCC
    lv_obj_set_style_border_width(connScrim, 0, 0);
    lv_obj_set_style_radius(connScrim, 0, 0);
    lv_obj_set_style_pad_all(connScrim, 0, 0);
    lv_obj_align(connScrim, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_flag(connScrim, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(connScrim, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(connScrim, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_clear_flag(connScrim, LV_OBJ_FLAG_SCROLLABLE);

    // Card container (centered in scrim)
    connCard = lv_obj_create(connScrim);
#if defined(BOARD_TTGO)
    lv_obj_set_width(connCard, 200);
#elif IS_ROUND
    lv_obj_set_width(connCard, 220);
#else
    lv_obj_set_width(connCard, 260);
#endif
    lv_obj_set_height(connCard, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_color(connCard, lv_color_hex(0x1E293B), 0);
    lv_obj_set_style_bg_opa(connCard, 230, 0);   // 90% — matches Android 0xE6
    lv_obj_set_style_radius(connCard, 12, 0);
    lv_obj_set_style_border_width(connCard, 0, 0);
    lv_obj_set_style_pad_ver(connCard, 24, 0);
    lv_obj_set_style_pad_hor(connCard, 16, 0);
    lv_obj_set_style_pad_row(connCard, 8, 0);
    lv_obj_align(connCard, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_flex_flow(connCard, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(connCard, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_clear_flag(connCard, LV_OBJ_FLAG_SCROLLABLE);

    // Brand logo — AD shield icon
    connLogoImg = lv_image_create(connCard);
    lv_image_set_src(connLogoImg, &img_logo_48);

    // Title "AgentDeck"
    connTitleLabel = lv_label_create(connCard);
    lv_obj_set_style_text_color(connTitleLabel, lv_color_hex(Theme::HUDText), 0);
    lv_obj_set_style_text_font(connTitleLabel, &lv_font_montserrat_20, 0);
    lv_label_set_text(connTitleLabel, "AgentDeck");

    // Spinner (36×36) — smoother animation with shorter period
    connSpinner = lv_spinner_create(connCard);
    lv_obj_set_size(connSpinner, 36, 36);
    lv_spinner_set_anim_params(connSpinner, 800, 360);
    lv_obj_set_style_arc_color(connSpinner, lv_color_hex(0x1E293B), 0);
    lv_obj_set_style_arc_color(connSpinner, lv_color_hex(0x60A5FA), LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(connSpinner, 3, 0);
    lv_obj_set_style_arc_width(connSpinner, 3, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(connSpinner, true, 0);

    // Status text
    connStatusLabel = lv_label_create(connCard);
    lv_obj_set_style_text_color(connStatusLabel, lv_color_hex(Theme::HUDDim), 0);
    lv_obj_set_style_text_font(connStatusLabel, &lv_font_montserrat_12, 0);
    lv_label_set_text(connStatusLabel, "");

    // Swipe + tap detection: manual tracking as fallback for LVGL gesture
    lv_obj_add_event_cb(screen, gestureEvent, LV_EVENT_GESTURE, NULL);
    lv_obj_add_event_cb(screen, screenTouchEvent, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(screen, screenTouchEvent, LV_EVENT_RELEASED, NULL);
    lv_obj_add_event_cb(screen, screenTouchEvent, LV_EVENT_SHORT_CLICKED, NULL);

#if defined(BOARD_IPS35)
    // Rotation button — bottom-right corner, small and unobtrusive
    btnRotate = lv_btn_create(screen);
    lv_obj_set_size(btnRotate, 36, 36);
    lv_obj_align(btnRotate, LV_ALIGN_BOTTOM_LEFT, 8, -8);
    lv_obj_set_style_bg_color(btnRotate, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(btnRotate, LV_OPA_50, 0);
    lv_obj_set_style_border_width(btnRotate, 1, 0);
    lv_obj_set_style_border_color(btnRotate, lv_color_hex(Theme::HUDDim), 0);
    lv_obj_set_style_border_opa(btnRotate, LV_OPA_40, 0);
    lv_obj_set_style_radius(btnRotate, 8, 0);
    lv_obj_set_style_shadow_width(btnRotate, 0, 0);
    lv_obj_set_style_pad_all(btnRotate, 0, 0);
    lv_obj_add_event_cb(btnRotate, [](lv_event_t* e) {
        lockState();
        g_state.pendingLandscape = !UI::isLandscape();
        g_state.orientationChanged = true;
        unlockState();
    }, LV_EVENT_CLICKED, NULL);

    // Rotation icon: ↻ symbol
    lblRotate = lv_label_create(btnRotate);
    lv_obj_set_style_text_color(lblRotate, lv_color_hex(Theme::HUDText), 0);
    lv_obj_set_style_text_font(lblRotate, &lv_font_montserrat_20, 0);
    lv_label_set_text(lblRotate, LV_SYMBOL_REFRESH);
    lv_obj_center(lblRotate);
#endif

    return screen;
}

void aquariumUpdate(float dt) {
    // Host display sleep → dim/restore ESP32 backlight
    lockState();
    bool displayOn = g_state.hostDisplayOn;
    uint8_t userBright = g_state.userBrightness;
    unlockState();

    if (displayOn != lastHostDisplayOn) {
        lastHostDisplayOn = displayOn;
        UI::setBrightness(displayOn ? userBright : 0);
    }

    // Render terrarium frame
    Terrarium::render(dt);

#if defined(BOARD_TTGO)
    // TTGO: Update simplified overlay
    TTGO::Overlay::update();
#else
    // Update HUD data
    HUD::update();
#endif
}

void aquariumSetConnectionStatus(ConnOverlayStatus status) {
    if (!connScrim || !connStatusLabel || !connSpinner) return;

    if (status == ConnOverlayStatus::HIDDEN) {
#if defined(BOARD_TTGO)
        TTGO::Overlay::setVisible(true);
#endif
        lv_obj_add_flag(connScrim, LV_OBJ_FLAG_HIDDEN);
        return;
    }

#if defined(BOARD_TTGO)
    TTGO::Overlay::setVisible(false);
#endif

    // Show scrim
    lv_obj_clear_flag(connScrim, LV_OBJ_FLAG_HIDDEN);

    switch (status) {
        case ConnOverlayStatus::NO_WIFI:
            lv_label_set_text(connStatusLabel, "No WiFi");
            lv_obj_add_flag(connSpinner, LV_OBJ_FLAG_HIDDEN);
            break;
        case ConnOverlayStatus::SEARCHING:
            lv_label_set_text(connStatusLabel, "Searching for bridges...");
            lv_obj_clear_flag(connSpinner, LV_OBJ_FLAG_HIDDEN);
            break;
        case ConnOverlayStatus::RECONNECTING:
            lv_label_set_text(connStatusLabel, "Reconnecting...");
            lv_obj_clear_flag(connSpinner, LV_OBJ_FLAG_HIDDEN);
            break;
        default:
            break;
    }
}

}  // namespace Screens
