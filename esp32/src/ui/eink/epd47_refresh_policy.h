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

// A touch interaction runs on quiet differential erases by design — flashing
// mid-interaction is what the retained frame exists to prevent — but each
// grayscale differential leaves a little pigment behind, so a tap session ends
// with a visibly foggy panel until the scheduled sweep. Once the user has
// stopped touching for `quietMs`, one hard sweep restores a crisp panel at the
// moment its flash costs the least attention.
inline bool postInteractionSweepDue(uint32_t lastInteractionMs, uint8_t differentialCount,
                                    uint32_t nowMs, uint32_t quietMs) {
    return lastInteractionMs != 0 && differentialCount > 0 &&
           (uint32_t)(nowMs - lastInteractionMs) > quietMs;
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
