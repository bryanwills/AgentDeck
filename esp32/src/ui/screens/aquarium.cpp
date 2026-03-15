#include "aquarium.h"
#include "../terrarium/renderer.h"
#include "../widgets/hud_bar.h"
#include "../display.h"
#include "../theme.h"
#include "../../state/agent_state.h"
#include "config.h"

static lv_obj_t* screen = nullptr;
static lv_obj_t* connScrim = nullptr;
static lv_obj_t* connCard = nullptr;
static lv_obj_t* connIconLabel = nullptr;
static lv_obj_t* connTitleLabel = nullptr;
static lv_obj_t* connSpinner = nullptr;
static lv_obj_t* connStatusLabel = nullptr;
static bool lastHostDisplayOn = true;

// Gesture state for swipe detection
static lv_point_t touchStart;
static bool tracking = false;

static void gestureEvent(lv_event_t* e) {
    lv_dir_t dir = lv_indev_get_gesture_dir(lv_indev_active());
    if (dir == LV_DIR_TOP) {
        // Swipe up → switch to timeline
        lockState();
        g_state.timelineView = true;
        unlockState();
    }
}

static void touchEvent(lv_event_t* e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_SHORT_CLICKED) {
        // Tap → toggle HUD visibility
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

    // Create HUD overlay
    HUD::init(screen);

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
    lv_obj_clear_flag(connScrim, LV_OBJ_FLAG_SCROLLABLE);

    // Card container (centered in scrim)
    connCard = lv_obj_create(connScrim);
#if IS_ROUND
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

    // Icon "{ }" — terracotta branding
    connIconLabel = lv_label_create(connCard);
    lv_obj_set_style_text_color(connIconLabel, lv_color_hex(0xC07058), 0);
    lv_obj_set_style_text_font(connIconLabel, &lv_font_montserrat_20, 0);
    lv_label_set_text(connIconLabel, "{ }");

    // Title "AgentDeck"
    connTitleLabel = lv_label_create(connCard);
    lv_obj_set_style_text_color(connTitleLabel, lv_color_hex(Theme::HUDText), 0);
    lv_obj_set_style_text_font(connTitleLabel, &lv_font_montserrat_20, 0);
    lv_label_set_text(connTitleLabel, "AgentDeck");

    // Spinner (36×36)
    connSpinner = lv_spinner_create(connCard);
    lv_obj_set_size(connSpinner, 36, 36);
    lv_spinner_set_anim_params(connSpinner, 1000, 270);
    lv_obj_set_style_arc_color(connSpinner, lv_color_hex(0x334155), 0);
    lv_obj_set_style_arc_color(connSpinner, lv_color_hex(Theme::HUDText), LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(connSpinner, 4, 0);
    lv_obj_set_style_arc_width(connSpinner, 4, LV_PART_INDICATOR);

    // Status text
    connStatusLabel = lv_label_create(connCard);
    lv_obj_set_style_text_color(connStatusLabel, lv_color_hex(Theme::HUDDim), 0);
    lv_obj_set_style_text_font(connStatusLabel, &lv_font_montserrat_12, 0);
    lv_label_set_text(connStatusLabel, "");

    // Gesture detection for swipe up → timeline
    lv_obj_add_event_cb(screen, gestureEvent, LV_EVENT_GESTURE, NULL);
    lv_obj_add_event_cb(screen, touchEvent, LV_EVENT_SHORT_CLICKED, NULL);

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

    // Update HUD data
    HUD::update();
}

void aquariumSetConnectionStatus(ConnOverlayStatus status) {
    if (!connScrim || !connStatusLabel || !connSpinner) return;

    if (status == ConnOverlayStatus::HIDDEN) {
        lv_obj_add_flag(connScrim, LV_OBJ_FLAG_HIDDEN);
        return;
    }

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
