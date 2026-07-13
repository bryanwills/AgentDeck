// Unity-include wrapper for the real per-board screen builder. aquariumCreate()
// assembles exactly what each board shows — Terrarium+HUD (box/ips35/amoled),
// Office (IPS10), or the compact TTGO overlay — so the sim renders the true
// composed screen, not a hand-assembled approximation. See fw/renderer.cpp for
// the per-env compilation rationale.
#include "../../../src/ui/screens/aquarium.cpp"
