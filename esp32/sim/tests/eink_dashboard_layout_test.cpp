#include <cassert>

#include "ui/eink/eink_dashboard_layout.h"

using AgentDeckEink::LayoutInput;
using AgentDeckEink::makeLayout;

int main() {
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
