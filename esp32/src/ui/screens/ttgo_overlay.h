#pragma once

#include <lvgl.h>

namespace TTGO {

/**
 * TTGO Overlay Manager — Manages priority-based screen switching.
 *
 * The overlay sits on top of the aquarium view and switches between:
 * - State screen (default): shows agent state, project, model, usage
 * - Activity screen (override): shows current tool or recent event
 *
 * Switching logic:
 * - Default to State screen
 * - Switch to Activity when tool starts OR new timeline event arrives
 * - Return to State after 5 seconds of no new activity
 *
 * This ensures users see the current state by default, with timely
 * updates when something interesting happens.
 */
namespace Overlay {

/**
 * Initialize the TTGO overlay system.
 * Creates the overlay container and both child widgets (State and Activity).
 * Activity widget is hidden initially.
 */
void init(lv_obj_t* parent);

/**
 * Update the overlay system.
 * Checks for activity triggers and handles screen switching.
 * Call this from the main loop every frame.
 */
void update();

/**
 * Show or hide the entire overlay.
 */
void setVisible(bool visible);

/**
 * Returns true if the overlay is currently visible.
 */
bool isVisible();

}  // namespace Overlay

}  // namespace TTGO
