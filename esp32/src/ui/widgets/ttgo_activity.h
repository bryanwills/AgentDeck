#pragma once

#include <lvgl.h>

namespace TTGO {

/**
 * TTGO Activity Widget — Shows current tool or recent timeline event.
 *
 * This screen overrides the State widget when activity is detected:
 * - Shows current tool + input if a tool is running
 * - OR shows most recent timeline event if no tool is active
 * - Auto-hides after 5 seconds of no new activity
 *
 * Layout adapts to portrait (135×240) and landscape (240×135) orientations.
 */
namespace ActivityWidget {

/**
 * Create the activity widget as a child of parent.
 * Returns the widget object (lv_obj_t*).
 */
lv_obj_t* create(lv_obj_t* parent);

/**
 * Update the activity widget with current data from g_state.
 * Call this from the main loop when the activity screen is visible.
 */
void update();

/**
 * Show or hide the widget.
 */
void setVisible(bool visible);

/**
 * Returns true if the widget is currently visible.
 */
bool isVisible();

}  // namespace ActivityWidget

}  // namespace TTGO
