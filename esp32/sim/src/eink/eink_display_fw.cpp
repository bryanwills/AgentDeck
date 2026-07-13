// Unity-include wrapper for the real InkDeck e-ink render tree (direct-draw
// GxEPD2, no LVGL). Self-gated on BOARD_INKDECK. See fw/renderer.cpp for the
// per-env compilation rationale.
//
// The SimEink render entry point lives HERE (after the include) rather than in a
// separate file because the firmware's `display` object sits in eink_display.cpp's
// anonymous namespace — only code in this same translation unit can read the host
// framebuffer the GxEPD2_BW shim accumulated.
#include "../../../src/ui/eink/eink_display.cpp"

#ifdef BOARD_INKDECK
#include "../sim.h"
#include <Arduino.h>
#include <cstdlib>

// Panel bus instance (declared extern in the SPI shim). No real transfer on host.
SimSPIClass SPI;

bool SimEink::renderToPng(const char* scene, const char* path) {
  if (!SimScenes::apply(scene)) return false;
  Eink::init();
  // render() is content-hash + min-refresh-interval gated. In an --all run these
  // statics persist across scenes with millis() otherwise frozen, so advance the
  // virtual clock past the coalesce window and render twice to force a fresh draw.
  g_sim_millis += 3600;
  Eink::render();
  g_sim_millis += 3600;
  Eink::render();

  const uint8_t* buf = display.hostBuffer();   // anon-namespace global, visible here
  const int W = display.hostWidth(), H = display.hostHeight();
  if (!buf) return false;

  // 1-bit (0 = black ink, 1 = white paper) → RGB565 for the shared PNG writer.
  uint16_t* img = static_cast<uint16_t*>(std::malloc((size_t)W * H * sizeof(uint16_t)));
  if (!img) return false;
  for (int i = 0; i < W * H; i++) img[i] = buf[i] ? 0xFFFF : 0x0000;
  bool ok = SimPng::writeRgb565(path, img, W, H);
  std::free(img);
  return ok;
}
#endif  // BOARD_INKDECK
