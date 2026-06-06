#include "ttgo_overlay.h"
#include "../widgets/ttgo_state.h"
#include "../widgets/ttgo_activity.h"
#include "../display.h"
#include "../../state/agent_state.h"
#include "config.h"
#include <Arduino.h>

// Overlay objects
static lv_obj_t* overlay = nullptr;
static lv_obj_t* stateWidget = nullptr;
static lv_obj_t* activityWidget = nullptr;

// State tracking
static bool showingActivity = false;
static uint32_t activityTimeout = 0;
static uint8_t lastTimelineCount = 0;
static bool lastHadTool = false;

// Activity timeout: 5 seconds of no new activity
static constexpr uint32_t ACTIVITY_TIMEOUT_MS = 5000;

namespace TTGO {
namespace Overlay {

void init(lv_obj_t* parent) {
    // Create overlay container (transparent, just a holder)
    overlay = lv_obj_create(parent);
    lv_obj_set_size(overlay, g_screenW, g_screenH);
    lv_obj_set_pos(overlay, 0, 0);
    lv_obj_set_style_bg_opa(overlay, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(overlay, 0, 0);
    lv_obj_set_style_pad_all(overlay, 0, 0);
    lv_obj_clear_flag(overlay, LV_OBJ_FLAG_SCROLLABLE);

    // Create State widget (visible by default)
    stateWidget = StateWidget::create(overlay);

    // Create Activity widget (hidden initially)
    activityWidget = ActivityWidget::create(overlay);
    ActivityWidget::setVisible(false);

    // Initialize tracking
    lockState();
    lastTimelineCount = g_state.timelineCount;
    lastHadTool = (g_state.currentTool[0] != '\0');
    unlockState();
}

void update() {
    if (!overlay) return;

    // Check for activity triggers
    lockState();
    bool hasTool = (g_state.currentTool[0] != '\0');
    uint8_t newTimelineCount = g_state.timelineCount;
    unlockState();

    // Detect new activity
    bool newActivity = false;
    if (!showingActivity) {
        // Trigger if tool started OR new timeline event arrived
        if ((hasTool && !lastHadTool) || (newTimelineCount > lastTimelineCount)) {
            newActivity = true;
        }
    }

    // Update tracking
    lastTimelineCount = newTimelineCount;
    lastHadTool = hasTool;

    // Handle screen switching
    uint32_t now = millis();
    if (newActivity) {
        // Switch to activity screen
        showingActivity = true;
        activityTimeout = now + ACTIVITY_TIMEOUT_MS;
        StateWidget::setVisible(false);
        ActivityWidget::setVisible(true);
    } else if (showingActivity && now > activityTimeout) {
        // Timeout elapsed, return to state screen
        showingActivity = false;
        StateWidget::setVisible(true);
        ActivityWidget::setVisible(false);
    }

    // Update visible widget
    if (showingActivity) {
        ActivityWidget::update();
    } else {
        StateWidget::update();
    }
}

void setVisible(bool visible) {
    if (overlay) {
        if (visible) {
            lv_obj_clear_flag(overlay, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(overlay, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

bool isVisible() {
    return overlay && !lv_obj_has_flag(overlay, LV_OBJ_FLAG_HIDDEN);
}

}  // namespace Overlay
}  // namespace TTGO
