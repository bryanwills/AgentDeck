/**
 * Minimal boot test — Serial only, no display/LVGL/WiFi.
 * Rename to main.cpp to test, or use build_flags to exclude original main.
 */
#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n\n=== AgentDeck Minimal Boot Test ===");
    Serial.printf("Board: %s\n",
#if defined(BOARD_BOX_86) || defined(BOARD_86_BOX)
        "86 Box 4\""
#elif defined(BOARD_IPS35)
        "IPS 3.5\""
#elif defined(BOARD_AMOLED)
        "AMOLED Round"
#else
        "Unknown"
#endif
    );
    Serial.printf("CPU: %d MHz\n", ESP.getCpuFreqMHz());
    Serial.printf("Free heap: %d\n", ESP.getFreeHeap());
    if (psramFound()) {
        Serial.printf("PSRAM: %d KB\n", ESP.getFreePsram() / 1024);
    } else {
        Serial.println("No PSRAM!");
    }
    Serial.printf("Flash: %d KB\n", ESP.getFlashChipSize() / 1024);
    Serial.printf("SDK: %s\n", ESP.getSdkVersion());
    Serial.println("Boot OK!");
}

void loop() {
    Serial.printf("[%lu] alive\n", millis() / 1000);
    delay(2000);
}
