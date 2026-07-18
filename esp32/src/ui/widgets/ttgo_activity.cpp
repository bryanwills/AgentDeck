#include "ttgo_activity.h"
#include "../theme.h"
#include "../display.h"
#include "../../state/agent_state.h"
#include "../boards/board_config.h"
#include "config.h"
#include <cstring>
#include <cstdio>
#include <algorithm>

using std::min;

// Activity widget objects
static lv_obj_t* widget = nullptr;
static lv_obj_t* lblTitle = nullptr;    // "ACTIVITY" or similar
static lv_obj_t* lblTool = nullptr;     // Current tool + input
static lv_obj_t* lblEvent = nullptr;    // Recent timeline event

static bool visible = false;

#if defined(BOARD_TTGO)
static constexpr int TTGO_TERRARIUM_LONG_EDGE = 160;
static constexpr uint32_t TTGO_METRIC_BG = 0x2A1F14;

static lv_obj_t* createMetricPanel(lv_obj_t* parent, bool portrait, int screenW, int screenH) {
    lv_obj_t* panel = lv_obj_create(parent);
    if (portrait) {
        lv_obj_set_size(panel, screenW, screenH - TTGO_TERRARIUM_LONG_EDGE);
        lv_obj_set_pos(panel, 0, TTGO_TERRARIUM_LONG_EDGE);
    } else {
        lv_obj_set_size(panel, screenW - TTGO_TERRARIUM_LONG_EDGE, screenH);
        lv_obj_set_pos(panel, TTGO_TERRARIUM_LONG_EDGE, 0);
    }
    lv_obj_set_style_bg_color(panel, lv_color_hex(TTGO_METRIC_BG), 0);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(panel, 0, 0);
    lv_obj_set_style_radius(panel, 0, 0);
    lv_obj_set_style_pad_all(panel, 0, 0);
    lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
    return panel;
}
#endif

// Helper: get event color
static uint32_t eventColor(const char* type) {
    if (strcmp(type, "chat_start") == 0 || strcmp(type, "user_action") == 0)
        return Theme::TLChatStart;
    if (strcmp(type, "tool_request") == 0 || strcmp(type, "tool_exec") == 0)
        return Theme::TLToolReq;
    if (strcmp(type, "tool_resolved") == 0)
        return Theme::TLToolOk;
    if (strcmp(type, "error") == 0)
        return Theme::TLError;
    if (strcmp(type, "chat_end") == 0 || strcmp(type, "chat_response") == 0)
        return Theme::TLChatEnd;
    if (strcmp(type, "model_call") == 0 || strcmp(type, "model_response") == 0)
        return Theme::TLModelCall;
    if (strcmp(type, "eval_result") == 0)
        return Theme::TLToolReq;
    return Theme::HUDDim;
}

// Helper: get event icon
static const char* eventIcon(const char* type) {
    if (strcmp(type, "chat_start") == 0 || strcmp(type, "user_action") == 0) return ">";
    if (strcmp(type, "tool_request") == 0 || strcmp(type, "tool_exec") == 0) return "#";
    if (strcmp(type, "tool_resolved") == 0) return "v";
    if (strcmp(type, "error") == 0) return "x";
    if (strcmp(type, "chat_end") == 0 || strcmp(type, "chat_response") == 0) return "*";
    if (strcmp(type, "model_call") == 0 || strcmp(type, "model_response") == 0) return "~";
    if (strcmp(type, "eval_result") == 0) return "@";
    return ".";
}

