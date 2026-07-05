#pragma once
// Shared, board-agnostic formatters for usage/subscription chips.
// Header-only + C++11-safe so both the LVGL boards (hud_bar.cpp) and the e-ink
// board (eink_display.cpp) can reuse them without an extra translation unit.

#include <cstddef>
#include <cstdio>
#include <cstring>

namespace UsageFormat {

// Antigravity plan name → compact "AGY <tier>" chip.
//   "Google AI Pro"   -> "AGY Pro"
//   "Google AI Ultra" -> "AGY Ultra"
//   ""/null           -> "AGY"
// The raw availableCredits count is deliberately never surfaced anywhere — it's
// backend metering with no glanceable meaning. Mirrors the TS/Kotlin shorteners
// (shared/src/format-utils.ts formatAntigravityPlanShort, Android
// EinkMonitorScreen.buildAntigravityLimitValue). Idempotent: an already-"AGY …"
// string is passed through unchanged.
inline void formatAgyPlan(const char* planName, char* out, size_t outLen) {
    if (!out || outLen == 0) return;
    const char* tail = planName ? planName : "";
    if (strncmp(tail, "AGY ", 4) == 0 || strcmp(tail, "AGY") == 0) {
        strncpy(out, tail, outLen - 1);
        out[outLen - 1] = '\0';
        return;
    }
    if (strncmp(tail, "Google AI", 9) == 0) tail += 9;
    else if (strncmp(tail, "Antigravity", 11) == 0) tail += 11;
    while (*tail == ' ') tail++;
    if (*tail) snprintf(out, outLen, "AGY %s", tail);
    else       snprintf(out, outLen, "AGY");
}

// True when a subscription entry's name is really the Antigravity plan (the
// daemon stores it as the raw plan name, e.g. "Google AI Pro", not a literal
// "Antigravity …" string).
inline bool isAntigravityPlanName(const char* name) {
    if (!name) return false;
    return strncmp(name, "Google AI ", 10) == 0
        || strncmp(name, "Antigravity", 11) == 0
        || strncmp(name, "AGY", 3) == 0;
}

// ISO-8601 (or already-short "~M/D") expiry → compact "~M/D" for clock-less
// panels. Handles the WiFi transport where the daemon sends a raw ISO `until`
// (the serial path pre-formats it). Writes "" when absent/unparseable.
inline void formatShortExpiry(const char* iso, char* out, size_t outLen) {
    if (!out || outLen == 0) return;
    out[0] = '\0';
    if (!iso || !iso[0]) return;
    // Already short (no ISO 'T'/'-' date shape) — pass through.
    if (strchr(iso, 'T') == nullptr && strncmp(iso, "~", 1) == 0) {
        strncpy(out, iso, outLen - 1);
        out[outLen - 1] = '\0';
        return;
    }
    int y = 0, mo = 0, d = 0;
    if (sscanf(iso, "%d-%d-%d", &y, &mo, &d) >= 3 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        snprintf(out, outLen, "~%d/%d", mo, d);
    } else {
        // Unknown shape — copy verbatim (bounded) rather than dropping the info.
        strncpy(out, iso, outLen - 1);
        out[outLen - 1] = '\0';
    }
}

}  // namespace UsageFormat
