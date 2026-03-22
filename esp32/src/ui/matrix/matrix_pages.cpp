#ifdef BOARD_ULANZI_TC001
#include "matrix_pages.h"
#include "matrix_font.h"
#include "config.h"
#include "state/agent_state.h"
#include "../../../boards/board_config.h"
#include "net/wifi_manager.h"
#include <WiFi.h>
#include <cmath>

extern DashboardState g_state;

// ===== Helpers =====

static inline int xyToIdx(int x, int y) {
    if (x < 0 || x >= MATRIX_W || y < 0 || y >= MATRIX_H) return -1;
    return (y % 2 == 0) ? (y * MATRIX_W + x) : (y * MATRIX_W + (MATRIX_W - 1 - x));
}

static inline void setPixel(CRGB* leds, int x, int y, CRGB color) {
    int idx = xyToIdx(x, y);
    if (idx >= 0) leds[idx] = color;
}

// Battery-style gauge (no label, wider)
static void drawBatteryGauge(CRGB* leds, int x0, int y0, int w, int h, float percent) {
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    float remaining = 100.0f - percent;

    CRGB border = CRGB(60, 60, 60);
    // Outline
    for (int x = x0; x < x0 + w; x++) {
        setPixel(leds, x, y0, border);
        setPixel(leds, x, y0 + h - 1, border);
    }
    for (int y = y0; y < y0 + h; y++) {
        setPixel(leds, x0, y, border);
        setPixel(leds, x0 + w - 1, y, border);
    }
    // Battery nub
    for (int y = y0 + 1; y < y0 + h - 1; y++) {
        setPixel(leds, x0 + w, y, CRGB(40, 40, 40));
    }

    // Fill (remaining = filled, used = empty)
    int innerW = w - 2;
    int fillPx = (int)(remaining / 100.0f * innerW);

    CRGB fillColor;
    if (remaining > 40)      fillColor = CRGB(0, 180, 0);
    else if (remaining > 20) fillColor = CRGB(180, 150, 0);
    else                     fillColor = CRGB(200, 0, 0);

    for (int x = 0; x < innerW; x++) {
        CRGB c = (x < fillPx) ? fillColor : CRGB(12, 12, 12);
        for (int y = y0 + 1; y < y0 + h - 1; y++) {
            setPixel(leds, x0 + 1 + x, y, c);
        }
    }
}

// Parse reset time string into total minutes
// "1h 23m" → 83, "2d 4h" → 3120, "45m" → 45
static int parseResetMinutes(const char* reset) {
    int total = 0;
    int num = 0;
    for (int i = 0; reset[i]; i++) {
        char c = reset[i];
        if (c >= '0' && c <= '9') {
            num = num * 10 + (c - '0');
        } else if (c == 'd' || c == 'D') {
            total += num * 24 * 60;
            num = 0;
        } else if (c == 'h' || c == 'H') {
            total += num * 60;
            num = 0;
        } else if (c == 'm' || c == 'M') {
            total += num;
            num = 0;
        }
    }
    return total + num;  // trailing number without unit = minutes
}

// Draw sprite
static void drawSprite(CRGB* leds, int x0, int y0, const uint8_t* sprite,
                       int w, int h, CRGB color) {
    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            if (sprite[row] & (1 << (w - 1 - col))) {
                setPixel(leds, x0 + col, y0 + row, color);
            }
        }
    }
}

// ===== Sprites (5x6) =====
static const uint8_t SPR_OCTOPUS[6] = {
    0b01110, 0b11111, 0b10101, 0b11111, 0b01010, 0b10101
};
static const uint8_t SPR_CRAYFISH[6] = {
    0b10001, 0b01110, 0b11111, 0b01110, 0b00100, 0b01010
};

// Format reset time like Pixoo: "1h 23m" → "1H23", "2d 4h" → "2D4"
static int formatResetCompact(const char* reset, char* out, int maxLen) {
    int ri = 0;
    for (int i = 0; reset[i] && ri < maxLen - 1; i++) {
        char c = reset[i];
        if (c >= '0' && c <= '9') out[ri++] = c;
        else if (c == 'h' || c == 'H') out[ri++] = 'H';
        else if (c == 'd' || c == 'D') out[ri++] = 'D';
        else if (c == 'm' && (reset[i+1] == 0 || reset[i+1] == ' ')) out[ri++] = 'M';
        // skip spaces
    }
    out[ri] = '\0';
    return ri;
}

