#pragma once

#include <cstdint>
#include "../../state/agent_state.h"

namespace Cloud {

void init();

/**
 * Render one cloud creature instance (Codex CLI).
 * Body: 6 overlapping filled circles forming a cloud shape.
 * Interior: ">_" prompt text.
 *
 * @param buf    Pixel buffer
 * @param w,h    Screen dimensions
 * @param time   Total elapsed time
 * @param dt     Delta time since last frame
 * @param state  Creature state
 * @param idx    Instance index (0-based, for multi-session)
 * @param total  Total cloud count
 */
void render(uint16_t* buf, int w, int h, float time, float dt,
            CreatureState state, uint8_t idx, uint8_t total);

/** Get current X position (fractional 0-1) for particles/bubbles tracking. */
float getX(uint8_t idx);

/** Get current Y position (fractional 0-1) for particles/bubbles tracking. */
float getY(uint8_t idx);

}  // namespace Cloud
