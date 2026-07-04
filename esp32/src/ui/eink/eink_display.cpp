#ifdef BOARD_INKDECK

#include "eink_display.h"

#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSans9pt7b.h>

#include "config.h"
#include "../boards/board_config.h"
#include "state/agent_state.h"
#include "net/wifi_manager.h"
#include "net/serial_client.h"
#include "net/ws_client.h"
#include "ui/terrarium/creature_glyphs_generated.h"

namespace {

// Pin map lives in boards/board_inkdeck.h (Seeed OG DIY Kit)
constexpr int8_t PIN_EPD_SCK  = BOARD_PIN_EPD_SCK;
constexpr int8_t PIN_EPD_MOSI = BOARD_PIN_EPD_MOSI;
constexpr int8_t PIN_EPD_CS   = BOARD_PIN_EPD_CS;
constexpr int8_t PIN_EPD_DC   = BOARD_PIN_EPD_DC;
constexpr int8_t PIN_EPD_RST  = BOARD_PIN_EPD_RST;
constexpr int8_t PIN_EPD_BUSY = BOARD_PIN_EPD_BUSY;
constexpr uint8_t PIN_KEY1    = BOARD_PIN_KEY1;   // force full refresh
constexpr uint8_t PIN_KEY2    = BOARD_PIN_KEY2;   // force full refresh (paging later)

// ===== Refresh policy =====
// Partial refresh is ~0.3s on the UC8179 but ghosting accumulates; the vendor
// recommends a flashing full refresh every ~5-8 partials (stock TRMNL firmware
// uses 8). Content-hash gating means these intervals only apply on real change.
constexpr uint32_t MIN_REFRESH_INTERVAL_MS = 3000;
constexpr uint8_t  FULL_EVERY_N_PARTIALS   = 8;
constexpr uint32_t FULL_MAX_AGE_MS         = 30UL * 60UL * 1000UL;

using Panel = GxEPD2_750_GDEY075T7;
GxEPD2_BW<Panel, Panel::HEIGHT> display(Panel(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

// ===== Render snapshot (copied out of g_state under the mutex so the slow
// e-ink refresh never holds the lock) =====
constexpr uint8_t MAX_ROWS = 6;

struct RowSnap {
    char name[40];
    char agentType[16];
    char state[20];
    char tool[40];
    char model[32];
    char question[96];
    uint32_t elapsedSec;
    bool alive;
};

struct Snap {
    bool bridgeConnected;
    bool wifiUp;
    bool serialUp;
    uint8_t rowCount;
    uint8_t totalSessions;
    RowSnap rows[MAX_ROWS];
    float fiveH, sevenD;
    char fiveReset[20], sevenReset[20];
    bool usageStale;
    float codexP, codexS;
    char codexPReset[20], codexSReset[20];
    bool displayOn;
    char ip[16];
};

void snapshot(Snap& s) {
    memset(&s, 0, sizeof(s));
    s.wifiUp = Net::wifiConnected();
    s.serialUp = Net::serialConnected();
    lockState();
    s.bridgeConnected = g_state.wsConnected;
    s.displayOn = g_state.hostDisplayOn;
    s.totalSessions = g_state.sessionCount;
    s.rowCount = g_state.sessionCount < MAX_ROWS ? g_state.sessionCount : MAX_ROWS;
    for (uint8_t i = 0; i < s.rowCount; i++) {
        const SessionInfo& src = g_state.sessions[i];
        RowSnap& dst = s.rows[i];
        strncpy(dst.name, src.projectName, sizeof(dst.name) - 1);
        strncpy(dst.agentType, src.agentType, sizeof(dst.agentType) - 1);
        strncpy(dst.state, src.state, sizeof(dst.state) - 1);
        strncpy(dst.tool, src.currentTool, sizeof(dst.tool) - 1);
        strncpy(dst.model, src.modelName, sizeof(dst.model) - 1);
        strncpy(dst.question, src.question, sizeof(dst.question) - 1);
        dst.elapsedSec = src.elapsedSec;
        dst.alive = src.alive;
    }
    s.fiveH = g_state.fiveHourPercent;
    s.sevenD = g_state.sevenDayPercent;
    strncpy(s.fiveReset, g_state.fiveHourReset, sizeof(s.fiveReset) - 1);
    strncpy(s.sevenReset, g_state.sevenDayReset, sizeof(s.sevenReset) - 1);
    s.usageStale = g_state.usageStale;
    s.codexP = g_state.codexPrimaryPercent;
    s.codexS = g_state.codexSecondaryPercent;
    strncpy(s.codexPReset, g_state.codexPrimaryReset, sizeof(s.codexPReset) - 1);
    strncpy(s.codexSReset, g_state.codexSecondaryReset, sizeof(s.codexSReset) - 1);
    unlockState();
    strncpy(s.ip, Net::wifiLocalIP(), sizeof(s.ip) - 1);
}

// FNV-1a over the fields that affect pixels. elapsedSec is bucketed to minutes
// so a ticking counter doesn't force a refresh every poll.
uint32_t fnv(uint32_t h, const void* data, size_t len) {
    const uint8_t* p = (const uint8_t*)data;
    for (size_t i = 0; i < len; i++) { h ^= p[i]; h *= 16777619u; }
    return h;
}
uint32_t fnvStr(uint32_t h, const char* s) { return fnv(h, s, strlen(s) + 1); }

uint32_t contentHash(const Snap& s) {
    uint32_t h = 2166136261u;
    h = fnv(h, &s.bridgeConnected, 1);
    h = fnv(h, &s.wifiUp, 1);
    h = fnv(h, &s.rowCount, 1);
    h = fnv(h, &s.totalSessions, 1);
    for (uint8_t i = 0; i < s.rowCount; i++) {
        const RowSnap& r = s.rows[i];
        h = fnvStr(h, r.name); h = fnvStr(h, r.agentType); h = fnvStr(h, r.state);
        h = fnvStr(h, r.tool); h = fnvStr(h, r.model); h = fnvStr(h, r.question);
        uint32_t mins = r.elapsedSec / 60; h = fnv(h, &mins, sizeof(mins));
        h = fnv(h, &r.alive, 1);
    }
    int fh = (int)s.fiveH, sd = (int)s.sevenD, cp = (int)s.codexP, cs = (int)s.codexS;
    h = fnv(h, &fh, sizeof(fh)); h = fnv(h, &sd, sizeof(sd));
    h = fnv(h, &cp, sizeof(cp)); h = fnv(h, &cs, sizeof(cs));
    h = fnvStr(h, s.fiveReset); h = fnvStr(h, s.sevenReset);
    h = fnv(h, &s.usageStale, 1);
    h = fnvStr(h, s.ip);
    return h;
}

// ===== Draw helpers =====

// GFX FreeFonts are Latin-1; drop anything outside printable ASCII so multibyte
// project names degrade to a clean marker instead of tofu garbage.
void ascii(char* out, size_t outLen, const char* in) {
    size_t o = 0;
    bool lastSub = false;
    for (size_t i = 0; in[i] && o < outLen - 1; i++) {
        uint8_t c = (uint8_t)in[i];
        if (c >= 32 && c < 127) { out[o++] = (char)c; lastSub = false; }
        else if (!lastSub) { out[o++] = '#'; lastSub = true; }  // one '#' per non-ASCII run
    }
    out[o] = '\0';
}

void textAt(int16_t x, int16_t y, const char* s, const GFXfont* f) {
    display.setFont(f);
    display.setCursor(x, y);
    display.print(s);
}

int16_t textWidth(const char* s, const GFXfont* f) {
    int16_t x1, y1; uint16_t w, h;
    display.setFont(f);
    display.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
    return (int16_t)w;
}

void textRight(int16_t xRight, int16_t y, const char* s, const GFXfont* f) {
    textAt(xRight - textWidth(s, f), y, s, f);
}

// Threshold-scale a 64×64 A8 creature mask into a black silhouette.
void drawMask(int16_t x, int16_t y, const uint8_t* a8, int size) {
    for (int oy = 0; oy < size; oy++) {
        int sy = oy * 64 / size;
        const uint8_t* row = a8 + sy * 64;
        for (int ox = 0; ox < size; ox++) {
            if (row[ox * 64 / size] >= 128) display.drawPixel(x + ox, y + oy, GxEPD_BLACK);
        }
    }
}

const uint8_t* glyphFor(const char* agentType) {
    if (strcmp(agentType, "openclaw") == 0)    return CreatureGlyphs::CRAYFISH_BODY_A8;
    if (strncmp(agentType, "codex", 5) == 0)   return CreatureGlyphs::CODEX_A8;
    if (strcmp(agentType, "opencode") == 0)    return CreatureGlyphs::OPENCODE_A8;
    if (strcmp(agentType, "antigravity") == 0) return CreatureGlyphs::ANTIGRAVITY_A8;
    return CreatureGlyphs::OCTOPUS_A8;  // claude-code + default
}

bool isAwaiting(const char* state) { return strncmp(state, "awaiting", 8) == 0; }

void stateLabel(const char* state, char* out, size_t outLen) {
    if (strcmp(state, "processing") == 0) strncpy(out, "PROCESSING", outLen - 1);
    else if (strcmp(state, "awaiting_permission") == 0) strncpy(out, "PERMISSION?", outLen - 1);
    else if (strcmp(state, "awaiting_option") == 0) strncpy(out, "CHOOSE?", outLen - 1);
    else if (strcmp(state, "awaiting_diff") == 0) strncpy(out, "REVIEW?", outLen - 1);
    else if (strcmp(state, "idle") == 0) strncpy(out, "IDLE", outLen - 1);
    else strncpy(out, "OFFLINE", outLen - 1);
    out[outLen - 1] = '\0';
}

void drawGauge(int16_t x, int16_t y, int16_t w, int16_t h, const char* label,
               float pct, const char* reset) {
    textAt(x, y + h - 4, label, &FreeSansBold12pt7b);
    int16_t barX = x + 44, barW = w - 44;
    display.drawRect(barX, y, barW, h, GxEPD_BLACK);
    display.drawRect(barX + 1, y + 1, barW - 2, h - 2, GxEPD_BLACK);
    char val[24];
    if (pct >= 0.0f) {
        int fill = (int)((barW - 6) * (pct > 100.0f ? 100.0f : pct) / 100.0f);
        display.fillRect(barX + 3, y + 3, fill, h - 6, GxEPD_BLACK);
        if (reset[0]) snprintf(val, sizeof(val), "%d%%  %s", (int)pct, reset);
        else snprintf(val, sizeof(val), "%d%%", (int)pct);
    } else {
        strncpy(val, "--", sizeof(val));
    }
    // % label to the right of the bar, black-on-white outside the fill
    textAt(barX + barW + 8, y + h - 4, val, &FreeSans9pt7b);
}

// ===== Screens =====

void drawSearching(const Snap& s) {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    textAt(300, 210, "INKDECK", &FreeSansBold18pt7b);
    const char* msg = s.wifiUp ? "Searching for AgentDeck daemon..." : "WiFi not connected";
    textAt(240, 260, msg, &FreeSans9pt7b);
    if (s.wifiUp && s.ip[0]) {
        char line[48]; snprintf(line, sizeof(line), "panel %s · mDNS _agentdeck._tcp", s.ip);
        textAt(240, 290, line, &FreeSans9pt7b);
    }
    char tag[64];
    snprintf(tag, sizeof(tag), "AgentDeck v%s %.7s", FIRMWARE_VERSION, GIT_SHA);
    textAt(16, 468, tag, &FreeSans9pt7b);
}

void drawSleep() {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    textAt(330, 240, "asleep", &FreeSansBold12pt7b);
    display.drawCircle(310, 232, 10, GxEPD_BLACK);
    display.fillCircle(314, 228, 8, GxEPD_WHITE);  // crescent moon
}

void drawDashboard(const Snap& s) {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);

    // --- Header ---
    textAt(16, 38, "AGENTDECK", &FreeSansBold18pt7b);
    char right[64];
    if (s.fiveH >= 0.0f || s.sevenD >= 0.0f) {
        snprintf(right, sizeof(right), "5H %d%%   7D %d%%%s",
                 s.fiveH >= 0 ? (int)s.fiveH : 0, s.sevenD >= 0 ? (int)s.sevenD : 0,
                 s.usageStale ? " (stale)" : "");
        textRight(784, 34, right, &FreeSansBold12pt7b);
    }
    display.fillRect(0, 52, 800, 3, GxEPD_BLACK);

    // --- Session rows ---
    if (s.rowCount == 0) {
        textAt(280, 220, "NO ACTIVE SESSIONS", &FreeSansBold12pt7b);
        textAt(258, 252, "start claude / codex / opencode in a workspace", &FreeSans9pt7b);
    }
    const int16_t rowTop = 64, rowH = 56, glyphSize = 44;
    for (uint8_t i = 0; i < s.rowCount; i++) {
        const RowSnap& r = s.rows[i];
        int16_t y = rowTop + i * rowH;
        bool awaiting = isAwaiting(r.state);

        // Awaiting rows invert: a black band the eye can't miss across the room.
        if (awaiting) {
            display.fillRect(0, y, 800, rowH - 4, GxEPD_BLACK);
            display.setTextColor(GxEPD_WHITE);
        }

        // Creature silhouette (white-on-black when inverted via manual invert draw)
        if (awaiting) {
            const uint8_t* a8 = glyphFor(r.agentType);
            for (int oy = 0; oy < glyphSize; oy++) {
                int sy = oy * 64 / glyphSize;
                for (int ox = 0; ox < glyphSize; ox++)
                    if (a8[sy * 64 + ox * 64 / glyphSize] >= 128)
                        display.drawPixel(16 + ox, y + 5 + oy, GxEPD_WHITE);
            }
        } else {
            drawMask(16, y + 5, glyphFor(r.agentType), glyphSize);
        }

        char name[40]; ascii(name, sizeof(name), r.name);
        if (!name[0]) strncpy(name, "(unnamed)", sizeof(name) - 1);
        textAt(74, y + 26, name, &FreeSansBold12pt7b);

        // Second line: state · tool/question · model
        char label[16]; stateLabel(r.state, label, sizeof(label));
        char line[120];
        if (awaiting && r.question[0]) {
            char q[72]; ascii(q, sizeof(q), r.question);
            snprintf(line, sizeof(line), "%s  %s", label, q);
        } else if (r.tool[0]) {
            char t[40]; ascii(t, sizeof(t), r.tool);
            snprintf(line, sizeof(line), "%s · %s", label, t);
        } else {
            strncpy(line, label, sizeof(line) - 1); line[sizeof(line) - 1] = '\0';
        }
        textAt(74, y + 46, line, &FreeSans9pt7b);

        // Right column: model + elapsed
        char meta[48]; char model[32]; ascii(model, sizeof(model), r.model);
        if (r.elapsedSec >= 60) {
            snprintf(meta, sizeof(meta), "%s · %lum", model, (unsigned long)(r.elapsedSec / 60));
        } else {
            snprintf(meta, sizeof(meta), "%s", model);
        }
        textRight(784, y + 34, meta, &FreeSans9pt7b);

        display.setTextColor(GxEPD_BLACK);
        if (!awaiting && i + 1 < s.rowCount)
            display.drawFastHLine(16, y + rowH - 4, 768, GxEPD_BLACK);
    }
    if (s.totalSessions > s.rowCount) {
        char more[32];
        snprintf(more, sizeof(more), "+%d more", s.totalSessions - s.rowCount);
        textRight(784, rowTop + MAX_ROWS * rowH - 12, more, &FreeSans9pt7b);
    }

    // --- Usage footer ---
    display.fillRect(0, 402, 800, 2, GxEPD_BLACK);
    drawGauge(16, 414, 330, 24, "5H", s.fiveH, s.fiveReset);
    drawGauge(410, 414, 330, 24, "7D", s.sevenD, s.sevenReset);
    char foot[96];
    if (s.codexP >= 0.0f || s.codexS >= 0.0f) {
        snprintf(foot, sizeof(foot), "CODEX 5H %d%% · 7D %d%%",
                 s.codexP >= 0 ? (int)s.codexP : 0, s.codexS >= 0 ? (int)s.codexS : 0);
        textAt(16, 468, foot, &FreeSans9pt7b);
    }
    snprintf(foot, sizeof(foot), "%s%s · v%s %.7s · %s",
             s.serialUp ? "USB" : "WiFi", s.bridgeConnected ? " LINK" : " NO LINK",
             FIRMWARE_VERSION, GIT_SHA, s.ip[0] ? s.ip : "-");
    textRight(784, 468, foot, &FreeSans9pt7b);
}

// ===== Refresh engine =====

uint32_t lastHash = 0;
uint32_t lastDrawMs = 0;
uint32_t lastFullMs = 0;
uint8_t partialCount = 0;
bool firstDraw = true;
bool forceFull = false;
bool asleep = false;
bool wasSearching = true;

bool key1Prev = true, key2Prev = true;
uint32_t keyLastMs = 0;

void refresh(void (*draw)(const Snap&), const Snap& s, bool full) {
    if (full) {
        display.setFullWindow();
        partialCount = 0;
        lastFullMs = millis();
    } else {
        display.setPartialWindow(0, 0, display.width(), display.height());
        partialCount++;
    }
    display.firstPage();
    do { draw(s); } while (display.nextPage());
    display.hibernate();  // panel deep-sleeps between refreshes; RST wakes it
}

}  // namespace

namespace Eink {

void init() {
    pinMode(PIN_KEY1, INPUT_PULLUP);
    pinMode(PIN_KEY2, INPUT_PULLUP);
    SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
    display.init(115200, true, 2, false);
    display.setRotation(0);
    Serial.printf("[Eink] GDEY075T7 init %dx%d, partial=%d\n",
                  display.width(), display.height(),
                  (int)display.epd2.hasFastPartialUpdate);
    Snap s; snapshot(s);
    refresh(drawSearching, s, true);
    firstDraw = false;
    lastDrawMs = millis();
}

void update(float /*dt*/) {
    uint32_t now = millis();
    bool k1 = digitalRead(PIN_KEY1), k2 = digitalRead(PIN_KEY2);
    if (((key1Prev && !k1) || (key2Prev && !k2)) && now - keyLastMs > 300) {
        keyLastMs = now;
        forceFull = true;
        lastHash = 0;  // force redraw even if content unchanged
        Serial.println("[Eink] button → full refresh");
    }
    key1Prev = k1; key2Prev = k2;
}

void render() {
    uint32_t now = millis();
    Snap s; snapshot(s);

    // Host display asleep → one clean sleep card, then stay quiet until wake.
    if (!s.displayOn) {
        if (!asleep) {
            refresh([](const Snap&) { drawSleep(); }, s, true);
            asleep = true;
            lastHash = 0;
        }
        return;
    }
    asleep = false;

    bool searching = !s.bridgeConnected;
    uint32_t h = contentHash(s);
    if (h == lastHash && !forceFull) {
        // Unchanged content: only honor the anti-ghosting full-refresh age when
        // the panel has been doing partials (a full-refreshed static image can
        // sit forever without maintenance).
        return;
    }
    if (!forceFull && (now - lastDrawMs) < MIN_REFRESH_INTERVAL_MS) return;  // coalesce bursts

    bool full = forceFull || firstDraw ||
                partialCount >= FULL_EVERY_N_PARTIALS ||
                (now - lastFullMs) > FULL_MAX_AGE_MS ||
                (searching != wasSearching);
    refresh(searching ? drawSearching : drawDashboard, s, full);

    lastHash = h;
    lastDrawMs = now;
    firstDraw = false;
    forceFull = false;
    wasSearching = searching;
}

}  // namespace Eink

#endif  // BOARD_INKDECK
