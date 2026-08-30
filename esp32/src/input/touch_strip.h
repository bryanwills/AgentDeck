#pragma once

#include <cstdint>

// SensorLib touch gesture layer. T-Display Pro uses CST226SE; EPD47 uses
// GT911. Both expose display-oriented coordinates for direct targets/swipes.

namespace Input {

enum class TouchGesture : uint8_t { NONE = 0, TAP, HOLD, SWIPE_LEFT, SWIPE_RIGHT };

struct TouchEvent {
    TouchGesture gesture;
    int16_t x;
    int16_t y;
};

bool touchInit();
bool touchReady();
/** EPD47 boot probe diagnostics. Address is 0 when no supported controller
 * answered; the count includes every I2C peripheral seen on the touch bus. */
uint8_t touchAddress();
uint8_t touchI2cDeviceCount();
bool touchRtcSeen();
TouchEvent touchPoll(uint32_t nowMs);

/**
 * Pocket (portrait) mode: the CST226SE's native portrait report matches the
 * rotation-0 display directly, so LVGL's pointer indev reads raw points here
 * and the gesture layer (touchPoll) stays out of the loop — two consumers
 * polling the same controller would fight over press state.
 */
void touchSetPortrait(bool portrait);
bool touchPortrait();
/** Current raw point in display coordinates; true while a finger is down. */
bool touchRawPoint(int16_t* x, int16_t* y);

/** Diagnostics for device_info: raw finger-down poll hits since boot. */
uint32_t touchDownSamples();
/** Diagnostics for device_info: decoded gestures (tap/hold/swipe) since boot. */
uint32_t touchGestures();
/** Diagnostics: last TAP position and max raw coords seen (coordinate-space
 *  forensics for a mis-oriented controller). -1 / 0 until data arrives. */
int16_t touchLastX();
int16_t touchLastY();
int16_t touchMaxX();
int16_t touchMaxY();

}  // namespace Input
