#!/usr/bin/env python3
"""Compose App Store marketing screenshots from raw app captures.

    python3 scripts/compose-appstore-screenshots.py            # all platforms
    python3 scripts/compose-appstore-screenshots.py macOS

Reads the raw captures written by `capture-appstore-screenshots.sh` from
`apple/appstore-submission/screenshots-raw/<platform>/` and writes captioned,
framed versions to `.../screenshots/<platform>/` — the directory the submission
validator checks — at exactly the same pixel
dimensions (the raw sizes are already App Store-legal).

App Review safety, deliberately:
  * The app UI is shown unmodified — only inset, never redrawn or retouched.
  * Captions describe capabilities this build actually has. Nothing claims the
    Claude quota gauge or device-bridge tiers that need the external daemon.
  * No Apple hardware bezel or product likeness is drawn. A neutral rounded
    card is used instead, which avoids both the "wrong device frame" rejection
    and Apple's product-image trademark rules.
  * Type and colour come from the aquarium-tide marketing palette
    (design/tokens.css) via the repo's own IBM Plex Sans, so the store page
    matches the site rather than inventing a second brand.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "apple" / "appstore-submission" / "screenshots-raw"
SHOTS = ROOT / "apple" / "appstore-submission" / "screenshots"
FONT_BOLD = ROOT / "bridge" / "assets" / "fonts" / "IBMPlexSans-Bold.ttf"
FONT_REG = ROOT / "bridge" / "assets" / "fonts" / "IBMPlexSans-Regular.ttf"

# design/tokens.css — marketing surfaces only (never the --ui-* set).
INK_900 = (0x0E, 0x1F, 0x1F)
INK_800 = (0x15, 0x30, 0x2F)
INK_700 = (0x1F, 0x45, 0x44)
TIDE_50 = (0xF5, 0xF3, 0xEC)
TIDE_300 = (0xA8, 0xB0, 0x9A)
KELP_300 = (0x6F, 0xB6, 0xA8)
AMBER_500 = (0xC8, 0x92, 0x3A)

# Caption per capture beat. Keyed by the file stem written by the capture
# script. Accent tints the eyebrow line only.
CAPTIONS = {
    "01-fleet": (
        "Every coding agent,\none calm surface",
        "Claude Code, Codex, OpenCode and OpenClaw — side by side, live.",
        KELP_300,
    ),
    "02-all-sessions": (
        "Five sessions,\none timeline",
        "Deselect a session and every agent's activity streams together.",
        KELP_300,
    ),
    "03-attention": (
        "Know the moment\nyou're needed",
        "Amber means an agent is waiting on you. Nothing else animates.",
        AMBER_500,
    ),
    "04-complete": (
        "Work lands.\nThe tank goes quiet.",
        "Finished sessions settle to the floor, so calm is a visible state.",
        KELP_300,
    ),
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def wrap_lines(text: str) -> list[str]:
    return [line for line in text.split("\n")]


def rounded_shadow(size: tuple[int, int], radius: int, blur: int) -> Image.Image:
    """Soft drop shadow for the inset app card."""
    shadow = Image.new("L", size, 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=190
    )
    return shadow.filter(ImageFilter.GaussianBlur(blur))


def round_corners(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, image.size[0] - 1, image.size[1] - 1], radius=radius, fill=255
    )
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def vertical_wash(size: tuple[int, int]) -> Image.Image:
    """Deep-water gradient: ink-900 at the edges, ink-700 through the middle."""
    width, height = size
    base = Image.new("RGB", (1, height))
    px = base.load()
    for y in range(height):
        t = y / max(1, height - 1)
        # ease toward the lighter ink in the upper third, back down after
        k = 1 - abs(t - 0.33) * 1.7
        k = max(0.0, min(1.0, k))
        px[0, y] = tuple(
            int(INK_900[i] + (INK_700[i] - INK_900[i]) * k) for i in range(3)
        )
    return base.resize((width, height))


def compose(raw_path: Path, out_path: Path) -> None:
    stem = raw_path.stem
    if stem not in CAPTIONS:
        return
    headline, sub, accent = CAPTIONS[stem]

    shot = Image.open(raw_path).convert("RGB")
    W, H = shot.size
    portrait = H > W

    canvas = vertical_wash((W, H))
    draw = ImageDraw.Draw(canvas)

    # Layout scales off the short edge so phone, tablet and desktop all read
    # the same weight.
    unit = min(W, H)
    margin = int(unit * 0.062)
    eyebrow_size = int(unit * (0.023 if portrait else 0.020))
    head_size = int(unit * (0.058 if portrait else 0.046))
    sub_size = int(unit * (0.026 if portrait else 0.021))

    f_eyebrow = font(FONT_BOLD, eyebrow_size)
    f_head = font(FONT_BOLD, head_size)
    f_sub = font(FONT_REG, sub_size)

    y = margin

    # Eyebrow rule + product name.
    draw.text((margin, y), "AGENTDECK", font=f_eyebrow, fill=accent)
    y += int(eyebrow_size * 1.9)

    head_lines = wrap_lines(headline)
    for line in head_lines:
        draw.text((margin, y), line, font=f_head, fill=TIDE_50)
        y += int(head_size * 1.16)

    y += int(sub_size * 0.5)
    draw.text((margin, y), sub, font=f_sub, fill=TIDE_300)
    y += int(sub_size * 2.0)

    # Inset the untouched app capture, scaled to fill the remaining space.
    avail_h = H - y - margin
    avail_w = W - margin * 2
    scale = min(avail_w / W, avail_h / H)
    card_w, card_h = int(W * scale), int(H * scale)
    card = shot.resize((card_w, card_h), Image.LANCZOS)
    radius = int(unit * 0.022)

    cx = (W - card_w) // 2
    cy = y

    shadow = rounded_shadow((card_w, card_h), radius, int(unit * 0.018))
    shadow_layer = Image.new("RGB", (card_w, card_h), INK_900)
    canvas.paste(shadow_layer, (cx, cy + int(unit * 0.008)), shadow)

    rounded = round_corners(card, radius)
    canvas.paste(rounded, (cx, cy), rounded)

    # Hairline so the card separates from the wash on dark UI edges.
    ImageDraw.Draw(canvas).rounded_rectangle(
        [cx, cy, cx + card_w - 1, cy + card_h - 1],
        radius=radius,
        outline=INK_800,
        width=max(1, int(unit * 0.0018)),
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path)
    print(f"composed {out_path.relative_to(ROOT)} ({W}x{H})")


def main() -> int:
    platforms = sys.argv[1:] or ["macOS", "iPhone", "iPad"]
    for platform in platforms:
        raw_dir = RAW / platform
        if not raw_dir.is_dir():
            print(f"skip {platform}: no captures", file=sys.stderr)
            continue
        out_dir = SHOTS / platform
        for raw in sorted(raw_dir.glob("*.png")):
            compose(raw, out_dir / raw.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