namespace TTGO {
namespace ActivityWidget {

lv_obj_t* create(lv_obj_t* parent) {
    const bool portrait = !UI::isLandscape();
    const int screenW = g_screenW;
    const int screenH = g_screenH;

    // Main widget container
    widget = lv_obj_create(parent);
    lv_obj_set_size(widget, screenW, screenH);
    lv_obj_set_pos(widget, 0, 0);
#if defined(BOARD_TTGO)
    lv_obj_set_style_bg_opa(widget, LV_OPA_TRANSP, 0);
#else
    lv_obj_set_style_bg_color(widget, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(widget, LV_OPA_50, 0);
#endif
    lv_obj_set_style_border_width(widget, 0, 0);
    lv_obj_set_style_pad_all(widget, 0, 0);
    lv_obj_clear_flag(widget, LV_OBJ_FLAG_SCROLLABLE);

#if defined(BOARD_TTGO)
    lv_obj_t* content = createMetricPanel(widget, portrait, screenW, screenH);
    const int contentW = portrait ? screenW : (screenW - TTGO_TERRARIUM_LONG_EDGE);
#else
    lv_obj_t* content = widget;
    const int contentW = screenW;
#endif

    if (portrait) {
        // ===== Portrait layout =====

        // Title at top
#if defined(BOARD_TTGO)
        lblTitle = lv_label_create(content);
        lv_obj_set_style_text_font(lblTitle, &lv_font_montserrat_10, 0);
        lv_obj_align(lblTitle, LV_ALIGN_TOP_MID, 0, 5);
#else
        lblTitle = lv_label_create(content);
        lv_obj_set_style_text_font(lblTitle, &lv_font_montserrat_12, 0);
        lv_obj_align(lblTitle, LV_ALIGN_TOP_MID, 0, 8);
#endif
        lv_obj_set_style_text_color(lblTitle, lv_color_hex(Theme::HUDDim), 0);
        lv_label_set_text(lblTitle, "▶ ACTIVITY");

        // Tool display (large, prominent)
        lblTool = lv_label_create(content);
        lv_obj_set_style_text_font(lblTool, &font_kr_12, 0);
        lv_obj_set_style_text_color(lblTool, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblTool, contentW - 16);
        lv_obj_set_style_text_align(lblTool, LV_TEXT_ALIGN_CENTER, 0);
#if defined(BOARD_TTGO)
        lv_obj_align(lblTool, LV_ALIGN_TOP_MID, 0, 24);
#else
        lv_obj_align(lblTool, LV_ALIGN_TOP_MID, 0, 32);
#endif
        lv_label_set_long_mode(lblTool, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblTool, "");

        // Event display (below tool)
        lblEvent = lv_label_create(content);
        lv_obj_set_style_text_font(lblEvent, &font_kr_12, 0);
        lv_obj_set_style_text_color(lblEvent, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblEvent, contentW - 16);
        lv_obj_set_style_text_align(lblEvent, LV_TEXT_ALIGN_CENTER, 0);
#if defined(BOARD_TTGO)
        lv_obj_align(lblEvent, LV_ALIGN_TOP_MID, 0, 49);
#else
        lv_obj_align(lblEvent, LV_ALIGN_TOP_MID, 0, 72);
#endif
        lv_label_set_long_mode(lblEvent, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblEvent, "");

    } else {
        // ===== Landscape layout =====

#if defined(BOARD_TTGO)
        lblTitle = lv_label_create(content);
        lv_obj_set_style_text_font(lblTitle, &lv_font_montserrat_10, 0);
        lv_obj_set_style_text_color(lblTitle, lv_color_hex(Theme::HUDDim), 0);
        lv_obj_set_width(lblTitle, contentW - 8);
        lv_obj_set_style_text_align(lblTitle, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_align(lblTitle, LV_ALIGN_TOP_MID, 0, 8);
        lv_label_set_text(lblTitle, "▶");

        lblTool = lv_label_create(content);
        lv_obj_set_style_text_font(lblTool, &font_kr_12, 0);
        lv_obj_set_style_text_color(lblTool, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblTool, contentW - 8);
        lv_obj_set_style_text_align(lblTool, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_align(lblTool, LV_ALIGN_TOP_MID, 0, 31);
        lv_label_set_long_mode(lblTool, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblTool, "");

        lblEvent = lv_label_create(content);
        lv_obj_set_style_text_font(lblEvent, &lv_font_montserrat_10, 0);
        lv_obj_set_style_text_color(lblEvent, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblEvent, contentW - 8);
        lv_obj_set_style_text_align(lblEvent, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_align(lblEvent, LV_ALIGN_TOP_MID, 0, 56);
        lv_label_set_long_mode(lblEvent, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblEvent, "");
#else
        // Compact horizontal layout
        lblTitle = lv_label_create(content);
        lv_obj_set_style_text_font(lblTitle, &lv_font_montserrat_10, 0);
        lv_obj_set_style_text_color(lblTitle, lv_color_hex(Theme::HUDDim), 0);
        lv_obj_align(lblTitle, LV_ALIGN_TOP_LEFT, 8, 12);
        lv_label_set_text(lblTitle, "▶");

        lblTool = lv_label_create(content);
        lv_obj_set_style_text_font(lblTool, &font_kr_12, 0);
        lv_obj_set_style_text_color(lblTool, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblTool, screenW - 48);
        lv_obj_align(lblTool, LV_ALIGN_TOP_LEFT, 28, 12);
        lv_label_set_long_mode(lblTool, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblTool, "");

        lblEvent = lv_label_create(content);
        lv_obj_set_style_text_font(lblEvent, &lv_font_montserrat_10, 0);
        lv_obj_set_style_text_color(lblEvent, lv_color_hex(Theme::HUDText), 0);
        lv_obj_set_width(lblEvent, screenW - 16);
        lv_obj_align(lblEvent, LV_ALIGN_TOP_LEFT, 8, 32);
        lv_label_set_long_mode(lblEvent, LV_LABEL_LONG_DOT);
        lv_label_set_text(lblEvent, "");
#endif
    }

    return widget;
}

void update() {
    if (!widget) return;

    lockState();
    char currentTool[40];
    char toolInput[80];
    strncpy(currentTool, g_state.currentTool, sizeof(currentTool) - 1);
    currentTool[sizeof(currentTool) - 1] = '\0';
    strncpy(toolInput, g_state.toolInput, sizeof(toolInput) - 1);
    toolInput[sizeof(toolInput) - 1] = '\0';

    // Get most recent timeline event
    uint8_t tlCount = g_state.timelineCount;
    uint8_t tlHead = g_state.timelineHead;
    TimelineEntry recentEntry = {0, "", "", "", ""};
    if (tlCount > 0) {
        int idx = (tlHead + tlCount - 1) % TIMELINE_MAX_ENTRIES;
        recentEntry = g_state.timeline[idx];
    }
    unlockState();

    // Check if we have a tool running
    bool hasTool = (currentTool[0] != '\0');

    if (hasTool) {
        // Show tool + input
        lv_obj_clear_flag(lblTool, LV_OBJ_FLAG_HIDDEN);

        char buf[128];
        if (toolInput[0]) {
            snprintf(buf, sizeof(buf), "%s: %s", currentTool, toolInput);
        } else {
            snprintf(buf, sizeof(buf), "%s", currentTool);
        }
        lv_label_set_text(lblTool, buf);

        // Hide event label when showing tool
        lv_obj_add_flag(lblEvent, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(lblTitle, "▶ RUNNING");

    } else {
        // Show recent event if available
        lv_obj_add_flag(lblTool, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(lblEvent, LV_OBJ_FLAG_HIDDEN);

        if (recentEntry.raw[0]) {
            // Format: "HH:MM icon event"
            int hours = (recentEntry.ts / 3600) % 24;
            int minutes = (recentEntry.ts / 60) % 60;
            char buf[160];
            snprintf(buf, sizeof(buf), "%02d:%02d %s %s",
                     hours, minutes, eventIcon(recentEntry.type), recentEntry.raw);
            lv_label_set_text(lblEvent, buf);
            lv_obj_set_style_text_color(lblEvent, lv_color_hex(eventColor(recentEntry.type)), 0);
            lv_label_set_text(lblTitle, "▶ ACTIVITY");
        } else {
            lv_label_set_text(lblEvent, "");
            lv_label_set_text(lblTitle, "▶ NO ACTIVITY");
        }
    }
}

void setVisible(bool v) {
    visible = v;
    if (widget) {
        if (v) {
            lv_obj_clear_flag(widget, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(widget, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

bool isVisible() {
    return visible && widget && !lv_obj_has_flag(widget, LV_OBJ_FLAG_HIDDEN);
}

}  // namespace ActivityWidget
}  // namespace TTGO
