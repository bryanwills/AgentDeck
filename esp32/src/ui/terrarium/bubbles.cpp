#include "bubbles.h"
#include "octopus.h"
#include "draw.h"
#include "../theme.h"
#include "config.h"
#include <cstdlib>
#include <cmath>
#include <algorithm>
using std::min;
using std::max;

constexpr float RISE_SPEED = 0.06f;
constexpr float WOBBLE_SPEED = 2.5f;
constexpr float CALM_INTERVAL = 1.2f;    // More frequent ambient bubbles
constexpr float ACTIVE_INTERVAL = 0.25f;

struct Bubble {
    float x, y;
    float radius;
    float speed;
    float wobblePhase;
    float wobbleAmp;
    float alpha;
    bool active;
    bool popping;
    float popProgress;
};

static Bubble bubbles[MAX_BUBBLES];
static uint8_t head = 0;
static float spawnTimer = 0;
static float lastExhaleTime = 0;

static float randf() { return (float)rand() / RAND_MAX; }

static void spawnBubble(float x, float y, float radiusScale) {
    Bubble& b = bubbles[head];
    b.x = x;
    b.y = y;
    b.radius = randf() * 0.010f * radiusScale + 0.005f;  // Bigger: 2.5-7.5px on 480px
    b.speed = RISE_SPEED * (0.7f + randf() * 0.6f);
    b.wobblePhase = randf() * 2 * M_PI;
    b.wobbleAmp = randf() * 0.02f + 0.005f;
    b.alpha = 1.0f;
    b.active = true;
    b.popping = false;
    b.popProgress = 0;
    head = (head + 1) % MAX_BUBBLES;
}

namespace Bubbles {

void init() {
    for (int i = 0; i < MAX_BUBBLES; i++) {
        bubbles[i].active = false;
    }
}

void update(float dt, float time, CreatureState state, uint8_t octCount) {
    // Spawn interval based on state
    float interval;
    switch (state) {
        case CreatureState::WORKING:  interval = ACTIVE_INTERVAL; break;
        case CreatureState::ASKING:   interval = ACTIVE_INTERVAL * 1.5f; break;
        case CreatureState::SLEEPING: interval = 3.0f; break;  // Ambient bubbles
        default:                      interval = CALM_INTERVAL; break;
    }

    spawnTimer += dt;
    if (spawnTimer >= interval) {
        spawnTimer = 0;
        // Spawn from sand/terrain area (bottom 35%) — bubbles rise from the ground
        float x = randf() * 0.8f + 0.1f;
        float y = 0.65f + randf() * 0.10f;  // Just above sand line
        spawnBubble(x, y, 1.0f);
    }

    // Creature exhale bubbles (every ~2.5s when active) — from ALL octopuses
    if (state == CreatureState::WORKING || state == CreatureState::FLOATING) {
        if (time - lastExhaleTime > 2.5f) {
            lastExhaleTime = time;
            uint8_t count = (octCount > 0) ? octCount : 1;
            for (uint8_t i = 0; i < count; i++) {
                float octX = Octopus::getX(i);
                float octY = Octopus::getY(i);
                emitAt(octX, octY - 0.03f, 2);
            }
        }
    }

    // Update all bubbles
    for (int i = 0; i < MAX_BUBBLES; i++) {
        Bubble& b = bubbles[i];
        if (!b.active) continue;

        if (b.popping) {
            b.popProgress += dt * 2.5f;
            if (b.popProgress >= 1.0f) {
                // Pop complete → normal rising
                b.popping = false;
                b.speed *= 0.6f;
            } else {
                float ease = 1.0f - (1.0f - b.popProgress) * (1.0f - b.popProgress);
                b.x += fastCos(b.wobblePhase) * 0.04f * dt;
                b.y += fastSin(b.wobblePhase) * 0.04f * dt;
                b.radius *= (1.0f - b.popProgress * 0.3f * dt);
                b.alpha = 1.0f - b.popProgress * 0.4f;
            }
            continue;
        }

        b.y -= b.speed * dt;
        b.x += fastSin(time * WOBBLE_SPEED + b.wobblePhase) * b.wobbleAmp * dt;

        // Fade near top
        if (b.y < 0.1f) {
            b.alpha = b.y / 0.1f;
        }

        // Kill above screen
        if (b.y < -0.02f) {
            b.active = false;
        }
    }
}

void render(uint16_t* buf, int w, int h) {
    for (int i = 0; i < MAX_BUBBLES; i++) {
        Bubble& b = bubbles[i];
        if (!b.active) continue;

        int bx = (int)(b.x * w);
        int by = (int)(b.y * h);
        int br = max(2, (int)(b.radius * w));
        uint8_t alpha = (uint8_t)(b.alpha * 120);  // ~47% base — more visible

        // Body — outline ring for glass-like appearance
        Draw::circle(bx, by, br, Theme::BubbleWhite, (uint8_t)(alpha * 0.4f));
        // Outer rim
        for (int a = 0; a < 16; a++) {
            float angle = a * (2 * M_PI / 16);
            int rx = bx + (int)(fastCos(angle) * br);
            int ry = by + (int)(fastSin(angle) * br);
            Draw::pixelA(rx, ry, Theme::BubbleWhite, alpha);
        }

        // Highlight (upper-left)
        int hlx = bx - br / 3;
        int hly = by - br / 3;
        int hlr = max(1, br / 3);
        Draw::circle(hlx, hly, hlr, Theme::BubbleWhite, (uint8_t)(b.alpha * 180));
    }
}

void emitAt(float nx, float ny, int count) {
    for (int i = 0; i < count; i++) {
        float x = nx + (randf() - 0.5f) * 0.04f;
        float y = ny + (randf() - 0.5f) * 0.02f;
        spawnBubble(x, y, 0.5f);
        bubbles[(head - 1 + MAX_BUBBLES) % MAX_BUBBLES].speed *= 0.7f;
    }
}

void emitPopBurst(float nx, float ny) {
    int count = min(10, (int)MAX_BUBBLES);
    float angleStep = 2 * M_PI / count;
    for (int i = 0; i < count; i++) {
        float angle = i * angleStep;
        spawnBubble(nx, ny, 0.7f);
        Bubble& b = bubbles[(head - 1 + MAX_BUBBLES) % MAX_BUBBLES];
        b.wobblePhase = angle;
        b.popping = true;
        b.popProgress = 0;
    }
}

}  // namespace Bubbles
