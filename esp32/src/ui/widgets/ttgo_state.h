#pragma once

#include <lvgl.h>

namespace TTGO {

/**
 * TTGO State Widget — Shows agent state, project, model, and mini usage gauges.
 *
 * This is the default screen for TTGO T-Display. It shows:
 * - Agent state with colored dot (IDLE/PROCESSING/AWAITING/etc.)
 * - Project name (centered, large Korean font)
 * - Model name (centered, medium English font)
 * - Mini usage gauges at bottom (5h and 7d token usage)
 *
 * Layout adapts to portrait (135×240) and landscape (240×135) orientations.
 */
namespace StateWidget {

/**
 * Create the state widget as a child of parent.
 * Returns the widget object (lv_obj_t*).
 */
lv_obj_t* create(lv_obj_t* parent);

/**
 * Update the state widget with current data from g_state.
 * Call this from the main loop when the state screen is visible.
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

}  // namespace StateWidget

}  // namespace TTGO
