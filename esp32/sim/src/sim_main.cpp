// AgentDeck ESP32 host simulator — entry point.
//
// Drives the real firmware terrarium renderer against a headless LVGL display
// and dumps board-accurate PNG frames. Because the render sources are compiled
// verbatim with the target board's defines (SCREEN_W/H + BOARD_*), the output is
// pixel-exact with what the physical panel shows — not a hand-drawn approximation.
//
// Usage:
//   sim_native [--scene NAME] [--frames N] [--out PATH] [--label NAME]
//   sim_native --all [--frames N] [--outdir DIR] [--label NAME]
#include "sim.h"
#include "config.h"
#include "ui/terrarium/renderer.h"

#include <Arduino.h>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <vector>

namespace {

constexpr uint32_t FRAME_MS = 33;               // ~30fps
constexpr float    FRAME_DT = FRAME_MS / 1000.0f;

// Advance the terrarium `frames` steps from a freshly-seeded clock, then capture.
bool renderScene(const char* scene, const char* path, int frames) {
  if (!SimScenes::apply(scene)) {
    std::fprintf(stderr, "[sim] unknown scene '%s' (have: %s)\n", scene, SimScenes::catalog());
    return false;
  }
  randomSeed(0xA6E7DECC);  // deterministic frames per run
  g_sim_millis = 0;
  for (int i = 0; i < frames; i++) {
    SimDisplay::tick(FRAME_MS);
    Terrarium::render(FRAME_DT);
    SimDisplay::refresh();
  }
  bool ok = SimPng::writeRgb565(path, SimDisplay::framebuffer(),
                                SimDisplay::width(), SimDisplay::height());
  std::fprintf(stderr, "[sim] %-11s → %s (%dx%d, %d frames) %s\n",
               scene, path, SimDisplay::width(), SimDisplay::height(), frames,
               ok ? "ok" : "FAILED");
  return ok;
}

const char* arg(int argc, char** argv, const char* key, const char* def) {
  for (int i = 1; i < argc - 1; i++)
    if (std::strcmp(argv[i], key) == 0) return argv[i + 1];
  return def;
}
bool flag(int argc, char** argv, const char* key) {
  for (int i = 1; i < argc; i++)
    if (std::strcmp(argv[i], key) == 0) return true;
  return false;
}

}  // namespace

int main(int argc, char** argv) {
  const char* label = arg(argc, argv, "--label", "box_86");
  int frames = std::atoi(arg(argc, argv, "--frames", "90"));  // 3s settle
  if (frames < 1) frames = 1;

  // The display resolution is fixed at compile time by the board's SCREEN_W/H
  // build flags — the sim IS that board minus hardware I/O.
  SimDisplay::init(SCREEN_W, SCREEN_H);
  Terrarium::init(SimDisplay::screen());

  if (flag(argc, argv, "--all")) {
    const char* outdir = arg(argc, argv, "--outdir", "sim-out");
    const char* scenes[] = {"empty", "idle", "working", "multi", "permission"};
    bool allOk = true;
    for (const char* s : scenes) {
      std::string path = std::string(outdir) + "/" + label + "-" + s + ".png";
      allOk &= renderScene(s, path.c_str(), frames);
    }
    return allOk ? 0 : 1;
  }

  const char* scene = arg(argc, argv, "--scene", "working");
  std::string def = std::string("sim-out/") + label + "-" + scene + ".png";
  const char* out = arg(argc, argv, "--out", def.c_str());
  return renderScene(scene, out, frames) ? 0 : 1;
}
