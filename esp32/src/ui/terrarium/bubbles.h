#pragma once

#include <cstdint>
#include "../../state/agent_state.h"

namespace Bubbles {

void init();

/** Update bubble positions (rise + wobble).
 *  octCount: number of octopuses to exhale from. */
void update(float dt, float time, CreatureState state, uint8_t octCount = 1);

/** Render all bubbles. */
void render(uint16_t* buf, int w, int h);

/** Emit bubbles from creature exhale. */
void emitAt(float nx, float ny, int count);

/** Emit radial pop burst (ASKING exit). */
void emitPopBurst(float nx, float ny);

}  // namespace Bubbles
