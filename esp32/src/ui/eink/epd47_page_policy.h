#pragma once

#include <stdint.h>

// EPD47's wide touch surface has three glance tabs. This policy is deliberately
// data-only: no strings, containers, or allocation, so firmware and host tests
// execute the same autonomous selection rule.
namespace AgentDeckEpd47 {

enum class Page : uint8_t { Focus = 0, Queue = 1, Limits = 2 };

inline Page automaticPage(uint8_t attentionCount, uint8_t processingCount) {
    const uint16_t active = (uint16_t)attentionCount + processingCount;
    if (active == 0) return Page::Limits;
    return active == 1 ? Page::Focus : Page::Queue;
}

// A page change costs a retained-frame erase plus a complete image write on this
// driver. It no longer spends a hard epd_clear(), but is still a much slower and
// more visible operation than changing an LCD framebuffer.
//
// automaticPage() alone reads a count that oscillates continuously on a busy
// machine: one session moving between processing and idle flips the answer
// between LIMITS, FOCUS and QUEUE. Following it directly made 88% of all
// repaints full clears against a policy that intends 20% (measured on the owned
// unit 2026-08-30: 713 repaints / 639 full, and 754/669 twenty-seven minutes
// later). The count is the right *answer* and the wrong *event*.
//
// The arbiter therefore requires a newly-correct page to stay correct for
// settleMs before it is adopted. Attention is exempt: when a session starts
// waiting on the user, the panel switches at once, because that is the one page
// change the user is actually waiting for.
struct PageArbiter {
    Page current = Page::Limits;
    Page candidate = Page::Limits;
    uint32_t candidateSinceMs = 0;
};

enum class PageChange : uint8_t {
    None = 0,   // keep showing `current`
    Settled,    // adopted after the dwell — ride the normal repaint cadence
    Urgent,     // attention appeared — repaint now
};

inline PageChange arbitratePage(PageArbiter& arb, uint8_t attentionCount,
                                uint8_t processingCount, uint32_t nowMs,
                                uint32_t settleMs) {
    const Page want = automaticPage(attentionCount, processingCount);
    if (want == arb.current) {
        // Back on the displayed page before the dwell elapsed: the excursion was
        // noise, so forget it rather than leaving a stale candidate armed.
        arb.candidate = want;
        arb.candidateSinceMs = nowMs;
        return PageChange::None;
    }
    if (attentionCount > 0) {
        arb.current = want;
        arb.candidate = want;
        arb.candidateSinceMs = nowMs;
        return PageChange::Urgent;
    }
    if (arb.candidate != want) {
        arb.candidate = want;
        arb.candidateSinceMs = nowMs;
        return PageChange::None;
    }
    // Unsigned subtraction is wrap-safe; millis() rollover cannot strand a page.
    if ((uint32_t)(nowMs - arb.candidateSinceMs) < settleMs) return PageChange::None;
    arb.current = want;
    return PageChange::Settled;
}

inline const char* pageName(Page page) {
    switch (page) {
        case Page::Focus: return "FOCUS";
        case Page::Queue: return "QUEUE";
        default:          return "LIMITS";
    }
}

}  // namespace AgentDeckEpd47
