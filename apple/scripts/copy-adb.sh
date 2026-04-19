#!/bin/bash
# copy-adb.sh — Build-step no-op for the App Store build.
#
# Earlier revisions of this script bundled `adb`, a host `node`, and the
# Node.js bridge runtime into `Contents/Helpers/` and `Contents/Resources/`
# so the legacy CLI/Homebrew macOS GUI build could spawn helpers from
# inside the .app. That distribution is no longer maintained — the macOS
# target ships exclusively through the App Store, and Apple Review
# Guideline 2.5.2 forbids bundling executables we'd then spawn.
#
# Android tunnelling, OpenClaw CLI logs, and the bundled D200H helper now
# live in the Node.js bridge that users install separately from npm. The
# postCompileScript in `apple/project.yml` still invokes this file so the
# Xcode build graph stays valid; the body is intentionally empty.
#
# `verify-appstore-archive.sh` continues to assert that none of the old
# helper paths reappear in the shipped archive.

set -euo pipefail
exit 0
