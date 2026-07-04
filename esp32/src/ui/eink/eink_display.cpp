#ifdef BOARD_INKDECK

#include "eink_display.h"

#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
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
// Partial refresh (~0.3s) accumulates ghosting on the UC8179; Good Display
// recommends a flashing full refresh roughly every 5 partials. Content-hash
// gating means these only apply on real change.
//
// CRITICAL: the panel is kept in powerOff() (high voltage off, controller RAM
// RETAINED) between refreshes — NEVER hibernate() mid-session. hibernate()
// deep-sleeps the controller and wipes its previous-frame RAM, so the next
// partial refresh diffs against garbage → faint/ghosted text (the "blurry
// text" bug on first hardware bring-up). hibernate() is only used for the
// host-asleep card, and wake forces a full refresh.
constexpr uint32_t MIN_REFRESH_INTERVAL_MS = 3000;
constexpr uint8_t  FULL_EVERY_N_PARTIALS   = 5;
constexpr uint32_t FULL_MAX_AGE_MS         = 10UL * 60UL * 1000UL;

using Panel = GxEPD2_750_GDEY075T7;
GxEPD2_BW<Panel, Panel::HEIGHT> display(Panel(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

constexpr int16_t W = 800, H = 480;

// ===== Render snapshot (copied out of g_state under the mutex so the slow
// e-ink refresh never holds the lock) =====
constexpr uint8_t MAX_ROWS = 10;   // matches the sessions_list cap
constexpr uint8_t MAX_CARDS = 6;   // most sessions rendered as full cards

struct RowSnap {
    char name[40];
    char agentType[16];
    char state[20];
    char tool[40];
    char model[32];
    char question[120];
    char activity[80];
    bool alive;
};

struct Snap {
    bool bridgeConnected;
    bool wifiUp;
    bool serialUp;
    uint8_t rowCount;
    uint8_t totalSessions;
    RowSnap rows[MAX_ROWS];
    // Focused-session options (global — shown on the first awaiting card)
    uint8_t optionCount;
    char options[3][36];
    // Usage
    float fiveH, sevenD;
    char fiveReset[20], sevenReset[20];
    bool usageStale;
    float codexP, codexS;
    char codexPReset[20], codexSReset[20];
    // Subscription plan lines per provider ("Max 20x ~7/12"), '' = hide
    char claudePlan[40];
    char codexPlan[40];
    char agPlan[40];   // pre-shortened "AGY Pro ~8/1" chip text
    bool displayOn;
    char ip[16];
    // Latest timeline event, compressed to one ticker line. EXCLUDED from the
    // content hash — it updates at most once a minute (piggybacks otherwise)
    // so tool-event churn can't strobe the e-ink.
    char tickerTime[8];
    char tickerText[104];
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
        strncpy(dst.activity, src.activity, sizeof(dst.activity) - 1);
        dst.alive = src.alive;
    }
    s.optionCount = g_state.optionCount < 3 ? g_state.optionCount : 3;
    for (uint8_t i = 0; i < s.optionCount; i++)
        strncpy(s.options[i], g_state.options[i].label, sizeof(s.options[i]) - 1);
    s.fiveH = g_state.fiveHourPercent;
    s.sevenD = g_state.sevenDayPercent;
    strncpy(s.fiveReset, g_state.fiveHourReset, sizeof(s.fiveReset) - 1);
    strncpy(s.sevenReset, g_state.sevenDayReset, sizeof(s.sevenReset) - 1);
    s.usageStale = g_state.usageStale;
    s.codexP = g_state.codexPrimaryPercent;
    s.codexS = g_state.codexSecondaryPercent;
    strncpy(s.codexPReset, g_state.codexPrimaryReset, sizeof(s.codexPReset) - 1);
    strncpy(s.codexSReset, g_state.codexSecondaryReset, sizeof(s.codexSReset) - 1);
    // Map subscriptions[] to provider rows by name; unmatched → AGY chip.
    // (Antigravity credits are deliberately NOT surfaced — the raw count is
    // meaningless to glance at; only the plan/expiry chip remains.)
    for (uint8_t i = 0; i < g_state.subscriptionCount; i++) {
        const auto& sub = g_state.subscriptions[i];
        char line[40];
        if (sub.until[0]) snprintf(line, sizeof(line), "%s %s", sub.name, sub.until);
        else { strncpy(line, sub.name, sizeof(line) - 1); line[sizeof(line) - 1] = '\0'; }
        if (strncmp(sub.name, "Claude", 6) == 0) {
            // drop the redundant "Claude " prefix under the CLAUDE label
            const char* tail = line + 6; while (*tail == ' ') tail++;
            strncpy(s.claudePlan, tail, sizeof(s.claudePlan) - 1);
        } else if (strncmp(sub.name, "ChatGPT", 7) == 0 || strncmp(sub.name, "Codex", 5) == 0) {
            const char* tail = line + (sub.name[1] == 'h' ? 7 : 5); while (*tail == ' ') tail++;
            strncpy(s.codexPlan, tail, sizeof(s.codexPlan) - 1);
        } else if (strncmp(sub.name, "Antigravity", 11) == 0) {
            const char* tail = line + 11; while (*tail == ' ') tail++;
            snprintf(s.agPlan, sizeof(s.agPlan), "AGY %s", tail);
        } else {
            strncpy(s.agPlan, line, sizeof(s.agPlan) - 1);
        }
    }
    // Plan-name-only fallback when the daemon exposes antigravityStatus but
    // no subscriptions[] entry for it.
    if (!s.agPlan[0] && g_state.antigravityPlan[0]) {
        snprintf(s.agPlan, sizeof(s.agPlan), "AGY %s", g_state.antigravityPlan);
    }
    // Latest human-readable timeline entry → ticker. Skips raw JSON bodies
    // (codex tool outputs like {"exclude":[]} land in the timeline as
    // chat_response rows — machine noise, not a status line). Prefer the
    // daemon-preformatted local "HH:MM"; raw ts fallback is UTC-derived.
    for (uint8_t back = 0; back < g_state.timelineCount && back < 8; back++) {
        uint8_t idx = (uint8_t)((g_state.timelineHead + g_state.timelineCount - 1 - back) % TIMELINE_MAX_ENTRIES);
        const TimelineEntry& t = g_state.timeline[idx];
        if (!t.raw[0] || t.raw[0] == '{' || t.raw[0] == '[') continue;
        if (t.hm[0]) {
            strncpy(s.tickerTime, t.hm, sizeof(s.tickerTime) - 1);
        } else {
            snprintf(s.tickerTime, sizeof(s.tickerTime), "%02lu:%02lu",
                     (unsigned long)(t.ts / 3600) % 24, (unsigned long)(t.ts / 60) % 60);
        }
        strncpy(s.tickerText, t.raw, sizeof(s.tickerText) - 1);
        break;
    }
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
    h = fnv(h, &s.serialUp, 1);
    h = fnv(h, &s.rowCount, 1);
    h = fnv(h, &s.totalSessions, 1);
    for (uint8_t i = 0; i < s.rowCount; i++) {
        const RowSnap& r = s.rows[i];
        h = fnvStr(h, r.name); h = fnvStr(h, r.agentType); h = fnvStr(h, r.state);
        h = fnvStr(h, r.tool); h = fnvStr(h, r.model); h = fnvStr(h, r.question);
        h = fnvStr(h, r.activity);
        h = fnv(h, &r.alive, 1);
    }
    h = fnv(h, &s.optionCount, 1);
    for (uint8_t i = 0; i < s.optionCount; i++) h = fnvStr(h, s.options[i]);
    int fh = (int)s.fiveH, sd = (int)s.sevenD, cp = (int)s.codexP, cs = (int)s.codexS;
    h = fnv(h, &fh, sizeof(fh)); h = fnv(h, &sd, sizeof(sd));
    h = fnv(h, &cp, sizeof(cp)); h = fnv(h, &cs, sizeof(cs));
    h = fnvStr(h, s.fiveReset); h = fnvStr(h, s.sevenReset);
    h = fnvStr(h, s.codexPReset); h = fnvStr(h, s.codexSReset);
    h = fnvStr(h, s.claudePlan); h = fnvStr(h, s.codexPlan); h = fnvStr(h, s.agPlan);
    h = fnv(h, &s.usageStale, 1);
    h = fnvStr(h, s.ip);
    // NOTE: tickerText intentionally NOT hashed — see Snap.
    return h;
}

// ===== Draw helpers =====

// GFX FreeFonts are Latin-1; drop anything outside printable ASCII so multibyte
// project names degrade to a single marker instead of tofu garbage.
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

uint16_t inkColor = GxEPD_BLACK;
uint16_t paperColor = GxEPD_WHITE;
void setInk(bool inverted) {
    inkColor = inverted ? GxEPD_WHITE : GxEPD_BLACK;
    paperColor = inverted ? GxEPD_BLACK : GxEPD_WHITE;
    display.setTextColor(inkColor);
}

// Sentinel for the classic built-in 6×8 GFX font (setFont(nullptr) mode) —
// a distinct pointer so cascade args can still use nullptr for "not given".
const GFXfont* const CLASSIC_FONT = (const GFXfont*)(uintptr_t)1;

// CLASSIC_FONT draws from its top-left; the baseline `y` is shifted so call
// sites stay uniform across fonts.
void textAt(int16_t x, int16_t y, const char* s, const GFXfont* f) {
    if (f == CLASSIC_FONT) { display.setFont(nullptr); display.setTextSize(1); display.setCursor(x, y - 7); }
    else { display.setFont(f); display.setCursor(x, y); }
    display.print(s);
}

int16_t textWidth(const char* s, const GFXfont* f) {
    int16_t x1, y1; uint16_t w, h;
    if (f == CLASSIC_FONT) { display.setFont(nullptr); display.setTextSize(1); }
    else display.setFont(f);
    display.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
    return (int16_t)w;
}

void textRight(int16_t xRight, int16_t y, const char* s, const GFXfont* f) {
    textAt(xRight - textWidth(s, f), y, s, f);
}

// Truncate `s` (already ASCII) to fit `maxW` with the given font, appending
// ".." when cut. Result in `out`.
void fitText(char* out, size_t outLen, const char* s, int16_t maxW, const GFXfont* f) {
    strncpy(out, s, outLen - 1); out[outLen - 1] = '\0';
    if (textWidth(out, f) <= maxW) return;
    size_t len = strlen(out);
    while (len > 1) {
        out[--len] = '\0';
        out[len - 1 >= 0 ? len : 0] = '\0';
        char probe[96];
        snprintf(probe, sizeof(probe), "%s..", out);
        if (textWidth(probe, f) <= maxW) { strncpy(out, probe, outLen - 1); out[outLen - 1] = '\0'; return; }
    }
}

// Greedy 2-line wrap in a SINGLE font (mixed sizes across the two lines read
// as a glitch on paper). Line 1 breaks at the last space that fits — falling
// back to a mid-word hard break only when one word alone exceeds the width
// (the old space-only backoff shrank "Hello-world-… is" to a one-letter first
// line). Line 2 ellipsizes as the last resort.
void drawWrapped2(int16_t x, int16_t y1, int16_t y2, int16_t maxW,
                  const char* text, const GFXfont* f) {
    if (textWidth(text, f) <= maxW) { textAt(x, y1, text, f); return; }
    size_t len = strlen(text);
    size_t take = len;
    char probe[112];
    while (take > 1) {
        strncpy(probe, text, take); probe[take] = '\0';
        if (textWidth(probe, f) <= maxW) break;
        take--;
    }
    size_t brk = take;
    if (take < len) {
        size_t sp = take;
        while (sp > 0 && text[sp] != ' ') sp--;
        if (sp > take / 2) brk = sp;  // word boundary, but never a near-empty line 1
    }
    strncpy(probe, text, brk); probe[brk] = '\0';
    textAt(x, y1, probe, f);
    const char* rest = text + brk;
    while (*rest == ' ') rest++;
    if (*rest) {
        char l2[112];
        fitText(l2, sizeof(l2), rest, maxW, f);
        textAt(x, y2, l2, f);
    }
}

// Font cascade: prefer `pref`, drop to `smaller` (then `smallest`) instead of
// ellipsizing — truncation is the last resort at the smallest size only.
const GFXfont* fitCascade(char* out, size_t outLen, const char* s, int16_t maxW,
                          const GFXfont* pref, const GFXfont* smaller,
                          const GFXfont* smallest = nullptr) {
    if (textWidth(s, pref) <= maxW) { strncpy(out, s, outLen - 1); out[outLen - 1] = '\0'; return pref; }
    if (smaller && textWidth(s, smaller) <= maxW) { strncpy(out, s, outLen - 1); out[outLen - 1] = '\0'; return smaller; }
    if (smallest && textWidth(s, smallest) <= maxW) { strncpy(out, s, outLen - 1); out[outLen - 1] = '\0'; return smallest; }
    const GFXfont* f = smallest ? smallest : (smaller ? smaller : pref);
    fitText(out, outLen, s, maxW, f);
    return f;
}

// ===== AgentDeck product mark — aquarium dome over a button deck =====
// Geometry mirrors apple/AgentDeck/UI/MenuBar/AgentDeckLogo.swift (unit space
// 0..24) — the canonical current mark shared by the menubar icon and app
// icon silhouette. The old AD-shield mark is retired everywhere; do not
// resurrect it here.

void stampAt(float x, float y, int r) {
    if (r <= 0) display.drawPixel((int)(x + 0.5f), (int)(y + 0.5f), inkColor);
    else display.fillCircle((int)(x + 0.5f), (int)(y + 0.5f), r, inkColor);
}

void strokeBezier(float x0, float y0, float cx1, float cy1,
                  float cx2, float cy2, float x1, float y1, int r) {
    const int STEPS = 28;
    for (int i = 0; i <= STEPS; i++) {
        float t = (float)i / STEPS, u = 1.0f - t;
        float bx = u*u*u*x0 + 3*u*u*t*cx1 + 3*u*t*t*cx2 + t*t*t*x1;
        float by = u*u*u*y0 + 3*u*u*t*cy1 + 3*u*t*t*cy2 + t*t*t*y1;
        stampAt(bx, by, r);
    }
}

void drawAgentDeckMark(int16_t x, int16_t y, int size) {
    float s = size / 24.0f;
    int stroke = max(1, (int)(0.8f * s));
    // Glass dome
    strokeBezier(x + 4.7f*s, y + 12.8f*s, x + 5.3f*s, y + 4.9f*s,
                 x + 18.7f*s, y + 4.9f*s, x + 19.3f*s, y + 12.8f*s, stroke);
    // Waterline (thinner)
    strokeBezier(x + 6.1f*s, y + 11.2f*s, x + 8.8f*s, y + 12.5f*s,
                 x + 15.2f*s, y + 12.5f*s, x + 17.9f*s, y + 11.2f*s,
                 max(1, (int)(0.5f * s)));
    // Bubbles (position = center in the Swift source)
    display.fillCircle(x + (int)(9.6f*s), y + (int)(9.0f*s), max(1, (int)(0.95f*s)), inkColor);
    display.fillCircle(x + (int)(14.8f*s), y + (int)(8.2f*s), max(1, (int)(0.6f*s)), inkColor);
    // Deck base — rounded-rect stroke (thickness via inset passes)
    int dx = x + (int)(3.4f*s), dy = y + (int)(12.2f*s);
    int dw = (int)(17.2f*s), dh = (int)(7.8f*s), rr = max(2, (int)(2.2f*s));
    int passes = max(1, (int)(1.2f * s + 0.5f) / 2 + 1);
    for (int t = 0; t < passes; t++)
        display.drawRoundRect(dx + t, dy + t, dw - 2*t, dh - 2*t, max(1, rr - t), inkColor);
    // Three deck keys — middle emphasized (filled), outers hollow, echoing
    // the menubar mark's opacity accents
    int kw = max(2, (int)(3.1f*s)), kh = max(2, (int)(2.0f*s)), kr = max(1, (int)(1.0f*s));
    int ky = y + (int)(15.4f*s);
    display.drawRoundRect(x + (int)(6.5f*s), ky, kw, kh, kr, inkColor);
    display.fillRoundRect(x + (int)(10.4f*s), ky, kw, kh, kr, inkColor);
    display.drawRoundRect(x + (int)(14.3f*s), ky, kw, kh, kr, inkColor);
}

// Threshold-scale a 64×64 A8 mask into a silhouette in the current ink color.
void drawMask64(int16_t x, int16_t y, const uint8_t* a8, int size) {
    for (int oy = 0; oy < size; oy++) {
        const uint8_t* row = a8 + (oy * 64 / size) * 64;
        for (int ox = 0; ox < size; ox++) {
            if (row[ox * 64 / size] >= 128) display.drawPixel(x + ox, y + oy, inkColor);
        }
    }
}

// Agent creature glyph. OpenClaw uses the FULL canonical brand mark (eyes,
// claws, antennae — same as the card surfaces), with the two eye pupils
// punched back to paper so the face reads at 1-bit; the body-only
// CRAYFISH_BODY mask is a terrarium asset that pairs with procedural claws
// and looks like a shapeless blob on a card.
void drawAgentGlyph(const char* agentType, int16_t x, int16_t y, int size) {
    const uint8_t* a8 = CreatureGlyphs::OCTOPUS_A8;  // claude-code + default
    bool openclaw = false;
    if (strcmp(agentType, "openclaw") == 0)         { a8 = CreatureGlyphs::OPENCLAW_MARK_A8; openclaw = true; }
    else if (strncmp(agentType, "codex", 5) == 0)   a8 = CreatureGlyphs::CODEX_A8;
    else if (strcmp(agentType, "opencode") == 0)    a8 = CreatureGlyphs::OPENCODE_A8;
    else if (strcmp(agentType, "antigravity") == 0) a8 = CreatureGlyphs::ANTIGRAVITY_A8;
    drawMask64(x, y, a8, size);
    if (openclaw) {
        // Eye pupils at viewBox-24 (8.835, 7.843) / (15.165, 7.843), r≈1.26 —
        // same geometry as shared agentGlyphMono's paper cutouts.
        float sc = size / 24.0f;
        int r = max(1, (int)(1.26f * sc));
        display.fillCircle(x + (int)(8.835f * sc), y + (int)(7.843f * sc), r, paperColor);
        display.fillCircle(x + (int)(15.165f * sc), y + (int)(7.843f * sc), r, paperColor);
    }
}

bool isAwaiting(const char* state) { return strncmp(state, "awaiting", 8) == 0; }

void stateLabel(const char* state, char* out, size_t outLen) {
    if (strcmp(state, "processing") == 0) strncpy(out, "PROCESSING", outLen - 1);
    else if (strcmp(state, "awaiting_permission") == 0) strncpy(out, "PERMISSION", outLen - 1);
    else if (strcmp(state, "awaiting_option") == 0) strncpy(out, "CHOOSE", outLen - 1);
    else if (strcmp(state, "awaiting_diff") == 0) strncpy(out, "REVIEW", outLen - 1);
    else if (strcmp(state, "idle") == 0) strncpy(out, "IDLE", outLen - 1);
    else strncpy(out, "OFFLINE", outLen - 1);
    out[outLen - 1] = '\0';
}

// State marker box: awaiting = solid, processing = diagonal hatch, idle = hollow.
void drawStateMarker(int16_t x, int16_t y, int16_t sz, const char* state) {
    display.drawRect(x, y, sz, sz, inkColor);
    if (isAwaiting(state)) {
        display.fillRect(x, y, sz, sz, inkColor);
    } else if (strcmp(state, "processing") == 0) {
        for (int d = 2; d < sz * 2 - 2; d += 3) {
            int x0 = d < sz ? x + d : x + sz - 1;
            int y0 = d < sz ? y : y + (d - sz + 1);
            int x1 = d < sz ? x : x + d - sz + 1;
            int y1 = d < sz ? y + d : y + sz - 1;
            display.drawLine(x0, y0, x1, y1, inkColor);
        }
    }
}

// ===== Screens =====

void drawBrandHeader(const Snap& s) {
    // Dome-over-deck product mark + wordmark — the same lockup as the
    // menubar icon and app icon silhouette.
    drawAgentDeckMark(12, 4, 56);
    textAt(78, 44, "AgentDeck", &FreeSansBold18pt7b);

    // Link status chip, right-aligned
    const char* link = s.bridgeConnected ? (s.serialUp ? "USB LINK" : "WIFI LINK") : "NO LINK";
    int16_t tw = textWidth(link, &FreeSansBold9pt7b);
    int16_t chipW = tw + 24, chipX = W - 16 - chipW;
    if (s.bridgeConnected) {
        display.fillRoundRect(chipX, 16, chipW, 32, 6, GxEPD_BLACK);
        display.setTextColor(GxEPD_WHITE);
        textAt(chipX + 12, 38, link, &FreeSansBold9pt7b);
        display.setTextColor(inkColor);
    } else {
        display.drawRoundRect(chipX, 16, chipW, 32, 6, GxEPD_BLACK);
        textAt(chipX + 12, 38, link, &FreeSansBold9pt7b);
    }

    // Session count, left of the chip
    if (s.totalSessions > 0) {
        char cnt[24];
        snprintf(cnt, sizeof(cnt), "%d session%s", s.totalSessions, s.totalSessions == 1 ? "" : "s");
        textRight(chipX - 14, 38, cnt, &FreeSans9pt7b);
    }

    // Double rule (print-style)
    display.fillRect(0, 62, W, 2, GxEPD_BLACK);
    display.drawFastHLine(0, 66, W, GxEPD_BLACK);
}

// One gauge block: "5H [▓▓▓░░] 42% · 1h 23m". Bar kept narrow (140px) so the
// value+reset text breathes before the next block starts.
void drawGaugeBar(int16_t x, int16_t y, const char* tag, float pct, const char* reset) {
    constexpr int16_t barW = 140, barH = 16;
    textAt(x, y + barH - 2, tag, &FreeSansBold9pt7b);
    int16_t bx = x + 30;
    display.drawRect(bx, y, barW, barH, GxEPD_BLACK);
    char val[36];
    if (pct >= 0.0f) {
        float p = pct > 100.0f ? 100.0f : pct;
        int fill = (int)((barW - 4) * p / 100.0f);
        display.fillRect(bx + 2, y + 2, fill, barH - 4, GxEPD_BLACK);
        if (reset[0]) snprintf(val, sizeof(val), "%d%% · %s", (int)pct, reset);
        else snprintf(val, sizeof(val), "%d%%", (int)pct);
    } else {
        strncpy(val, "--", sizeof(val));
    }
    textAt(bx + barW + 8, y + barH - 2, val, &FreeSans9pt7b);
}

// Provider row (28px): mini glyph + label (+ subscription plan sub-line in the
// classic font when known) + 5H/7D gauges. Returns true if drawn.
bool drawProviderUsage(int16_t y, const char* agentType, const char* label,
                       const char* plan, float p5, const char* r5,
                       float p7, const char* r7, bool stale) {
    if (p5 < 0.0f && p7 < 0.0f) return false;
    drawAgentGlyph(agentType, 14, y + 2, 22);
    char lbl[24];
    snprintf(lbl, sizeof(lbl), "%s%s", label, stale ? "*" : "");
    textAt(44, y + 13, lbl, &FreeSansBold9pt7b);
    if (plan[0]) {
        char pf[24];
        fitText(pf, sizeof(pf), plan, 100, CLASSIC_FONT);
        textAt(44, y + 26, pf, CLASSIC_FONT);  // "Max 20x ~7/12" under the label
    }
    drawGaugeBar(150, y + 2, "5H", p5, r5);
    drawGaugeBar(490, y + 2, "7D", p7, r7);
    return true;
}

void drawUsageFooter(const Snap& s, bool showIdentity) {
    display.fillRect(0, 370, W, 2, GxEPD_BLACK);
    int16_t y = 378;
    bool any = false;
    if (drawProviderUsage(y, "claude-code", "CLAUDE", s.claudePlan, s.fiveH, s.fiveReset,
                          s.sevenD, s.sevenReset, s.usageStale)) { y += 28; any = true; }
    if (drawProviderUsage(y, "codex-cli", "CODEX", s.codexPlan, s.codexP, s.codexPReset,
                          s.codexS, s.codexSReset, false)) { y += 28; any = true; }
    if (!any) textAt(16, y + 16, "usage: waiting for data", &FreeSans9pt7b);

    // AGY subscription chip — smallest possible footprint (classic font,
    // bottom-right corner), only when the daemon resolves the account.
    int16_t agW = 0;
    if (s.agPlan[0]) {
        char agf[28];
        fitText(agf, sizeof(agf), s.agPlan, 130, CLASSIC_FONT);
        agW = textWidth(agf, CLASSIC_FONT) + 14;
        textRight(W - 16, 474, agf, CLASSIC_FONT);
    }
    if (showIdentity) {
        // Searching screen only: build identity (flash verification aid)
        char tag[64];
        snprintf(tag, sizeof(tag), "v%s %.7s", FIRMWARE_VERSION, GIT_SHA);
        textRight(W - 16 - agW, 474, tag, &FreeSans9pt7b);
    }

    // Ticker — latest timeline event as ONE compressed line (the per-card
    // activity summary is the surface that gets two lines, not this). Single
    // 9pt font: dropping to the tiny classic font here read as a glitch.
    if (s.tickerText[0]) {
        const int16_t ty = 470;
        textAt(16, ty, s.tickerTime, &FreeSansBold9pt7b);
        char t[104]; ascii(t, sizeof(t), s.tickerText);
        char tf[108];
        int16_t maxW = W - 74 - 16 - agW - (showIdentity ? 110 : 0);
        fitText(tf, sizeof(tf), t, maxW, &FreeSans9pt7b);
        textAt(74, ty, tf, &FreeSans9pt7b);
    }
}

void drawSessionCard(const Snap& s, const RowSnap& r, bool firstAwaiting,
                     int16_t x, int16_t y, int16_t w, int16_t h) {
    bool awaiting = isAwaiting(r.state);
    bool tall = h > 200;

    if (awaiting) {
        display.fillRoundRect(x, y, w, h, 10, GxEPD_BLACK);
        setInk(true);
    } else {
        display.drawRoundRect(x, y, w, h, 10, GxEPD_BLACK);
        display.drawRoundRect(x + 1, y + 1, w - 2, h - 2, 10, GxEPD_BLACK);
        setInk(false);
    }

    // Narrow (3-col) cards get a smaller glyph so text keeps real width —
    // shrinking type is preferred over ellipsizing (user feedback).
    int glyph = tall ? 110 : (w >= 340 ? 72 : 48);
    int16_t gx = x + (w >= 340 ? 16 : 10), gy = y + (h - glyph) / 2;
    if (tall) gy = y + 28;
    drawAgentGlyph(r.agentType, gx, gy, glyph);

    int16_t tx = gx + glyph + (w >= 340 ? 18 : 12);
    int16_t maxTextW = x + w - tx - 12;

    // Project name — font cascade before any truncation
    char name[40]; ascii(name, sizeof(name), r.name);
    if (!name[0]) strncpy(name, "(unnamed)", sizeof(name) - 1);
    char fitted[48];
    const GFXfont* nameFont = tall
        ? fitCascade(fitted, sizeof(fitted), name, maxTextW, &FreeSansBold18pt7b, &FreeSansBold12pt7b)
        : fitCascade(fitted, sizeof(fitted), name, maxTextW, &FreeSansBold12pt7b, &FreeSansBold9pt7b);
    int16_t ny = y + (tall ? 52 : 32);
    textAt(tx, ny, fitted, nameFont);

    // State line: marker + label (+ current tool while processing). Session
    // age was dropped here — elapsedSec is time since session START, and
    // "IDLE · 54m" read as 54 minutes of idling, which it never meant.
    char label[16]; stateLabel(r.state, label, sizeof(label));
    int16_t sy = ny + (tall ? 36 : 26);
    drawStateMarker(tx, sy - 11, 12, r.state);
    char stateLine[64];
    if (!awaiting && r.tool[0]) {
        char t[40]; ascii(t, sizeof(t), r.tool);
        snprintf(stateLine, sizeof(stateLine), "%s · %s", label, t);
    } else {
        strncpy(stateLine, label, sizeof(stateLine) - 1); stateLine[sizeof(stateLine) - 1] = '\0';
    }
    char stateFitted[68];
    const GFXfont* stateFont = fitCascade(stateFitted, sizeof(stateFitted), stateLine,
                                          maxTextW - 20, &FreeSansBold9pt7b, CLASSIC_FONT);
    textAt(tx + 20, sy, stateFitted, stateFont);

    // Detail: awaiting question (wrapped) or the activity one-liner —
    // "what did/is this agent actually doing", far more glanceable than a timer.
    int16_t dy = sy + 24;
    if (awaiting && r.question[0]) {
        char q[120]; ascii(q, sizeof(q), r.question);
        // wrap up to 2 lines (3 on tall cards)
        int maxLines = tall ? 3 : (h >= 130 ? 2 : 1);
        const char* p = q;
        for (int line = 0; line < maxLines && *p && dy < y + h - 8; line++) {
            char buf[64];
            size_t n = strlen(p);
            size_t take = n;
            while (take > 0) {
                strncpy(buf, p, take); buf[take] = '\0';
                if (textWidth(buf, &FreeSans9pt7b) <= maxTextW) break;
                // back off to previous space if any
                size_t sp = take - 1;
                while (sp > 0 && p[sp] != ' ') sp--;
                take = sp > 0 ? sp : take - 1;
            }
            strncpy(buf, p, take); buf[take] = '\0';
            textAt(tx, dy, buf, &FreeSans9pt7b);
            p += take;
            while (*p == ' ') p++;
            dy += 20;
        }
        // Options (focused/global) on the first awaiting card
        if (firstAwaiting && s.optionCount > 0 && tall) {
            for (uint8_t i = 0; i < s.optionCount && dy < y + h - 10; i++) {
                char opt[48], oa[40];
                ascii(oa, sizeof(oa), s.options[i]);
                snprintf(opt, sizeof(opt), "%d) %s", i + 1, oa);
                char of[52];
                fitText(of, sizeof(of), opt, maxTextW, &FreeSans9pt7b);
                textAt(tx, dy, of, &FreeSans9pt7b);
                dy += 20;
            }
        }
    } else if (r.activity[0] && dy < y + h - 8) {
        // Activity summary gets up to TWO wrapped lines (same font on both) —
        // this line is the point of the card, so give it room.
        char a[80]; ascii(a, sizeof(a), r.activity);
        bool roomFor2 = dy + 20 < y + h - 6;
        if (roomFor2) drawWrapped2(tx, dy, dy + 20, maxTextW, a, &FreeSans9pt7b);
        else { char af[84]; fitText(af, sizeof(af), a, maxTextW, &FreeSans9pt7b); textAt(tx, dy, af, &FreeSans9pt7b); }
    }

    // Model tag bottom-right on every card — narrow cards drop to the
    // classic font instead of losing the model entirely.
    if (r.model[0] && h >= 110) {
        char m[32]; ascii(m, sizeof(m), r.model);
        char mf[36];
        const GFXfont* modelFont = w >= 340
            ? fitCascade(mf, sizeof(mf), m, w - glyph - 60, &FreeSans9pt7b, CLASSIC_FONT)
            : fitCascade(mf, sizeof(mf), m, w - 24, CLASSIC_FONT, nullptr);
        textRight(x + w - 12, y + h - 10, mf, modelFont);
    }

    setInk(false);
}

bool needsAttention(const RowSnap& r) {
    return isAwaiting(r.state) || strcmp(r.state, "processing") == 0;
}

// Compact idle dock — one strip row of glyph+name chips for sessions that
// don't need attention. This is how "many agents" stays natural: cards are
// reserved for sessions that are doing/asking something; parked ones shrink
// to their creature + name instead of shrinking every card into unreadability.
void drawIdleDock(const Snap& s, const uint8_t* idx, uint8_t count,
                  int16_t top, int16_t bottom, int16_t left, int16_t right) {
    display.drawFastHLine(left, top, right - left, GxEPD_BLACK);
    int16_t cy = top + 8;
    int16_t x = left + 4;
    textAt(x, cy + 20, "IDLE", &FreeSansBold9pt7b);
    x += 58;
    uint8_t shown = 0;
    for (uint8_t k = 0; k < count; k++) {
        const RowSnap& r = s.rows[idx[k]];
        char name[24]; ascii(name, sizeof(name), r.name);
        if (!name[0]) strncpy(name, "(unnamed)", sizeof(name) - 1);
        char nf[26];
        fitText(nf, sizeof(nf), name, 110, &FreeSans9pt7b);
        int16_t entryW = 26 + 6 + textWidth(nf, &FreeSans9pt7b) + 22;
        if (x + entryW > right - 60) break;  // leave room for +N
        drawAgentGlyph(r.agentType, x, cy, 26);
        textAt(x + 32, cy + 20, nf, &FreeSans9pt7b);
        x += entryW;
        shown++;
    }
    uint8_t hidden = (count - shown) + (s.totalSessions - s.rowCount);
    if (hidden > 0) {
        char more[16];
        snprintf(more, sizeof(more), "+%d", hidden);
        textRight(right - 4, cy + 20, more, &FreeSansBold9pt7b);
    }
}

void drawSessionGrid(const Snap& s) {
    const int16_t top = 78, left = 12, right = W - 12;
    int16_t bottom = 366;
    if (s.rowCount == 0) {
        // Empty state — connected but no sessions
        drawAgentDeckMark(W / 2 - 36, 140, 72);
        textAt(W / 2 - textWidth("no active sessions", &FreeSansBold12pt7b) / 2, 260,
               "no active sessions", &FreeSansBold12pt7b);
        const char* hint = "start claude / codex / opencode in a workspace";
        textAt(W / 2 - textWidth(hint, &FreeSans9pt7b) / 2, 290, hint, &FreeSans9pt7b);
        return;
    }

    // Partition: attention (awaiting/processing) ahead of idle, daemon order
    // preserved within each group. With ≤6 sessions everyone gets a card;
    // beyond that the idle group collapses into the dock strip.
    uint8_t order[MAX_ROWS]; uint8_t nAttention = 0, nOrder = 0;
    for (uint8_t i = 0; i < s.rowCount; i++) if (needsAttention(s.rows[i])) order[nOrder++] = i, nAttention++;
    for (uint8_t i = 0; i < s.rowCount; i++) if (!needsAttention(s.rows[i])) order[nOrder++] = i;

    uint8_t nCards = s.rowCount;
    bool dock = false;
    if (s.rowCount > MAX_CARDS || s.totalSessions > s.rowCount) {
        nCards = nAttention < MAX_CARDS ? (nAttention > 0 ? nAttention : MAX_CARDS) : MAX_CARDS;
        if (nCards < nOrder || s.totalSessions > s.rowCount) {
            dock = true;
            bottom = 326;
            drawIdleDock(s, order + nCards, nOrder - nCards, 330, 366, left, right);
        }
    }

    int cols = nCards <= 2 ? nCards : (nCards <= 4 ? 2 : 3);
    int rows = nCards <= 2 ? 1 : 2;
    const int16_t gut = 10;
    int16_t cardW = (right - left - (cols - 1) * gut) / cols;
    int16_t cardH = (bottom - top - (rows - 1) * gut) / rows;

    int firstAwaitingIdx = -1;
    for (uint8_t k = 0; k < nCards; k++) {
        if (isAwaiting(s.rows[order[k]].state)) { firstAwaitingIdx = order[k]; break; }
    }

    for (uint8_t k = 0; k < nCards; k++) {
        int c = k % cols, rw = k / cols;
        int16_t cx = left + c * (cardW + gut);
        int16_t cy = top + rw * (cardH + gut);
        drawSessionCard(s, s.rows[order[k]], (int)order[k] == firstAwaitingIdx, cx, cy, cardW, cardH);
    }
    if (!dock && s.totalSessions > s.rowCount) {
        char more[24];
        snprintf(more, sizeof(more), "+%d more", s.totalSessions - s.rowCount);
        textRight(right - 4, bottom - 6, more, &FreeSans9pt7b);
    }
}

void drawSearching(const Snap& s) {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    setInk(false);
    drawBrandHeader(s);
    drawAgentDeckMark(W / 2 - 44, 130, 88);
    const char* msg = s.wifiUp || s.serialUp ? "searching for AgentDeck daemon..."
                                             : "no WiFi — connect USB or provision WiFi";
    textAt(W / 2 - textWidth(msg, &FreeSansBold12pt7b) / 2, 268, msg, &FreeSansBold12pt7b);
    if (s.wifiUp && s.ip[0]) {
        char line[64]; snprintf(line, sizeof(line), "panel %s · mDNS _agentdeck._tcp", s.ip);
        textAt(W / 2 - textWidth(line, &FreeSans9pt7b) / 2, 298, line, &FreeSans9pt7b);
    }
    drawUsageFooter(s, true);
}

void drawSleep() {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    setInk(false);
    drawAgentDeckMark(W / 2 - 28, 180, 56);
    textAt(W / 2 - textWidth("asleep", &FreeSansBold12pt7b) / 2, 282, "asleep", &FreeSansBold12pt7b);
    // crescent moon
    display.fillCircle(W / 2 - 70, 274, 11, GxEPD_BLACK);
    display.fillCircle(W / 2 - 65, 270, 10, GxEPD_WHITE);
}

void drawDashboard(const Snap& s) {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    setInk(false);
    drawBrandHeader(s);
    drawSessionGrid(s);
    drawUsageFooter(s, false);
    // NOTE: no Serial logging here — this runs on Core 1 while Core 0 emits
    // protocol JSON lines (device_info replies, acks). Cross-core prints
    // interleave mid-line and corrupt the newline-framed JSON the daemon
    // parses (observed: device_info replies mangled → daemon kept showing a
    // stale buildHash). Keep render-path logging out of the firmware.
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
char lastTickerShown[104] = "";

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
    // powerOff (NOT hibernate): high voltage off, controller previous-frame
    // RAM retained so the next partial refresh diffs cleanly. See note above.
    display.powerOff();
}

}  // namespace

