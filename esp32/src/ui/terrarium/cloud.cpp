#include "cloud.h"
#include "draw.h"
#include "renderer.h"
#include "../theme.h"
#include "../display.h"
#include "config.h"
#include "../../state/agent_state.h"
#include <Arduino.h>
#include <lvgl.h>
#include <cstring>
#include <cmath>

/**
 * Cloud creature — represents Codex CLI agent.
 *
 * Body is 6 overlapping filled circles forming a cumulus cloud shape.
 * Interior shows ">_" terminal prompt text.
 * Color: indigo/blue (#5561E0) with lighter highlights.
 *
 * States map to Y positions the same as octopus:
 *   SLEEPING  → floor (dimmed, flat)
 *   FLOATING  → standing position (gentle bob)
 *   WORKING   → near top (swimming, pulsing glow)
 *   ASKING    → mid position (speech bubble "?")
 */

// Minimum 1 to avoid zero-length arrays on boards with MAX_CLOUD=0
constexpr uint8_t CLOUD_ARR_SIZE = (MAX_CLOUD > 0) ? MAX_CLOUD : 1;

// Per-instance jitter (seeded by index)
static float jitterX[CLOUD_ARR_SIZE];
static float jitterY[CLOUD_ARR_SIZE];
static float phaseOffset[CLOUD_ARR_SIZE];

// Swimming state per instance
static float currentX[CLOUD_ARR_SIZE];
static float currentY[CLOUD_ARR_SIZE];
static CreatureState prevState[CLOUD_ARR_SIZE];

