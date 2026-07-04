#include "ota_capability.h"

#include <esp_ota_ops.h>
#include <esp_partition.h>

namespace OtaCapability {

Info get() {
    static bool computed = false;
    static Info cached = {false, 0, 0, 0, "unknown"};
    if (computed) return cached;

    Info info = {false, 0, 0, 0, "unknown"};

#if defined(NO_OTA)
    info.reason = "no_ota_build";
    cached = info;
    computed = true;
    return cached;
#else
    esp_partition_iterator_t it = esp_partition_find(
        ESP_PARTITION_TYPE_APP,
        ESP_PARTITION_SUBTYPE_ANY,
        nullptr
    );
    while (it != nullptr) {
        const esp_partition_t* part = esp_partition_get(it);
        if (part != nullptr &&
            part->subtype >= ESP_PARTITION_SUBTYPE_APP_OTA_MIN &&
            part->subtype <= ESP_PARTITION_SUBTYPE_APP_OTA_MAX) {
            info.slotCount++;
            if (info.slotSize == 0 || part->size < info.slotSize) {
                info.slotSize = part->size;
            }
        }
        it = esp_partition_next(it);
    }

    info.freeSketchSpace = ESP.getFreeSketchSpace();
    const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
    if (info.slotCount < 2) {
        info.reason = "no_dual_ota_partition";
        cached = info;
        computed = true;
        return cached;
    }
    if (next == nullptr) {
        info.reason = "no_next_ota_partition";
        cached = info;
        computed = true;
        return cached;
    }

    info.supported = true;
    info.reason = "ok";
    cached = info;
    computed = true;
    return cached;
#endif
}

}  // namespace OtaCapability
