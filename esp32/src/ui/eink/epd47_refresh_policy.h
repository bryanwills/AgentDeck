#pragma once

#include <stdint.h>

// EPD47 keeps the previous 4-bit frame in PSRAM so every admitted content
// change can erase the ink it replaces. This data-only policy separates those
// quiet differential erases from the periodic hard waveform that resets the
// pigment. Keeping the bookkeeping here lets host tests execute the exact rule
// used by the firmware without allocating or depending on the panel driver.
namespace AgentDeckEpd47 {

enum class Erase : uint8_t {
    Differential = 0,  // erase the retained previous frame, then draw the next
    ClearAll,          // hard anti-ghost sweep of the complete panel
};

struct RefreshState {
    uint8_t differentialCount = 0;
    uint32_t lastHardClearMs = 0;
};

inline bool isHardClear(Erase erase) {
    return erase == Erase::ClearAll;
}

inline bool hardClearDue(const RefreshState& state, bool firstDraw,
                         uint32_t nowMs, uint8_t everyNDifferentials,
                         uint32_t maxAgeMs) {
    return firstDraw || state.differentialCount >= everyNDifferentials ||
           (uint32_t)(nowMs - state.lastHardClearMs) > maxAgeMs;
}

inline Erase chooseErase(bool hardClear) {
    return hardClear ? Erase::ClearAll : Erase::Differential;
}

inline void recordErase(RefreshState& state, Erase erase, uint32_t nowMs) {
    if (isHardClear(erase)) {
        state.differentialCount = 0;
        state.lastHardClearMs = nowMs;
    } else if (state.differentialCount != UINT8_MAX) {
        ++state.differentialCount;
    }
}

}  // namespace AgentDeckEpd47
