# Hardware capture archive

Source photographs for the device cards on the public Devices catalog
(`docs/hardware/index.html`) and the hardware sections of `README.md`.
Captured 2026-07-19.

`scripts/crop-hardware-images.mjs` reads this directory by default and writes the
cropped results into `docs/media/`. Both the sources and the crops are committed,
so re-framing a card never depends on files outside the repository:

```bash
node scripts/crop-hardware-images.mjs              # from this archive
node scripts/crop-hardware-images.mjs ~/some/dir   # from raw camera originals
```

## Why these files differ from the camera originals

- **EXIF rotation is baked in.** The originals carry orientation tag 6 on many
  frames — stored 4032×3024 while the photo is really 3024×4032 portrait. Every
  file here is already upright, so the crop table's coordinates are plain
  display-space pixels and no orientation handling is needed to read them. This
  removes the failure that produced a round of unusable crops: passing an
  explicit angle to sharp's `.rotate()` skips the EXIF tag and crops from the
  unrotated buffer.
- **Re-encoded at quality 78** (mozjpeg), which halves the archive to ~15 MB at
  full capture resolution. The card outputs are at most 2400 px wide, so the
  downscale absorbs the difference — verified against the originals at 2×
  magnification on the most detail-sensitive card (InkDeck's e-ink text).

Filenames keep their original `IMG_####` identity so each row of the crop table
maps to a capture one-to-one.

## Not from the camera set

- `waveshare-147-source.jpg` — the Waveshare LCD 1.47" was never photographed in
  the session set. This is a hand-cropped screenshot, the only capture of that
  board, so it is passed through with just the card frame applied.
