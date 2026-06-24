"""Shared plumbing for AgentDeck BLE LED-matrix sync clients (iDotMatrix, Timebox Mini).

Both clients poll the same daemon HTTP surface (`/pixoo/frame`, `/display-state`), apply
the same host-display dim resolution, and self-exit when orphaned. Only the genuinely
identical plumbing lives here — the device-specific bits (BLE transport, frame encoding,
offline/farewell handling, and the dim FLOORS) stay in each client.

Imported by sibling scripts via a sys.path insert (they run from bridge/src/<device>/),
so this module must stay dependency-free beyond the stdlib.
"""

import json
import urllib.request

DEFAULT_URL = "http://127.0.0.1:9120"
POLL_INTERVAL = 1.5  # seconds; balanced for BLE bandwidth
# If the bridge stays unreachable this long, the daemon that spawned us is gone
# (crash / SIGKILL / sleep-kill / launchd) — the client should exit cleanly after
# leaving the panel in a safe state instead of looping forever as an orphan that
# holds the single-central BLE link hostage.
BRIDGE_GONE_EXIT_SEC = 30.0


def http_get_bytes(url: str, timeout: float = 3.0) -> bytes:
    """Blocking GET returning the raw body (frame bytes)."""
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def fetch_display_state(url: str, timeout: float = 1.0):
    """Fetch host display dim state from the AgentDeck daemon (blocking)."""
    endpoint = f"{url.rstrip('/')}/display-state"
    with urllib.request.urlopen(endpoint, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def resolve_display_brightness(display_state, normal_brightness, *, off_floor, level_floor):
    """Return (effective brightness, dimmed, signature) for the current host state.

    `off_floor`   — brightness used when the display is off and dim mode is 'off'.
    `level_floor` — minimum the configured dim 'level' is clamped to.

    iDotMatrix firmware accepts 5-100 (floors = 5); the Timebox bakes brightness into
    the encoded frame and 0 == a fully blank panel (floors = 0). The signature lets the
    caller detect host-state transitions and force a re-encode/re-push at the new level.
    """
    if not isinstance(display_state, dict):
        return normal_brightness, False, f"on|true|off|10|{normal_brightness}"

    display_on = bool(display_state.get("displayOn", True))
    dim = display_state.get("dim") if isinstance(display_state.get("dim"), dict) else {}
    dim_enabled = dim.get("enabled", True)
    if not isinstance(dim_enabled, bool):
        dim_enabled = True
    dim_mode = "min" if dim.get("mode") == "min" else "off"
    try:
        dim_level = int(dim.get("level", 10))
    except (TypeError, ValueError):
        dim_level = 10
    dim_level = max(level_floor, min(100, dim_level))
    signature = f"{display_on}|{dim_enabled}|{dim_mode}|{dim_level}|{normal_brightness}"

    if display_on or not dim_enabled:
        return normal_brightness, False, signature
    return (dim_level if dim_mode == "min" else off_floor), True, signature
