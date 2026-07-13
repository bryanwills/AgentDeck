// Unity-include wrapper for the TTGO/C6 ttgo_activity widget (used by ttgo_overlay).
// Empty TU on other boards.
#if defined(BOARD_TTGO) || defined(BOARD_ESP32_C6_147)
#include "../../../src/ui/widgets/ttgo_activity.cpp"
#endif