namespace Eink {

void init() {
    pinMode(PIN_KEY1, INPUT_PULLUP);
    pinMode(PIN_KEY2, INPUT_PULLUP);
    SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
    // serial_diag_bitrate MUST stay 0: GxEPD2's diagnostics print _PowerOn/
    // _Update_* timing lines from THIS core (Core 1) on every refresh, which
    // interleaves with Core 0's protocol JSON on the shared USB CDC and
    // corrupts newline-framed replies (observed: mangled device_info + inbound
    // parse failures from the TX congestion).
    display.init(0, true, 2, false);
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

    // Host display asleep → one clean sleep card, then hibernate the panel
    // (deep sleep is safe here — wake below forces a full refresh, which
    // doesn't depend on the controller's wiped previous-frame RAM).
    if (!s.displayOn) {
        if (!asleep) {
            refresh([](const Snap&) { drawSleep(); }, s, true);
            display.hibernate();
            asleep = true;
            lastHash = 0;
        }
        return;
    }
    if (asleep) {
        asleep = false;
        forceFull = true;  // controller RAM was wiped by hibernate
        lastHash = 0;
    }

    bool searching = !s.bridgeConnected;
    uint32_t h = contentHash(s);
    // Ticker is outside the hash (tool-event churn must not strobe the
    // panel): it earns its own redraw at most once a minute; otherwise it
    // piggybacks on whatever refresh the hashed content triggers.
    bool tickerDue = s.tickerText[0] &&
                     strcmp(s.tickerText, lastTickerShown) != 0 &&
                     (now - lastDrawMs) >= 60000;
    if (h == lastHash && !forceFull && !tickerDue) return;
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
    strncpy(lastTickerShown, s.tickerText, sizeof(lastTickerShown) - 1);
    lastTickerShown[sizeof(lastTickerShown) - 1] = '\0';
}

}  // namespace Eink

#endif  // BOARD_INKDECK
