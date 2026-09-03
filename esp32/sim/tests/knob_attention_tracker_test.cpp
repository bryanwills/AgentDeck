#include <cassert>
#include <cstdio>

#include "ui/knob/attention_tracker.h"

int main() {
    KnobAttention::Tracker tracker;

    // One waiting lifecycle produces one alert, regardless of repeated roster
    // broadcasts or a transport gap where the session temporarily disappears.
    assert(tracker.observe("claude-a", "awaiting_option", 100));
    assert(!tracker.observe("claude-a", "awaiting_option", 200));
    // No observe() call models an empty roster / disconnected transport.
    assert(!tracker.observe("claude-a", "awaiting_option", 5000));

    // Only explicit observation of a resolved state rearms that session.
    assert(!tracker.observe("claude-a", "processing", 5100));
    assert(tracker.observe("claude-a", "awaiting_permission", 5200));

    // A second session still alerts while the first is waiting.
    assert(tracker.observe("codex-b", "awaiting_diff", 5300));
    assert(!tracker.observe("claude-a", "awaiting_permission", 5400));
    assert(!tracker.observe("codex-b", "awaiting_diff", 5400));

    // Fill beyond the firmware roster cap over time. The tracker stays bounded
    // and reclaims vanished history instead of allocating or refusing alerts.
    for (int i = 0; i < 12; i++) {
        char id[32];
        std::snprintf(id, sizeof(id), "worker-%d", i);
        assert(tracker.observe(id, "awaiting_option", 6000 + i));
    }
    return 0;
}