// Full-screen usage gauge: background fill + overlaid text
// Layout: entire 32x8 screen
//   Rows 0-7: usage color fill from left (proportional to percent used)
//   Row 1: "72%" left-aligned (dark on bright fill, bright on dark empty)
//   Row 1: "1H23" right-aligned (dimmed time color)
//   Row 6: "5H" label left (dim)
static void drawFullScreenGauge(CRGB* leds, float percent, const char* label,
                                 const char* resetStr, int slideX) {
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;

    // Usage fill color (based on how much used — NOT remaining)
    CRGB fillColor;
    if (percent < 50)       fillColor = CRGB(0, 0, 100);     // Blue: safe
    else if (percent < 70)  fillColor = CRGB(0, 140, 130);   // Teal
    else if (percent < 90)  fillColor = CRGB(160, 120, 0);   // Amber: caution
    else                    fillColor = CRGB(180, 0, 0);      // Red: critical

    CRGB emptyColor = CRGB(12, 12, 12);
    int fillW = (int)(percent / 100.0f * MATRIX_W);

    // Fill entire screen
    for (int x = 0; x < MATRIX_W; x++) {
        int sx = x + slideX;
        if (sx < 0 || sx >= MATRIX_W) continue;
        CRGB c = (x < fillW) ? fillColor : emptyColor;
        for (int y = 0; y < MATRIX_H; y++) {
            setPixel(leds, sx, y, c);
        }
    }

    // Percentage text (row 1, left)
    char pctBuf[5];
    snprintf(pctBuf, sizeof(pctBuf), "%d%%", (int)percent);
    // Dark text on bright fill, bright text on dark empty
    CRGB pctColor = (fillW > 12) ? CRGB(0, 0, 0) : CRGB(200, 200, 200);
    MatrixFont::drawScrollText(leds, pctBuf, 1 + slideX, 1, pctColor, MATRIX_W, MATRIX_H);

    // Reset time (row 1, right-aligned, dimmed)
    char timeBuf[8];
    if (formatResetCompact(resetStr, timeBuf, sizeof(timeBuf)) > 0) {
        int tw = MatrixFont::textWidth(timeBuf);
        CRGB timeColor = CRGB(100, 120, 140);  // dimmed blue-gray
        MatrixFont::drawScrollText(leds, timeBuf, MATRIX_W - tw - 1 + slideX, 1, timeColor, MATRIX_W, MATRIX_H);
    }

    // Label (row 6, left, dim)
    for (int i = 0; label[i]; i++) {
        MatrixFont::drawChar(leds, i * 4 + 1 + slideX, 6, label[i], CRGB(80, 80, 80), MATRIX_W, MATRIX_H);
    }
}

// ================================================================
// PAGE 1: USAGE — Full-screen 5H/7D with slide transition
// ================================================================
void MatrixPages::renderUsage(CRGB* leds, float animTime) {
    lockState();
    float pct5h = g_state.fiveHourPercent;
    float pct7d = g_state.sevenDayPercent;
    char reset5h[20], reset7d[20];
    strncpy(reset5h, g_state.fiveHourReset, sizeof(reset5h) - 1);
    reset5h[sizeof(reset5h) - 1] = '\0';
    strncpy(reset7d, g_state.sevenDayReset, sizeof(reset7d) - 1);
    reset7d[sizeof(reset7d) - 1] = '\0';
    unlockState();

    bool noData = (pct5h < 0);
    if (noData) {
        // No data: dim "---" centered
        MatrixFont::drawScrollText(leds, "---", 10, 2, CRGB(40, 40, 40), MATRIX_W, MATRIX_H);
        return;
    }

    // Cycle: 4s show 5H → 0.5s slide → 4s show 7D → 0.5s slide back
    float cycle = 9.0f;  // total cycle
    float phase = fmodf(animTime, cycle);

    if (phase < 4.0f) {
        drawFullScreenGauge(leds, pct5h, "5H", reset5h, 0);
    } else if (phase < 4.5f) {
        float t = (phase - 4.0f) / 0.5f;
        int offset = (int)(t * MATRIX_W);
        drawFullScreenGauge(leds, pct5h, "5H", reset5h, -offset);
        drawFullScreenGauge(leds, pct7d, "7D", reset7d, MATRIX_W - offset);
    } else if (phase < 8.5f) {
        drawFullScreenGauge(leds, pct7d, "7D", reset7d, 0);
    } else {
        float t = (phase - 8.5f) / 0.5f;
        int offset = (int)(t * MATRIX_W);
        drawFullScreenGauge(leds, pct7d, "7D", reset7d, -offset);
        drawFullScreenGauge(leds, pct5h, "5H", reset5h, MATRIX_W - offset);
    }
}

