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

# Package with Elgato's official CLI, resolved from the pinned @elgato/cli
# devDependency rather than a globally-installed binary — Marketplace packaging
# has to be reproducible on a clean checkout and in CI. `.sdignore` excludes
# local logs, source maps, and development-only dependencies before the CLI
# validates the bundle.
rm -f "$OUTPUT_DIR/$PLUGIN_ID.streamDeckPlugin"
pnpm exec streamdeck validate "$PLUGIN_DIR"
pnpm exec streamdeck pack --force --no-update-check --output "$OUTPUT_DIR" "$PLUGIN_DIR"

echo ""
echo "Package created: dist/$PLUGIN_ID.streamDeckPlugin"
echo "Size: $(du -h "$OUTPUT_DIR/$PLUGIN_ID.streamDeckPlugin" | cut -f1)"
