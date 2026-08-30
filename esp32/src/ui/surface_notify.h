#pragma once

// One notification surface, two implementations.
//
// protocol.cpp reports voice/playback progress through `HUD::` — the LVGL
// overlay bar. That made the whole spoken-reply path un-compilable on a board
// without LVGL, which is why enabling the RockBase NM-EPD-420's ES8311 first
// failed to build: BOARD_HAS_SPEAKER pulled ui/widgets/hud_bar.h into an e-ink
// firmware that excludes LVGL entirely.
//
// On an LVGL board this header IS the HUD header, unchanged. On a paper surface
// it provides the same `HUD::` names backed by the local timeline ring, which
// is what the e-ink footer and the DIGEST face already read — the paper-native
// equivalent of a status bar. Nothing is silently dropped; it lands where a
// paper surface can actually show it.
#if defined(BOARD_EINK_SURFACE)

#include <stdio.h>
#include <string.h>
#include "../state/agent_state.h"

namespace HUD {

inline void paperNote(const char* text) {
    if (!text || !text[0]) return;
    TimelineEntry entry{};
    snprintf(entry.type, sizeof(entry.type), "%s", "voice");
    snprintf(entry.raw, sizeof(entry.raw), "%s", text);
    g_state.addTimelineEntry(entry);
}

inline void setSpeaking(const char* text) {
    char line[120];
    snprintf(line, sizeof(line), "Speaking: %s", text ? text : "(reply)");
    paperNote(line);
}
// A paper surface has no transient state to clear — the row it already wrote is
// the record, and erasing it would cost a full refresh to say nothing.
inline void clearSpeaking() {}
inline void notify(const char* text) { paperNote(text); }
inline void pushVoiceQuestion(const char* q) { paperNote(q); }
inline void setVoiceAnswer(const char* a) { paperNote(a); }

}  // namespace HUD

#else
#include "widgets/hud_bar.h"
#endif