// ================================================================
// PAGE 2: AGENTS — Crayfish fixed right + octopus scroll
// ================================================================
void MatrixPages::renderAgents(CRGB* leds, float animTime) {
    lockState();
    uint8_t sessionCount = g_state.sessionCount;
    bool gatewayAvail = g_state.gatewayAvailable;
    bool gatewayError = g_state.gatewayHasError;
    CrayfishState cfState = g_state.crayfishState;

    // Collect octopus sessions
    struct OctoInfo { char state[20]; };
    OctoInfo octos[6];
    int octoCount = 0;

    for (int i = 0; i < sessionCount && octoCount < 6; i++) {
        if (!g_state.sessions[i].alive) continue;
        if (strcmp(g_state.sessions[i].agentType, "openclaw") == 0) continue;
        if (strcmp(g_state.sessions[i].agentType, "daemon") == 0) continue;
        strncpy(octos[octoCount].state, g_state.sessions[i].state, 19);
        octos[octoCount].state[19] = '\0';
        octoCount++;
    }
    unlockState();

    // === Crayfish: fixed at right (x=27, y=1) ===
    if (gatewayAvail) {
        CRGB cfColor;
        if (gatewayError) {
            cfColor = CRGB(40, 40, 40);  // SICK: gray
        } else if (cfState == CrayfishState::ROUTING) {
            cfColor = CRGB(200, 30, 30);  // Bright red
        } else if (cfState == CrayfishState::SITTING) {
            // Dark red pulse
            uint8_t r = 50 + (uint8_t)(30.0f * (0.5f + 0.5f * sinf(animTime * 1.5f)));
            cfColor = CRGB(r, 5, 5);
        } else {
            cfColor = CRGB(25, 5, 5);  // DORMANT: very dim red
        }
        drawSprite(leds, 27, 1, SPR_CRAYFISH, 5, 6, cfColor);
    }

    // === Octopuses: left area (x 0 to cfX-2) ===
    int cfX = gatewayAvail ? 27 : 32;  // crayfish position (or off-screen)
    int octoMaxX = cfX - 7;            // rightmost octopus start (5px sprite + 2px gap)

    if (octoCount == 0) {
        int bobY = 1 + (int)(0.3f * sinf(animTime * 1.0f));
        drawSprite(leds, 8, bobY, SPR_OCTOPUS, 5, 6, CRGB(30, 18, 14));
        return;
    }

    auto octoColor = [&](const char* state) -> CRGB {
        if (strcmp(state, "idle") == 0)
            return CRGB(0, 0, 120);
        if (strcmp(state, "processing") == 0) {
            bool on = fmodf(animTime, 0.5f) < 0.25f;
            return on ? CRGB(0, 180, 0) : CRGB(0, 40, 0);
        }
        if (strstr(state, "awaiting")) {
            bool on = fmodf(animTime, 1.0f) < 0.5f;
            return on ? CRGB(200, 120, 0) : CRGB(40, 24, 0);
        }
        return CRGB(30, 30, 30);
    };

    int visibleSlots = 3;
    int spacing = 7;  // 5px sprite + 2px gap

    if (octoCount <= visibleSlots) {
        // 1-3: fixed positions starting from x=1
        for (int i = 0; i < octoCount; i++) {
            int x = 1 + i * spacing;
            int bobY = 1 + (int)(0.3f * sinf(animTime * 2.0f + i * 1.5f));
            drawSprite(leds, x, bobY, SPR_OCTOPUS, 5, 6, octoColor(octos[i].state));
        }
    } else {
        // 4+: show 3, pause 2s, scroll left to reveal more
        float scrollDur = (octoCount - visibleSlots) * 2.0f;
        float cycleTime = 2.0f + scrollDur + 2.0f;  // pause + scroll + pause
        float phase = fmodf(animTime, cycleTime);

        int scrollOffset = 0;
        if (phase > 2.0f && phase < 2.0f + scrollDur) {
            float t = (phase - 2.0f) / scrollDur;
            int maxScroll = (octoCount - visibleSlots) * spacing;
            scrollOffset = (int)(t * maxScroll);
        } else if (phase >= 2.0f + scrollDur) {
            scrollOffset = (octoCount - visibleSlots) * spacing;
        }

        for (int i = 0; i < octoCount; i++) {
            int x = 1 + i * spacing - scrollOffset;
            if (x > octoMaxX || x < -5) continue;
            int bobY = 1 + (int)(0.3f * sinf(animTime * 2.0f + i * 1.2f));
            drawSprite(leds, x, bobY, SPR_OCTOPUS, 5, 6, octoColor(octos[i].state));
        }
    }
}

