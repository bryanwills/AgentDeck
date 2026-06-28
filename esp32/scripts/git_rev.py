"""PlatformIO pre-build script: inject the git short-hash and build epoch as
compile-time macros so every firmware image can report exactly which source it
was built from.

Without this, device_info only carries the static FIRMWARE_VERSION string
(config.h), which is bumped rarely — a device flashed from old source still
self-reports the same version, so "is the latest deployed?" is unanswerable.
The injected GIT_SHA makes that verifiable: a device's reported buildHash can be
compared against `git rev-parse --short=8 HEAD`.

Defines provided to the firmware:
  GIT_SHA      string, e.g. "a1b2c3d4" (or "a1b2c3d4-dirty" with uncommitted changes)
  BUILD_EPOCH  unix seconds at compile time

Falls back to "unknown"/0 when git is unavailable (CI tarball, exported source).
"""

import subprocess
import time

Import("env")  # noqa: F821 — provided by SCons/PlatformIO


def _git(*args):
    return (
        subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)
        .strip()
        .decode("utf-8", "replace")
    )


def _git_sha():
    try:
        sha = _git("rev-parse", "--short=8", "HEAD")
        if not sha:
            return "unknown"
        # Mark working-tree modifications so a hot-patched build is never
        # mistaken for the clean commit it was based on.
        if _git("status", "--porcelain"):
            sha += "-dirty"
        return sha
    except Exception:
        return "unknown"


sha = _git_sha()
epoch = int(time.time())

env.Append(
    CPPDEFINES=[
        ("GIT_SHA", env.StringifyMacro(sha)),
        ("BUILD_EPOCH", epoch),
    ]
)

print("[git_rev] GIT_SHA=%s BUILD_EPOCH=%d" % (sha, epoch))
