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

inline const char* pageName(Page page) {
    switch (page) {
        case Page::Focus: return "FOCUS";
        case Page::Queue: return "QUEUE";
        default:          return "LIMITS";
    }
}

}  // namespace AgentDeckEpd47
