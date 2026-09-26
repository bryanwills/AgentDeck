# 2026-09-27 — E-ink refresh completion measurements

The e-ink refresh choke point now emits a numeric completion event with its
refresh counter, actual full-refresh flag, monotonic start time and duration.
The Node serial owner retains only this exact numeric record. Painted text and
arbitrary serial chatter remain excluded. This makes consecutive refresh
intervals measurable for issue #272; aggregate uptime/counters cannot establish
interval percentiles. A completion means the panel driver returned, not optical
verification of the physical panel. Discard intervals across reboot, missing
counts or serial capture gaps.

NM-EPD-420 forces a full-color waveform. Its full-refresh counter now increments
after that override so every actual full cycle is counted. EPD47 records the
actual hard-clear decision rather than the caller's requested mode. The Swift
preview source hash is refreshed; no preview layout changed.

Validation: build and typecheck passed; 4,790 tests passed (2 skipped); protocol
generation left no drift; token mirrors agree. All three PlatformIO targets
(trmnl_75, lilygo_epd47, nm_epd_420) build with the arm64 PlatformIO environment.
Design lint reports the existing 92 violations outside these edits. Hardware
installation and physical-screen validation are separate from these build checks.