// ================================================================
// PAGE 3: INFO — Project + Model single-line scroll
// ================================================================
void MatrixPages::renderInfo(CRGB* leds, float animTime) {
    lockState();
    char model[32], project[40];
    strncpy(model, g_state.modelName[0] ? g_state.modelName : "---", sizeof(model) - 1);
    model[sizeof(model) - 1] = '\0';
    strncpy(project, g_state.projectName[0] ? g_state.projectName : "---", sizeof(project) - 1);
    project[sizeof(project) - 1] = '\0';
    unlockState();

    for (char* p = model; *p; p++) *p = toupper(*p);
    for (char* p = project; *p; p++) *p = toupper(*p);

    // Build combined string: "PROJECT . MODEL"
    // We render each part in its own color, so we need to draw them separately
    // but calculate positions as if they're one continuous string

    int projLen = strlen(project);
    int modelLen = strlen(model);
    // Total width: project + " . " (3 chars = 12px) + model
    int sepW = 12;  // " . " = 3 chars × 4px
    int totalW = projLen * 4 + sepW + modelLen * 4;
    if (totalW > 0) totalW -= 1;  // no trailing gap

    int y = 2;  // vertically centered (rows 2-6)

    if (totalW <= MATRIX_W) {
        // Fits on screen — center it
        int startX = (MATRIX_W - totalW) / 2;
        MatrixFont::drawScrollText(leds, project, startX, y, CRGB(0, 220, 100), MATRIX_W, MATRIX_H);
        // Separator dot
        int sepX = startX + projLen * 4 + 4;
        MatrixFont::drawChar(leds, sepX, y, '.', CRGB(80, 80, 80), MATRIX_W, MATRIX_H);
        // Model
        int modelX = startX + projLen * 4 + sepW;
        MatrixFont::drawScrollText(leds, model, modelX, y, CRGB(0, 220, 255), MATRIX_W, MATRIX_H);
    } else {
        // Scroll
        int cycle = totalW + MATRIX_W + 16;  // gap before repeat
        int scrollPx = ((int)(animTime * 1000) / (int)SCROLL_SPEED_MS) % cycle;
        int baseX = MATRIX_W - scrollPx;

        // Project (green)
        MatrixFont::drawScrollText(leds, project, baseX, y, CRGB(0, 220, 100), MATRIX_W, MATRIX_H);
        // Separator
        int sepX = baseX + projLen * 4 + 4;
        MatrixFont::drawChar(leds, sepX, y, '.', CRGB(80, 80, 80), MATRIX_W, MATRIX_H);
        // Model (cyan)
        int modelX = baseX + projLen * 4 + sepW;
        MatrixFont::drawScrollText(leds, model, modelX, y, CRGB(0, 220, 255), MATRIX_W, MATRIX_H);
    }
}
#endif // BOARD_ULANZI_TC001
