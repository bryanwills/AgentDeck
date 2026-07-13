// Unity-include wrapper for the TC001 matrix page renderer. The firmware source
// is self-gated on BOARD_LED8X32, so this compiles to an empty TU for LCD envs.
// See src/fw/renderer.cpp for why the firmware sources are pulled in through the
// sim's own src/ (per-env objects) rather than a build_src_filter ../.. path.
#include "../../../src/ui/matrix/matrix_pages.cpp"
