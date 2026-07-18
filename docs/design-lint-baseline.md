# Design Lint Baseline

Snapshot of the violation count for files under `lint.sh`'s scope (see [DESIGN.md](../DESIGN.md), [design/lint.sh](../design/lint.sh)). Used by CI as a regression gate — PRs that raise the count above this baseline fail.

Run `bash design/lint.sh` to see the current count. Run `bash design/lint.sh --json > audit.json` for machine-readable output. Exit code = total violations (0 = clean).

## Current snapshot

<!-- Updated 2026-07-18 after replacing the legacy docs hub with the token-driven design-system viewer. -->

Total: **89 violations** across **3 rules**.

| Rule | Count | Meaning |
|---|---|---|
| `R1_pure_white_black` | 2 | Pure `#fff` / `#000` — should use `--tide-50` / `--ink-900` |
| `R2_hardcoded_hex` | 82 | Hardcoded hex outside token files |
| `R7_arbitrary_radius` | 5 | `border-radius` outside `{0, 4, 8, 10, 12, 14, 16, 18, 999}` |

## Top offenders

| File | Total | Notes |
|---|---|---|
| `docs/appstore-migration-diagram.html` | 61 | Off-product flowchart with generic Tailwind palette; not a UI surface — skip-rule candidate |
| `docs/design/Design System.html` | 23 | Legacy design guide intentionally displays raw colour swatches; the Pages viewer reads the canonical token file instead |
| `docs/design/Design Audit.html` | 3 | Legacy design reference page |

## Migration policy

1. **New code uses tokens.** `var(--ink-900)` in CSS, `DesignTokens.Ink.s900` in Swift/Kotlin, named imports from `@agentdeck/shared` in TS.
2. **Existing pages migrate as they are touched.** When editing one of the offender files, swap the hex values you encounter while you're there.
3. **Don't sweep-refactor for token compliance.** Each surface has its own visual signature — converting shadows/radii without a designer-in-the-loop drifts the look. Visual review required.

## Token-defining files (lint allowlist)

The lint script exempts these from the raw-hex rule because they ARE the source of token values. Drift inside them is caught by `python3 design/verify-tokens-sync.py`, not by lint:

- `design/tokens.css` — canonical SSOT
- `design/tokens.js` — browser mirror (loaded by mockup HTMLs)
- `design/components.css`, `design/patterns.css`, `design/icons.jsx` — design system styles
- `docs/design/creatures.jsx` — embeds upstream brand SVGs (DESIGN.md §6.1 forbids redrawing)
- `apple/AgentDeck/Resources/apme-dashboard.html` — embedded HTML resource, manual mirror of token primitives in its `:root`
- `docs/hardware/index.html`, `scripts/pages-index.html`, `docs/site/index.html`, `docs/gallery/index.html` — published GitHub Pages surfaces and compatibility redirects with a self-contained `:root` warm-token mirror
- `plugin/bound.serendipity.agentdeck.sdPlugin/ui/design-tokens.css` — Stream Deck Property Inspector mirror

When CSS tokens change, every file in the second half of the list (the manual mirrors) must be hand-synced.

## Excluded directories

`lint.sh` skips: `node_modules`, `.git`, `.github`, `dist`, `coverage`, `generated`, `.zig-cache`, `.zig-global-cache`, `apple/build`, `android/app/build`, `apple/AgentDeck/Resources/agentdeck-runtime`, `docs/design-mockups`, `plugin/.../bin`, `esp32/.pio`, `esp32/robot/results`, `tools/creature-simulator`, plus the file `sdpi-components.js` (vendored).

## Wiring `lint.sh` into pre-commit (baseline-aware)

The simple `bash design/lint.sh || exit 1` gate fails until the baseline reaches zero. The baseline-aware version below blocks regressions only:

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/usr/bin/env bash
set -e
# 1. Token sync MUST pass — drift here is always a bug.
python3 design/verify-tokens-sync.py >/dev/null

# 2. Lint count must not exceed baseline.
BASELINE=$(grep -m1 -oE 'Total: \*\*[0-9]+ violations\*\*' docs/design-lint-baseline.md \
           | grep -oE '[0-9]+')
CURRENT=$(bash design/lint.sh --json 2>/dev/null \
          | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
if [ "$CURRENT" -gt "$BASELINE" ]; then
  echo "Design lint regression: $CURRENT > baseline $BASELINE"
  bash design/lint.sh
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
```

CI runs the same logic in `.github/workflows/design-system.yml` — see that file for the canonical implementation.

## History

- **2026-05-09** — Foundation install. Baseline 111.
- **2026-05-10** — Phase 2 hotspot migration. apme-dashboard.html (11 → 0) + plugin PI HTMLs (7 → 0) + Motion pulse/wiggle tokens added to CSS. Baseline 93.
- **2026-07-18** — Legacy docs hub replaced by the token-driven design-system viewer. Baseline 89.
