package dev.agentdeck.terrarium

import androidx.core.graphics.PathParser

/**
 * Canonical creature vector geometry — single source of truth shared by the
 * high-fidelity Compose tablet renderer ([dev.agentdeck.terrarium.creature]) and
 * the low-fidelity e-ink renderer ([dev.agentdeck.terrarium.renderer.EinkRenderer]).
 *
 * Previously each surface duplicated these SVG path strings (OctopusCreature,
 * CrayfishCreature, AgentMark, and a manually-transcribed copy in EinkRenderer),
 * which let the e-ink/ESP32 silhouettes drift from the canonical robot/crayfish.
 *
 * The raw `*_PATH_DATA` strings are the source. Compose surfaces parse them with
 * `androidx.compose.ui.graphics.vector.PathParser`; the e-ink native Canvas uses
 * the cached `android.graphics.Path` accessors below (built via
 * `androidx.core.graphics.PathParser`, which produces an `android.graphics.Path`).
 */
object CreatureGeometry {

    // --- Octopus / Claude Code robot (claudecode.svg, viewBox 0 0 24 24) ---
    // fill-rule: evenodd — the two inner rects are transparent eye cutouts.
    const val OCTOPUS_VIEWBOX = 24f
    const val OCTOPUS_PATH_DATA =
        "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"

    // --- Antigravity peak/arc mark (design/brand/antigravity.svg, viewBox 0 0 24 24) ---
    // Upward double-peak / mountain arc silhouette. SSOT mirror of
    // shared/src/svg-renderers/agent-logos.ts ANTIGRAVITY_PATH.
    const val ANTIGRAVITY_VIEWBOX = 24f
    const val ANTIGRAVITY_PATH_DATA =
        "M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"

    // --- Crayfish / OpenClaw (openclaw.svg terrarium creature, viewBox 0 0 120 120) ---
    const val CRAYFISH_VIEWBOX = 120f
    const val CRAYFISH_BODY_PATH_DATA =
        "M60 10c-30 0-45 25-45 45s15 40 30 45v10h10v-10s5 2 10 0v10h10v-10c15-5 30-25 30-45S90 10 60 10"
    const val CRAYFISH_LEFT_CLAW_PATH_DATA =
        "M20 45C5 40 0 50 5 60s15 5 20-5c3-7 0-10-5-10"
    const val CRAYFISH_RIGHT_CLAW_PATH_DATA =
        "M100 45c15-5 20 5 15 15s-15 5-20-5c-3-7 0-10 5-10"
    const val CRAYFISH_LEFT_ANTENNA_PATH_DATA = "M45 15Q35 5 30 8"
    const val CRAYFISH_RIGHT_ANTENNA_PATH_DATA = "M75 15Q85 5 90 8"

    /** Claw pivot points in the 120×120 viewBox (where each claw attaches to the body). */
    const val CRAYFISH_LEFT_CLAW_PIVOT_X = 20f
    const val CRAYFISH_LEFT_CLAW_PIVOT_Y = 45f
    const val CRAYFISH_RIGHT_CLAW_PIVOT_X = 100f
    const val CRAYFISH_RIGHT_CLAW_PIVOT_Y = 45f

    // --- Cached native android.graphics.Path (e-ink Canvas) ---

    val octopusNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(OCTOPUS_PATH_DATA).apply {
            fillType = android.graphics.Path.FillType.EVEN_ODD
        }
    }

    val antigravityNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(ANTIGRAVITY_PATH_DATA)
    }

    val crayfishBodyNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(CRAYFISH_BODY_PATH_DATA)
    }
    val crayfishLeftClawNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(CRAYFISH_LEFT_CLAW_PATH_DATA)
    }
    val crayfishRightClawNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(CRAYFISH_RIGHT_CLAW_PATH_DATA)
    }
    val crayfishLeftAntennaNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(CRAYFISH_LEFT_ANTENNA_PATH_DATA)
    }
    val crayfishRightAntennaNativePath: android.graphics.Path by lazy {
        PathParser.createPathFromPathData(CRAYFISH_RIGHT_ANTENNA_PATH_DATA)
    }
}
