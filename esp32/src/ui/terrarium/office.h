#pragma once
#include <lvgl.h>

// IPS10 "office" scene — a sprite/dirty-rect replacement for the per-pixel aquarium
// terrarium. A STATIC office background is drawn once; each agent is an LVGL sprite that
// gently wanders (sin-based) while working and sits at its desk when idle. LVGL only
// re-flushes the sprites that actually moved, so per-frame cost scales with motion, not
// with screen area — far cheaper on the low-power P4 panel than redrawing 408×800 px/frame.
namespace Office {
void init(lv_obj_t* parent);   // build static background + agent sprite pool
void update(float dt);          // map agent state → sprite + advance gentle motion
void setVisible(bool v);
}  // namespace Office
