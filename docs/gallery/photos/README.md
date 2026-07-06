# Device gallery photos

Drop one image per device here and it appears automatically on the
[device gallery](../index.html) (GitHub Pages `/gallery/`). Until a file exists,
its card shows the diagonal-hatch placeholder with the expected filename.

## How it works

Each gallery card has an `<img src="photos/<slug>.jpg" onerror="this.remove()">`
layered over a placeholder. If the file loads it covers the placeholder; if it's
missing the `onerror` removes the `<img>` and the placeholder shows through. No
code change needed to add a photo — just add the file with the matching slug.

If you shoot `.png` or `.webp` instead of `.jpg`, update that card's `<img src>`
extension in `docs/gallery/index.html`.

## Slugs

| Slug | Device |
|---|---|
| `ips35` | ESP32 IPS 3.5" |
| `amoled18` | ESP32 Round AMOLED 1.8" |
| `box86` | ESP32 86 Box 4" |
| `ttgo` | TTGO T-Display 1.14" |
| `ips10` | ESP32 IPS 10.1" |
| `inkdeck` | InkDeck e-ink (experimental) |
| `xteink-x3` | XTeink X3 (experimental) |
| `pixoo64` | Divoom Pixoo64 |
| `tc001` | Ulanzi TC001 |
| `idotmatrix` | iDotMatrix 32×32 |
| `timebox-mini` | Divoom Timebox Mini |
| `d200h` | Ulanzi D200H |
| `streamdeck-plus` | Elgato Stream Deck+ |
| `streamdeck-15` | Elgato Stream Deck (15-key) |
| `macos` | AgentDeck on macOS (screenshot) |
| `ios` | AgentDeck on iOS / iPadOS (screenshot) |
| `android-eink` | AgentDeck on an Android e-ink reader (screenshot) |
| `android-tablet` | AgentDeck on an Android tablet (screenshot) |
| `tui` | TUI dashboard (screenshot) |

## Shooting guidance

- **Landscape**, roughly **4:3** — cards crop to 4:3 with `object-fit: cover`.
- Show the device **displaying an AgentDeck session** where possible.
- Keep the background calm; the site palette is warm sand (`--tide-50`).
- Reasonable size (≈ 1600px wide, optimized JP/WebP) — these ship in the repo.
