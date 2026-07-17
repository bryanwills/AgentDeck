#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source_file="esp32/src/ui/eink/eink_dashboard_layout.h"
target_repo="${XTEINK_REPO:-../crosspoint-agentdeck}"
target_file="$target_repo/src/agentdeck/eink_dashboard_layout.h"

if [[ "${1:-}" == "--check" ]]; then
  cmp -s "$source_file" "$target_file" || {
    echo "XTeink e-ink layout mirror is stale: $target_file" >&2
    exit 1
  }
  echo "XTeink e-ink layout mirror: up to date"
  exit 0
fi

cp "$source_file" "$target_file"
echo "Synced $source_file -> $target_file"
