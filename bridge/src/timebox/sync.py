#!/usr/bin/env python3
"""Sync AgentDeck frames to a Divoom Timebox Mini over Bluetooth SPP.

The device is paired separately with macOS as "TimeBox-Light"; macOS exposes
that RFCOMM endpoint as /dev/cu.*. This script writes Timebox protocol frames
directly to that serial file. It intentionally avoids PyBluez so it can run on
macOS with the existing AgentDeck Python venv.
"""

import argparse
import glob
import hashlib
import io
import json
import os
import signal
import sys
import termios
import time
import urllib.error
import urllib.request
from typing import Iterable

from PIL import Image as PilImage, ImageEnhance

DEFAULT_URL = "http://127.0.0.1:9120"
POLL_INTERVAL = 2.0
TIMEBOX_W = 11
TIMEBOX_H = 11
STATIC_IMAGE_CMD_LEN = 0x00BD


def discover_ports() -> list[str]:
    patterns = [
        "/dev/cu.*TimeBox*",
        "/dev/tty.*TimeBox*",
        "/dev/cu.*Timebox*",
        "/dev/tty.*Timebox*",
        "/dev/cu.*Divoom*",
        "/dev/tty.*Divoom*",
        "/dev/cu.*SPP*",
        "/dev/tty.*SPP*",
    ]
    ports: list[str] = []
    for pattern in patterns:
        for path in glob.glob(pattern):
            if path not in ports:
                ports.append(path)
    return sorted(ports)


def fetch_frame(url: str) -> bytes:
    endpoint = f"{url.rstrip('/')}/pixoo/frame?size=32"
    with urllib.request.urlopen(endpoint, timeout=3.0) as response:
        return response.read()


def fetch_display_state(url: str):
    endpoint = f"{url.rstrip('/')}/display-state"
    with urllib.request.urlopen(endpoint, timeout=1.0) as response:
        return json.loads(response.read().decode("utf-8"))


def display_brightness(url: str, normal_brightness: int) -> tuple[int, bool, str]:
    try:
        state = fetch_display_state(url)
    except Exception:
        return normal_brightness, False, f"unknown|{normal_brightness}"

    display_on = bool(state.get("displayOn", True))
    dim = state.get("dim") if isinstance(state.get("dim"), dict) else {}
    dim_enabled = dim.get("enabled", True)
    if not isinstance(dim_enabled, bool):
        dim_enabled = True
    dim_mode = "min" if dim.get("mode") == "min" else "off"
    try:
        dim_level = int(dim.get("level", 10))
    except (TypeError, ValueError):
        dim_level = 10
    dim_level = max(0, min(100, dim_level))
    signature = f"{display_on}|{dim_enabled}|{dim_mode}|{dim_level}|{normal_brightness}"

    if display_on or not dim_enabled:
        return normal_brightness, False, signature
    return (dim_level if dim_mode == "min" else 0), True, signature


def clamp_nibble(value: int) -> int:
    return max(0, min(15, value))


def encode_image_bytes(img: PilImage.Image, brightness: int) -> bytes:
    try:
        resample = PilImage.Resampling.BOX
    except AttributeError:
        resample = PilImage.BOX

    img = img.convert("RGB").resize((TIMEBOX_W, TIMEBOX_H), resample)
    if brightness > 0:
        img = ImageEnhance.Brightness(img).enhance(1.6 * (brightness / 100.0))
        img = ImageEnhance.Contrast(img).enhance(1.25)
    else:
        img = PilImage.new("RGB", (TIMEBOX_W, TIMEBOX_H), (0, 0, 0))

    nibbles: list[int] = []
    px = img.load()
    for y in range(TIMEBOX_H):
        for x in range(TIMEBOX_W):
            r, g, b = px[x, y]
            nibbles.extend([
                clamp_nibble(round(r / 17)),
                clamp_nibble(round(g / 17)),
                clamp_nibble(round(b / 17)),
            ])

    out = bytearray()
    it = iter(nibbles)
    for low in it:
        high = next(it, 0)
        out.append(low | (high << 4))
    if len(out) != 182:
        raise ValueError(f"encoded Timebox image has {len(out)} bytes, expected 182")
    return bytes(out)


def escape_message(data: Iterable[int]) -> bytes:
    out = bytearray()
    out.append(0x01)
    for b in data:
        if b in (0x01, 0x02, 0x03):
            out.append(0x03)
            out.append(b + 0x03)
        else:
            out.append(b)
    out.append(0x02)
    return bytes(out)


