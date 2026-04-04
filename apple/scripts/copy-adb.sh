#!/bin/bash
# copy-adb.sh — Copy adb binary into app bundle during Xcode build.
# Searches standard Android SDK paths and copies to Contents/Helpers/.
# The binary is then ad-hoc re-signed so App Sandbox allows execution.

set -euo pipefail

if [ -z "${BUILT_PRODUCTS_DIR:-}" ] || [ -z "${CONTENTS_FOLDER_PATH:-}" ]; then
    echo "note: skipping adb bundle outside Xcode build environment"
    exit 0
fi

HELPERS_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Helpers"
DEST="${HELPERS_DIR}/adb"

# Skip if already present (incremental builds)
if [ -f "$DEST" ]; then
    echo "note: adb already bundled at $DEST"
    exit 0
fi

# Search for adb in standard locations
REAL_HOME="${HOME:-}"
if [ -z "$REAL_HOME" ] && command -v dscl >/dev/null 2>&1; then
    REAL_HOME=$(dscl . -read "/Users/$(whoami)" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
fi
if [ -z "$REAL_HOME" ]; then
    REAL_HOME="/Users/$(whoami)"
fi

CANDIDATES=(
    "${REAL_HOME}/Library/Android/sdk/platform-tools/adb"
    "${REAL_HOME}/Android/sdk/platform-tools/adb"
    "${REAL_HOME}/Library/Developer/Android/sdk/platform-tools/adb"
    "/opt/homebrew/bin/adb"
    "/usr/local/bin/adb"
)

ADB_SRC=""
for candidate in "${CANDIDATES[@]}"; do
    if [ -x "$candidate" ]; then
        ADB_SRC="$candidate"
        break
    fi
done

if [ -z "$ADB_SRC" ]; then
    echo "warning: adb not found — Android device support will be unavailable"
    exit 0
fi

mkdir -p "$HELPERS_DIR"
cp "$ADB_SRC" "$DEST"
chmod 755 "$DEST"

if [ "${CODE_SIGNING_ALLOWED:-NO}" = "YES" ]; then
    # Sign the adb binary with the same identity Xcode uses for the main app.
    # Xcode does NOT automatically sign binaries in Contents/Helpers/.
    SIGN_IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:-${CODE_SIGN_IDENTITY:--}}"
    codesign --force --sign "$SIGN_IDENTITY" --timestamp=none --generate-entitlement-der "$DEST" 2>/dev/null || \
    codesign --force --sign - "$DEST" 2>/dev/null || true
    echo "note: Bundled adb from $ADB_SRC → $DEST (signed with: $SIGN_IDENTITY)"
else
    echo "note: Bundled adb from $ADB_SRC → $DEST (codesign skipped)"
fi
