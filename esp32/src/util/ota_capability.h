#pragma once

#include <Arduino.h>

namespace OtaCapability {

struct Info {
    bool supported;
    uint8_t slotCount;
    uint32_t slotSize;
    uint32_t freeSketchSpace;
    const char* reason;
};

Info get();

}  // namespace OtaCapability
