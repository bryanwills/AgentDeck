#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCREENSHOTS="$ROOT/apple/appstore-submission/screenshots"
METADATA="$ROOT/docs/appstore-metadata-draft.md"

failures=0

fail() {
  echo "ERROR: $*" >&2
  failures=$((failures + 1))
}

dimension() {
  local file="$1"
  local width height
  width="$(sips -g pixelWidth "$file" 2>/dev/null | awk '/pixelWidth/{print $2}')"
  height="$(sips -g pixelHeight "$file" 2>/dev/null | awk '/pixelHeight/{print $2}')"
  echo "${width}x${height}"
}

validate_platform() {
  local platform="$1"
  local accepted="$2"
  local directory="$SCREENSHOTS/$platform"
  local files=()

  while IFS= read -r file; do files+=("$file"); done < <(find "$directory" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) | sort)

  if (( ${#files[@]} < 1 || ${#files[@]} > 10 )); then
    fail "$platform requires 1–10 screenshots; found ${#files[@]}"
    return
  fi

  local seen_hashes=""
  for file in "${files[@]}"; do
    local size hash
    size="$(dimension "$file")"
    if [[ " $accepted " != *" $size "* ]]; then
      fail "$platform/$(basename "$file") has unsupported dimensions $size"
    else
      echo "OK: $platform/$(basename "$file") ($size)"
    fi
    if [[ "$(sips -g hasAlpha "$file" 2>/dev/null | awk '/hasAlpha/{print $2}')" != "no" ]]; then
      fail "$platform/$(basename "$file") must be an opaque screenshot without alpha"
    fi
    hash="$(shasum -a 256 "$file" | awk '{print $1}')"
    if [[ " $seen_hashes " == *" $hash "* ]]; then
      fail "$platform contains a duplicate screenshot: $(basename "$file")"
    fi
    seen_hashes+=" $hash"
  done
}

validate_platform "macOS" "1280x800 1440x900 2560x1600 2880x1800"
validate_platform "iPhone" "1320x2868 2868x1320 1290x2796 2796x1290 1284x2778 2778x1284"
validate_platform "iPad" "2064x2752 2752x2064 2048x2732 2732x2048"

python3 - "$METADATA" <<'PY' || failures=$((failures + 1))
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
limits = {
    "App Name": 30,
    "Subtitle": 30,
    "Promotional Text": 170,
    "Description": 4000,
    "Keywords": 100,
    "What's New": 4000,
}
errors = []
for language, start, end in (
    ("ko", "## 🇰🇷 Korean", "## 🇺🇸 English"),
    ("en", "## 🇺🇸 English", "## Screenshot Guidance"),
):
    section = text.split(start, 1)[1].split(end, 1)[0]
    for field, limit in limits.items():
        match = re.search(rf"^### {re.escape(field)}[^\n]*\n\n```\n(.*?)\n```", section, re.M | re.S)
        if not match:
            errors.append(f"{language}: missing {field}")
            continue
        value = match.group(1)
        length = len(value)
        if length > limit:
            errors.append(f"{language}: {field} is {length}/{limit} characters")
        else:
            print(f"OK: {language} {field} ({length}/{limit})")
    field_values = "\n".join(re.findall(r"```\n(.*?)\n```", section, re.S))
    forbidden = re.search(r"\b(?:ADB|PTY|Android|agentdeck CLI|Node(?:\.js)? daemon|external daemon)\b", field_values, re.I)
    if forbidden:
        errors.append(f"{language}: App Store metadata contains non-Swift-tier term {forbidden.group(0)!r}")
    if "16-display" in field_values or "16개 디스플레이" in field_values:
        errors.append(f"{language}: stale 16-display preview count")
if errors:
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    raise SystemExit(1)
PY

for plist in "$ROOT/apple/AgentDeck/Resources/Info.plist" "$ROOT/apple/AgentDeck/Resources/Info-macOS.plist"; do
  value="$(/usr/libexec/PlistBuddy -c 'Print :ITSAppUsesNonExemptEncryption' "$plist" 2>/dev/null || true)"
  [[ "$value" == "false" ]] || fail "$(basename "$plist") must set ITSAppUsesNonExemptEncryption=false"
done

privacy="$ROOT/apple/AgentDeck/Resources/PrivacyInfo.xcprivacy"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSPrivacyTracking' "$privacy")" == "false" ]] || fail "Privacy manifest must disable tracking"
privacy_dump="$(/usr/libexec/PlistBuddy -c 'Print :NSPrivacyCollectedDataTypes' "$privacy")"
[[ "$privacy_dump" == *"NSPrivacyCollectedDataTypeOtherUserContent"* ]] || fail "Privacy manifest must declare Other User Content"
[[ "$privacy_dump" == *"NSPrivacyCollectedDataTypeProductInteraction"* ]] || fail "Privacy manifest must declare Product Interaction"
[[ "$(grep -c '<true/>' "$privacy")" -eq 2 ]] || fail "Only the two collected data types should be linked"

icon="$ROOT/apple/AgentDeck/Resources/Assets.xcassets/AppIcon.appiconset/icon_1024x1024.png"
[[ "$(dimension "$icon")" == "1024x1024" ]] || fail "App Store icon must be 1024x1024"
[[ "$(sips -g hasAlpha "$icon" 2>/dev/null | awk '/hasAlpha/{print $2}')" == "no" ]] || fail "App Store icon must not contain alpha"

if [[ "${1:-}" == "--network" ]]; then
  for url in \
    "https://puritysb.github.io/AgentDeck/#privacy" \
    "https://github.com/puritysb/AgentDeck" \
    "https://github.com/puritysb/AgentDeck/issues"; do
    curl --fail --location --silent --show-error --max-time 15 --output /dev/null "$url" || fail "URL is not reachable: $url"
  done
fi

if (( failures > 0 )); then
  echo "App Store submission validation failed with $failures error(s)." >&2
  exit 1
fi

echo "App Store submission package passes validation."
