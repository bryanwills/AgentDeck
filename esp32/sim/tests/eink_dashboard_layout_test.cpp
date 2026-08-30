#include <cassert>

#include "ui/eink/eink_dashboard_layout.h"
#include "ui/eink/epd47_page_policy.h"

using AgentDeckEink::LayoutInput;
using AgentDeckEink::makeLayout;

int main() {
    using AgentDeckEpd47::Page;
    assert(AgentDeckEpd47::automaticPage(0, 0) == Page::Limits);
    assert(AgentDeckEpd47::automaticPage(0, 1) == Page::Focus);
    assert(AgentDeckEpd47::automaticPage(1, 0) == Page::Focus);
    assert(AgentDeckEpd47::automaticPage(1, 1) == Page::Queue);
    assert(AgentDeckEpd47::automaticPage(0, 8) == Page::Queue);

    // Page arbiter. A swap costs a full-panel clear, so a merely-correct page
    // must dwell before it is adopted; attention is exempt. Drive the real
    // struct rather than re-deriving the rule, so a regression here is a
    // regression in what the firmware runs.
    using AgentDeckEpd47::PageChange;
    {
        AgentDeckEpd47::PageArbiter a;          // starts on LIMITS
        constexpr uint32_t SETTLE = 120000;
        // A processing burst that ends before the dwell must not move the page.
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 1000, SETTLE) == PageChange::None);
        assert(a.current == Page::Limits);
        assert(AgentDeckEpd47::arbitratePage(a, 0, 0, 40000, SETTLE) == PageChange::None);
        assert(a.current == Page::Limits);
        // Re-arming after the excursion: the dwell restarts, it does not resume.
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 60000, SETTLE) == PageChange::None);
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 150000, SETTLE) == PageChange::None);
        assert(a.current == Page::Limits);
        // Held past the dwell → adopted, and reported as settled (no forceFull).
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 181000, SETTLE) == PageChange::Settled);
        assert(a.current == Page::Focus);
        // Already on the wanted page → no further change.
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 200000, SETTLE) == PageChange::None);
    }
    {
        AgentDeckEpd47::PageArbiter a;
        constexpr uint32_t SETTLE = 120000;
        // Attention never waits for the dwell.
        assert(AgentDeckEpd47::arbitratePage(a, 1, 0, 1000, SETTLE) == PageChange::Urgent);
        assert(a.current == Page::Focus);
        assert(AgentDeckEpd47::arbitratePage(a, 2, 3, 1100, SETTLE) == PageChange::Urgent);
        assert(a.current == Page::Queue);
    }
    {
        // millis() rollover must not strand a candidate forever.
        AgentDeckEpd47::PageArbiter a;
        constexpr uint32_t SETTLE = 120000;
        const uint32_t nearWrap = 0xFFFFFFFFu - 30000u;
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, nearWrap, SETTLE) == PageChange::None);
        assert(AgentDeckEpd47::arbitratePage(a, 0, 1, 100000u, SETTLE) == PageChange::Settled);
        assert(a.current == Page::Focus);
    }

    const auto inkdeck = makeLayout(LayoutInput{800, 480, 68, 0, 28, 21, 2, 1, 6, 2});
    assert(!inkdeck.portrait);
    assert(inkdeck.columns == 3);
    assert(inkdeck.rows == 2);
    assert(inkdeck.capacity == 6);
    assert(inkdeck.card(0).x == inkdeck.cards.x);
    assert(inkdeck.card(5).bottom() <= inkdeck.cards.bottom());

    const auto x3 = makeLayout(LayoutInput{528, 792, 64, 52, 24, 20, 2, 0, 6, 5});
    assert(x3.portrait);
    assert(x3.columns == 1);
    assert(x3.rows >= 4);
    assert(x3.card(1).y > x3.card(0).y);
    assert(x3.cards.bottom() <= x3.usage.y);

    const auto x4 = makeLayout(LayoutInput{800, 480, 64, 44, 24, 20, 1, 0, 4, 2});
    assert(!x4.portrait);
    assert(x4.columns == 2);
    assert(x4.capacity == 4);
    assert(x4.controls.bottom() == 480);

    const auto empty = makeLayout(LayoutInput{528, 792, 64, 52, 24, 20, 0, 0, 0, 5});
    assert(empty.capacity >= 1);
    assert(empty.card(0).w > 0);
    assert(empty.card(1).empty());
    return 0;
}
