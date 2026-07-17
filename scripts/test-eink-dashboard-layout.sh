#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bin="${TMPDIR:-/tmp}/agentdeck-eink-layout-test"
"${CXX:-c++}" -std=c++11 -Wall -Wextra -Werror \
  -I esp32/src \
  esp32/sim/tests/eink_dashboard_layout_test.cpp \
  -o "$bin"
"$bin"
echo "e-ink dashboard layout: ok"
