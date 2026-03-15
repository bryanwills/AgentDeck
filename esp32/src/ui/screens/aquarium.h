#pragma once

#include <lvgl.h>

enum class ConnOverlayStatus {
    HIDDEN,         // 연결됨 — 오버레이 숨김
    NO_WIFI,        // WiFi 미연결 (스피너 없음)
    SEARCHING,      // WiFi OK, 브리지 탐색 중
    RECONNECTING,   // 연결 끊김 후 재연결 중
};

namespace Screens {

/**
 * Create the aquarium (main) screen with terrarium + HUD.
 */
lv_obj_t* aquariumCreate();

/**
 * Called every frame (~30fps) to animate.
 */
void aquariumUpdate(float dt);

/**
 * Set connection overlay status (full-screen scrim with card).
 */
void aquariumSetConnectionStatus(ConnOverlayStatus status);

}  // namespace Screens
