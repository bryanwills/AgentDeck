#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGIN_DIR="$PROJECT_DIR/plugin/bound.serendipity.agentdeck.sdPlugin"
OUTPUT_DIR="$PROJECT_DIR/dist"
PLUGIN_ID="bound.serendipity.agentdeck"

# Build in production mode (strips debug logs from plugin)
echo "Building project (production)..."
cd "$PROJECT_DIR"
SDC_PROD=1 pnpm build

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Create .streamDeckPlugin file (it's just a zip).
# Elgato rejects the package with "No manifest.json found in package" unless
# the .sdPlugin folder is the zip's single top-level entry — zipping the
# folder *contents* at root fails integrity check. Also exclude logs/ so
# local dev log files (tens of MB) don't bloat the distribution.
cd "$PROJECT_DIR/plugin"
rm -f "$OUTPUT_DIR/$PLUGIN_ID.streamDeckPlugin"

zip -r "$OUTPUT_DIR/$PLUGIN_ID.streamDeckPlugin" "$PLUGIN_ID.sdPlugin" \
  -x "$PLUGIN_ID.sdPlugin/node_modules/*" \
  -x "$PLUGIN_ID.sdPlugin/logs/*" \
  -x "*/.DS_Store" \
  -x "*/*.log" \
  -x "*/*.log.*"

echo ""
echo "Package created: dist/$PLUGIN_ID.streamDeckPlugin"
echo "Size: $(du -h "$OUTPUT_DIR/$PLUGIN_ID.streamDeckPlugin" | cut -f1)"