namespace Cloud {

void init() {
    for (int i = 0; i < MAX_CLOUD; i++) {
        jitterX[i] = ((i * 5 + 7) % 11 - 5) * 0.006f;
        jitterY[i] = ((i * 11 + 3) % 9 - 4) * 0.005f;
        phaseOffset[i] = i * 2.1f;
        currentX[i] = Layout::CloudHomeX;
        currentY[i] = Layout::CloudWorkingY;
        prevState[i] = CreatureState::SLEEPING;
    }
}

void render(uint16_t* buf, int w, int h, float time, float dt,
            CreatureState state, uint8_t idx, uint8_t total) {

    if (idx >= MAX_CLOUD) return;

    // Dynamic scale: shrink when many instances
    float scaleFactor = (total >= 4) ? 0.70f : (total >= 3) ? 0.85f : 1.0f;
    float baseRadius = w * Layout::CloudRadiusFrac * scaleFactor;

    // Calculate home position — wider spread for more creatures
    float homeX;
    if (total <= 1) {
        homeX = Layout::CloudHomeX;
    } else {
        float span = (total <= 2) ? 0.25f : 0.40f;
        homeX = Layout::CloudHomeX - span / 2 + span * idx / (total - 1);
    }
    homeX += jitterX[idx];

    float homeY;
    switch (state) {
        case CreatureState::SLEEPING:
            homeY = Layout::CloudSleepY;
            break;
        case CreatureState::WORKING:
            homeY = Layout::CloudWorkingY;
            break;
        case CreatureState::ASKING:
            homeY = Layout::CloudStandingY;
            break;
        default:
            homeY = Layout::CloudStandingY;
            break;
    }
    // X-correlated depth offset
    homeY += (homeX - 0.5f) * 0.10f + jitterY[idx];

    prevState[idx] = state;

    float renderX, renderY;

    if (state == CreatureState::WORKING) {
        // Sin-based swimming within bounds
        float swimPhase = time * 0.35f + phaseOffset[idx];
        float wanderX = fastSin(swimPhase) * 0.10f;
        float wanderY = fastCos(swimPhase * 0.65f) * 0.07f;
        renderX = homeX + wanderX;
        renderY = homeY + wanderY;
        if (renderX < Layout::CloudSwimMinX) renderX = Layout::CloudSwimMinX;
        if (renderX > Layout::CloudSwimMaxX) renderX = Layout::CloudSwimMaxX;
        if (renderY < Layout::CloudSwimMinY) renderY = Layout::CloudSwimMinY;
        if (renderY > Layout::CloudSwimMaxY) renderY = Layout::CloudSwimMaxY;
        currentX[idx] = renderX;
        currentY[idx] = renderY;
    } else {
        renderX = homeX;
        renderY = homeY;
        currentX[idx] = homeX;
        currentY[idx] = homeY;
    }

    float t = time + phaseOffset[idx];

    // Animation parameters
    float breathBob = 0;
    float bodyAlpha = 1.0f;
    uint32_t bodyColor = Theme::CloudBody;

    switch (state) {
        case CreatureState::SLEEPING:
            bodyAlpha = 0.4f;
            break;

        case CreatureState::FLOATING:
            breathBob = fastSin(t * 0.7f) * h * 0.003f;
            break;

        case CreatureState::WORKING: {
            breathBob = fastSin(t * 2 * M_PI / 4.5f) * h * 0.012f;
            // Processing pulse
            float pulse = fastSin(t * 2.5f) * 0.5f + 0.5f;
            bodyColor = lerpColor(Theme::CloudBody, Theme::CloudBodyLight, pulse);
            break;
        }

        case CreatureState::ASKING:
            breathBob = fastSin(t * 0.8f) * h * 0.002f;
            break;
    }

    int cx = (int)(renderX * w);
    int cy = (int)(renderY * h + breathBob);
    uint8_t alpha = (uint8_t)(255 * bodyAlpha);

    // Sleeping: flatten the cloud vertically
    float squashY = (state == CreatureState::SLEEPING) ? 0.5f : 1.0f;

    // === Cloud body: 6 overlapping circles forming cumulus shape ===
    // Layout relative to center (cx, cy):
    //   Top row:    2 smaller circles (upper bumps)
    //   Middle row: 2 large circles (main body mass)
    //   Bottom:     2 medium circles (base, slightly flattened overlap)
    struct CloudBlob {
        float ox;   // x offset multiplier (of baseRadius)
        float oy;   // y offset multiplier
        float r;    // radius multiplier
    };
    static const CloudBlob blobs[] = {
        { -0.50f, -0.55f, 0.60f },  // top-left bump
        {  0.40f, -0.65f, 0.55f },  // top-right bump
        { -0.70f,  0.00f, 0.75f },  // mid-left (large)
        {  0.65f,  0.05f, 0.70f },  // mid-right (large)
        { -0.25f,  0.10f, 0.80f },  // center-left (largest)
        {  0.20f,  0.15f, 0.78f },  // center-right
    };
    constexpr int BLOB_COUNT = 6;

    // Working state: outer glow
    if (state == CreatureState::WORKING) {
        float glow = fastSin(t * 2.0f) * 0.5f + 0.5f;
        int glowR = (int)(baseRadius * 1.8f + glow * baseRadius * 0.3f);
        Draw::circle(cx, cy, glowR, Theme::CloudBody, (uint8_t)(glow * 25));
    }

    // Draw cloud blobs
    for (int i = 0; i < BLOB_COUNT; i++) {
        int bx = cx + (int)(blobs[i].ox * baseRadius);
        int by = cy + (int)(blobs[i].oy * baseRadius * squashY);
        int br = (int)(blobs[i].r * baseRadius);

        // Slight individual wobble for organic feel
        float wobble = fastSin(t * 0.6f + i * 1.2f) * baseRadius * 0.03f;
        bx += (int)(wobble);
        by += (int)(wobble * 0.5f * squashY);

        // Upper blobs slightly lighter
        uint32_t blobColor = (blobs[i].oy < -0.3f)
            ? lerpColor(bodyColor, Theme::CloudBodyLight, 0.3f)
            : bodyColor;

        // Draw filled circle
        Draw::circle(bx, by, br, blobColor, alpha);
    }

    // Dark underside gradient (bottom blobs get a subtle shadow)
    {
        int shadowY = cy + (int)(baseRadius * 0.35f * squashY);
        int shadowR = (int)(baseRadius * 0.9f);
        Draw::circle(cx, shadowY, shadowR, Theme::CloudBodyDark, (uint8_t)(alpha * 0.25f));
    }

    // === ">_" prompt text inside the cloud ===
    // Simple pixel-art rendering of ">_" centered in cloud
    if (state != CreatureState::SLEEPING) {
        uint32_t textColor = Theme::CloudPrompt;
        uint8_t textAlpha = (uint8_t)(alpha * 0.85f);
        float pxScale = baseRadius / 20.0f;  // scale pixels to cloud size
        int pxW = (int)(2.0f * pxScale);     // pixel block width
        int pxH = (int)(2.0f * pxScale);     // pixel block height
        if (pxW < 1) pxW = 1;
        if (pxH < 1) pxH = 1;
        int gap = (int)(1.0f * pxScale);     // gap between pixels
        if (gap < 1) gap = 1;
        int step = pxW + gap;

        // ">" character: 3 rows x 2 cols
        //  Row 0: X .
        //  Row 1: . X
        //  Row 2: X .
        int promptStartX = cx - (int)(3.5f * step);
        int promptStartY = cy - (int)(1.0f * step);

        // ">" pixels
        auto drawBlock = [&](int gx, int gy) {
            int px = promptStartX + gx * step;
            int py = promptStartY + gy * step;
            for (int dy = 0; dy < pxH; dy++) {
                for (int dx = 0; dx < pxW; dx++) {
                    Draw::pixelA(px + dx, py + dy, textColor, textAlpha);
                }
            }
        };

        drawBlock(0, 0);  // > top-left
        drawBlock(1, 1);  // > middle-right
        drawBlock(0, 2);  // > bottom-left

        // "_" character: 1 row x 2 cols (underscore, offset right)
        int usStartX = promptStartX + 3 * step;
        // Blinking cursor for WORKING state
        bool showCursor = true;
        if (state == CreatureState::WORKING) {
            showCursor = fmodf(t, 1.0f) < 0.6f;  // blink
        }
        if (showCursor) {
            int usY = promptStartY + 2 * step;
            for (int col = 0; col < 2; col++) {
                int px = usStartX + col * step;
                for (int dy = 0; dy < pxH; dy++) {
                    for (int dx = 0; dx < pxW; dx++) {
                        Draw::pixelA(px + dx, usY + dy, textColor, textAlpha);
                    }
                }
            }
        }
    }

    // Speech bubble for ASKING state
    if (state == CreatureState::ASKING) {
        float bubblePulse = fastSin(t * 2.5f) * 0.08f + 1.0f;
        int bx = cx + (int)(baseRadius * 1.4f);
        int by = cy;
        int br = (int)(baseRadius * 0.5f * bubblePulse);

        Draw::circle(bx, by, br, 0xFFFFFF, 200);
        // "?" text
        int qx = bx - 2, qy = by - 3;
        Draw::pixelA(qx + 1, qy, Theme::DeepSea, 255);
        Draw::pixelA(qx + 2, qy, Theme::DeepSea, 255);
        Draw::pixelA(qx + 3, qy, Theme::DeepSea, 255);
        Draw::pixelA(qx + 3, qy + 1, Theme::DeepSea, 255);
        Draw::pixelA(qx + 2, qy + 2, Theme::DeepSea, 255);
        Draw::pixelA(qx + 2, qy + 4, Theme::DeepSea, 255);

        // Tail pointing back to cloud
        Draw::line(bx - br / 3, by + br / 2, cx + (int)(baseRadius * 0.6f),
                   cy, 0xFFFFFF, 160);
    }

    // Name tag (same pattern as octopus)
    lockState();
    char name[32] = "";
    if (idx < g_state.cloudCount && g_state.cloudNames[idx][0]) {
        strncpy(name, g_state.cloudNames[idx], sizeof(name) - 1);
    } else if (g_state.projectName[0]) {
        strncpy(name, g_state.projectName, sizeof(name) - 1);
    } else {
        strncpy(name, "", sizeof(name) - 1);
    }
    name[sizeof(name) - 1] = '\0';
    unlockState();

    // Name tag — LVGL text rendering on canvas
    lv_point_t txtSize;
    lv_text_get_size(&txtSize, name, &font_kr_12, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    int textW = txtSize.x + (total >= 3 ? 8 : 12);
    int tagH = 16;
    int tagX = cx - textW / 2;
    int tagY = cy - (int)(baseRadius * 1.1f) - tagH - 4;

    // Background pill
    for (int dy = 0; dy < tagH; dy++) {
        for (int dx = 0; dx < textW; dx++) {
            int cornerR = 4;
            bool inCorner = false;
            if (dy < cornerR && dx < cornerR) {
                int d2 = (cornerR - dx) * (cornerR - dx) + (cornerR - dy) * (cornerR - dy);
                inCorner = d2 > cornerR * cornerR;
            } else if (dy < cornerR && dx >= textW - cornerR) {
                int d2 = (dx - textW + cornerR + 1) * (dx - textW + cornerR + 1) + (cornerR - dy) * (cornerR - dy);
                inCorner = d2 > cornerR * cornerR;
            } else if (dy >= tagH - cornerR && dx < cornerR) {
                int d2 = (cornerR - dx) * (cornerR - dx) + (dy - tagH + cornerR + 1) * (dy - tagH + cornerR + 1);
                inCorner = d2 > cornerR * cornerR;
            } else if (dy >= tagH - cornerR && dx >= textW - cornerR) {
                int d2 = (dx - textW + cornerR + 1) * (dx - textW + cornerR + 1) + (dy - tagH + cornerR + 1) * (dy - tagH + cornerR + 1);
                inCorner = d2 > cornerR * cornerR;
            }
            if (!inCorner) {
                Draw::pixelA(tagX + dx, tagY + dy, Theme::CloudBodyDark, 180);
            }
        }
    }

    // Render text using LVGL canvas
    lv_obj_t* cvs = Terrarium::getCanvas();
    if (cvs) {
        lv_layer_t layer;
        lv_canvas_init_layer(cvs, &layer);

        lv_draw_label_dsc_t labelDsc;
        lv_draw_label_dsc_init(&labelDsc);
        labelDsc.color = lv_color_hex(Theme::HUDText);
        labelDsc.font = &font_kr_12;
        labelDsc.text = name;
        labelDsc.align = LV_TEXT_ALIGN_CENTER;

        lv_area_t labelArea;
        labelArea.x1 = tagX;
        labelArea.y1 = tagY + 1;
        labelArea.x2 = tagX + textW - 1;
        labelArea.y2 = tagY + tagH - 1;
        lv_draw_label(&layer, &labelDsc, &labelArea);

        lv_canvas_finish_layer(cvs, &layer);
    }
}

float getX(uint8_t idx) {
    if (idx >= MAX_CLOUD) return Layout::CloudHomeX;
    return currentX[idx];
}

float getY(uint8_t idx) {
    if (idx >= MAX_CLOUD) return Layout::CloudStandingY;
    return currentY[idx];
}

}  // namespace Cloud
