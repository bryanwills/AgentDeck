#!/usr/bin/env python3
"""Scan for Divoom Timebox Mini (BLE variant) peripherals.

The BLE-variant Timebox Mini advertises its 11x11 LED screen as a BLE
peripheral named "TimeBox-mini-light" (the Classic audio endpoint shows up
separately as "TimeBox-mini-audio"). We surface every discovered peripheral but
flag and sort the Timebox light endpoints to the top, then print JSON so the
calling Node CLI can parse it. Mirrors bridge/src/idotmatrix/scan.py.
"""

import asyncio
import json
import sys

from bleak import BleakScanner

# Advertised name of the BLE screen endpoint (case-insensitive contains match).
TIMEBOX_NAME = "timebox-mini-light"


def _is_timebox(name: str) -> bool:
    return TIMEBOX_NAME in name.lower()


async def scan() -> None:
    devices = await BleakScanner.discover(timeout=5.0, return_adv=True)

    results = []
    for address, (device, adv) in devices.items():
        name = device.name or (adv.local_name if adv else None) or "Unknown"
        results.append({
            "name": name,
            "address": address,
            "rssi": adv.rssi if adv else None,
            "is_timebox": _is_timebox(name),
        })

    # Timebox light endpoints first, then strongest signal.
    results.sort(key=lambda x: (x["is_timebox"], x["rssi"] or -999), reverse=True)
    print(json.dumps(results))


def main() -> None:
    try:
        asyncio.run(scan())
    except Exception as e:  # noqa: BLE001 — surface as JSON for the CLI
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