def build_static_image_packet(image_bytes: bytes) -> bytes:
    cmd = bytes([
        STATIC_IMAGE_CMD_LEN & 0xFF,
        (STATIC_IMAGE_CMD_LEN >> 8) & 0xFF,
        0x44,
        0x00,
        0x0A,
        0x0A,
        0x04,
    ]) + image_bytes
    if len(cmd) != STATIC_IMAGE_CMD_LEN:
        raise ValueError(f"command length {len(cmd)} != {STATIC_IMAGE_CMD_LEN}")
    checksum = sum(cmd) & 0xFFFF
    return escape_message(cmd + bytes([checksum & 0xFF, (checksum >> 8) & 0xFF]))


def make_offline_image() -> PilImage.Image:
    img = PilImage.new("RGB", (TIMEBOX_W, TIMEBOX_H), (0, 0, 0))
    px = img.load()
    for i in range(TIMEBOX_W):
        px[i, 0] = (12, 0, 0)
        px[i, TIMEBOX_H - 1] = (12, 0, 0)
        px[0, i] = (12, 0, 0)
        px[TIMEBOX_W - 1, i] = (12, 0, 0)
    for i in range(3, 8):
        px[i, i] = (15, 0, 0)
        px[TIMEBOX_W - 1 - i, i] = (15, 0, 0)
    return img


def open_port(path: str) -> int:
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        attrs = termios.tcgetattr(fd)
        attrs[0] = 0
        attrs[1] = 0
        attrs[2] = attrs[2] | termios.CLOCAL | termios.CREAD
        attrs[3] = 0
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
    except Exception:
        pass
    try:
        os.set_blocking(fd, True)
    except Exception:
        pass
    return fd


def write_packet(fd: int, packet: bytes) -> None:
    total = 0
    while total < len(packet):
        total += os.write(fd, packet[total:])


def send_image(fd: int, img: PilImage.Image, brightness: int) -> None:
    packet = build_static_image_packet(encode_image_bytes(img, brightness))
    write_packet(fd, packet)


def run(port_path: str, url: str, brightness: int, once: bool = False) -> None:
    print(f"Starting Timebox Mini sync: {port_path} <- {url} brightness={brightness}%")
    fd: int | None = None
    last_hash = ""
    stop = False

    def handle_stop(_signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    while not stop:
        try:
            if fd is None:
                print(f"Opening Timebox serial port {port_path}...")
                fd = open_port(port_path)
                time.sleep(0.3)

            current_brightness, dimmed, display_sig = display_brightness(url, brightness)
            try:
                frame_data = fetch_frame(url)
                frame_hash = hashlib.sha256(frame_data + display_sig.encode("utf-8")).hexdigest()
                if frame_hash != last_hash:
                    img = PilImage.open(io.BytesIO(frame_data))
                    send_image(fd, img, current_brightness)
                    last_hash = frame_hash
                    print(f"Frame sent ({frame_hash[:8]}, brightness={current_brightness}%, dimmed={dimmed})")
            except urllib.error.URLError as e:
                offline_hash = f"offline|{brightness}"
                print(f"Bridge offline: {e}")
                if last_hash != offline_hash:
                    send_image(fd, make_offline_image(), brightness)
                    last_hash = offline_hash

            if once:
                return
            time.sleep(POLL_INTERVAL)
        except Exception as e:
            print(f"Timebox sync error: {e}", file=sys.stderr)
            if fd is not None:
                try:
                    os.close(fd)
                except Exception:
                    pass
                fd = None
            if once:
                raise
            time.sleep(3.0)

    if fd is not None:
        try:
            send_image(fd, make_offline_image(), brightness)
        except Exception:
            pass
        os.close(fd)


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentDeck Timebox Mini sync")
    parser.add_argument("--port-path", help="Bluetooth SPP serial path, e.g. /dev/cu.TimeBox-Light-SPPDev")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"AgentDeck bridge URL (default: {DEFAULT_URL})")
    parser.add_argument("--brightness", type=int, default=100, help="Software brightness 0-100")
    parser.add_argument("--list-ports", action="store_true", help="List likely Timebox serial ports")
    parser.add_argument("--once", action="store_true", help="Send one frame and exit")
    args = parser.parse_args()

    if args.list_ports:
        print(json.dumps(discover_ports()))
        return

    if not args.port_path:
        ports = discover_ports()
        if not ports:
            print("No Timebox serial port found. Pair TimeBox-Light first or pass --port-path.", file=sys.stderr)
            sys.exit(1)
        args.port_path = ports[0]

    if args.brightness < 0 or args.brightness > 100:
        print("Brightness must be between 0 and 100.", file=sys.stderr)
        sys.exit(1)

    run(args.port_path, args.url, args.brightness, args.once)


if __name__ == "__main__":
    main()
