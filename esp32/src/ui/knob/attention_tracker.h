#pragma once

#include <stdint.h>
#include <string.h>

namespace KnobAttention {

// The daemon sends at most ten sessions to firmware. Keep one fixed-size latch
// per possible session: 10 * (32-byte id + 4-byte timestamp) = 360 bytes, held
// for the UI lifetime with no render-loop allocation.
static constexpr uint8_t MAX_TRACKED = 10;
static constexpr uint8_t SESSION_ID_BYTES = 32;

struct Entry {
    char id[SESSION_ID_BYTES];
    uint32_t lastSeenMs;
};

class Tracker {
public:
    // Returns true exactly when this session enters awaiting after it was
    // explicitly observed non-awaiting. A missing/empty roster does NOT clear
    // the latch: USB/WiFi reconnects must not turn one unresolved question into
    // a fresh pager alert. If all slots are occupied by vanished sessions, the
    // least-recently-seen slot is reclaimed.
    bool observe(const char* id, const char* state, uint32_t nowMs) {
        if (!id || !id[0]) return false;
        const bool awaiting = state && strstr(state, "awaiting") != nullptr;

        int found = -1;
        int empty = -1;
        int oldest = 0;
        uint32_t oldestAge = 0;
        for (uint8_t i = 0; i < MAX_TRACKED; i++) {
            if (!entries_[i].id[0]) {
                if (empty < 0) empty = i;
                continue;
            }
            if (strcmp(entries_[i].id, id) == 0) {
                found = i;
                break;
            }
            const uint32_t age = nowMs - entries_[i].lastSeenMs;
            if (age >= oldestAge) {
                oldestAge = age;
                oldest = i;
            }
        }

        if (found >= 0) {
            entries_[found].lastSeenMs = nowMs;
            if (!awaiting) {
                entries_[found].id[0] = '\0';
                entries_[found].lastSeenMs = 0;
            }
            return false;
        }
        if (!awaiting) return false;

        const int slot = empty >= 0 ? empty : oldest;
        strncpy(entries_[slot].id, id, SESSION_ID_BYTES - 1);
        entries_[slot].id[SESSION_ID_BYTES - 1] = '\0';
        entries_[slot].lastSeenMs = nowMs;
        return true;
    }

private:
    Entry entries_[MAX_TRACKED] = {};
};

}  // namespace KnobAttention
