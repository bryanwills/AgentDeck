// Unity-include wrapper for the compact TTGO/C6 overlay (state + activity strip).
// Only meaningful on those small SPI panels; empty TU elsewhere.
#if defined(BOARD_TTGO) || defined(BOARD_ESP32_C6_147)
#include "../../../src/ui/screens/ttgo_overlay.cpp"
#endif
