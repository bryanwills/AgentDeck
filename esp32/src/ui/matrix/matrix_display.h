#pragma once

#include <cstdint>

namespace Matrix {

enum class Page : uint8_t {
    USAGE,      // Rate limit battery gauges + reset times
    AGENTS,     // Octopus/crayfish sprites with state colors
    INFO,       // Project + model scrolling text
    PAGE_COUNT
};

void init();
void update(float dt);
void render();

void nextPage();
void prevPage();
void actionPress();

} // namespace Matrix
