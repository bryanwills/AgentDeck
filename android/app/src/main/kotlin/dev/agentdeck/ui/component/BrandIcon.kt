package dev.agentdeck.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser

/**
 * SVG-path brand icon for agent types — matches Apple SessionListPanel BrandIcon.
 *
 * Renders agent-type-specific brand marks (Claude sparkle, OpenAI knot, OpenClaw crayfish)
 * as Compose Canvas paths.
 *
 * Android's PathParser doesn't support SVG arc flag compression (e.g. `01` → `0 1`).
 * [fixArcFlags] preprocesses path data to insert spaces between compressed flag pairs.
 */
@Composable
fun BrandIcon(
    agentType: String?,
    isEink: Boolean = false,
    size: Dp = 13.dp,
    modifier: Modifier = Modifier,
    tint: Color? = null,
) {
    val spec = remember(agentType) { BrandIconSpec.fromAgentType(agentType) } ?: return
    val color = tint ?: if (isEink) spec.einkColor else spec.color
    val paths = remember(agentType) { spec.pathDataList.map { parseSvgPath(it) } }
    val rainbowBrush = remember(agentType, isEink, tint) {
        if (spec.rainbow && !isEink && tint == null) {
            Brush.linearGradient(
                colors = ANTIGRAVITY_RAINBOW,
                start = Offset(3f, 22f),
                end = Offset(22f, 2f),
            )
        } else {
            null
        }
    }

    Canvas(modifier = modifier.size(size)) {
        val s = this.size.minDimension / spec.viewBox
        // Pivot at the origin: the default (center) pivot shifts the scaled
        // path up-left by center*(s-1), pushing large icons out of their box.
        scale(s, s, pivot = Offset.Zero) {
            for (path in paths) {
                if (rainbowBrush != null) {
                    drawPath(path, rainbowBrush)
                } else {
                    drawPath(path, color)
                }
            }
        }
    }
}

private fun parseSvgPath(svgPathData: String): Path {
    val fixed = fixArcFlags(svgPathData)
    return PathParser.createPathFromPathData(fixed).asComposePath()
}

/**
 * Fix SVG arc flag compression for Android's PathParser.
 *
 * SVG spec allows arc flags (large-arc, sweep) to be concatenated without separators:
 * `a.527.527 0 110 1.055` — flags are `1` and `1`, dx=`0`.
 * Android's PathParser requires: `a.527.527 0 1 1 0 1.055`.
 *
 * Strategy: after consuming 3 arc params (rx, ry, rotation), the next two values
 * MUST be single-digit flags (0 or 1). If they appear concatenated, insert a space.
 */
private fun fixArcFlags(path: String): String {
    val sb = StringBuilder(path.length + 32)
    var i = 0
    while (i < path.length) {
        val ch = path[i]
        if (ch == 'a' || ch == 'A') {
            sb.append(ch)
            i++
            // Process arc parameter groups (there can be implicit repeats)
            while (i < path.length) {
                i = skipWhitespaceAndCommas(path, i)
                if (i >= path.length) break
                val next = path[i]
                // If we hit another command letter, stop
                if (next.isLetter() && next != 'e' && next != 'E') break

                // rx
                i = appendNumber(path, i, sb)
                // ry
                i = skipWhitespaceAndCommas(path, i)
                i = appendNumber(path, i, sb)
                // rotation
                i = skipWhitespaceAndCommas(path, i)
                i = appendNumber(path, i, sb)

                // large-arc-flag (must be 0 or 1)
                i = skipWhitespaceAndCommas(path, i)
                if (i < path.length && (path[i] == '0' || path[i] == '1')) {
                    sb.append(' ').append(path[i])
                    i++
                }

                // sweep-flag (must be 0 or 1)
                // May be concatenated with large-arc-flag — no separator needed from SVG spec
                i = skipWhitespaceAndCommas(path, i)
                if (i < path.length && (path[i] == '0' || path[i] == '1')) {
                    sb.append(' ').append(path[i])
                    i++
                }

                // dx
                i = skipWhitespaceAndCommas(path, i)
                i = appendNumber(path, i, sb)
                // dy
                i = skipWhitespaceAndCommas(path, i)
                i = appendNumber(path, i, sb)
            }
        } else {
            sb.append(ch)
            i++
        }
    }
    return sb.toString()
}

private fun skipWhitespaceAndCommas(s: String, start: Int): Int {
    var i = start
    while (i < s.length && (s[i] == ' ' || s[i] == ',' || s[i] == '\n' || s[i] == '\t')) i++
    return i
}

private fun appendNumber(s: String, start: Int, sb: StringBuilder): Int {
    var i = start
    if (i >= s.length) return i
    sb.append(' ')
    // Optional sign
    if (s[i] == '-' || s[i] == '+') {
        sb.append(s[i])
        i++
    }
    // Integer part
    while (i < s.length && s[i].isDigit()) {
        sb.append(s[i])
        i++
    }
    // Decimal part
    if (i < s.length && s[i] == '.') {
        sb.append('.')
        i++
        while (i < s.length && s[i].isDigit()) {
            sb.append(s[i])
            i++
        }
    }
    return i
}

/**
 * Canonical per-agent brand color, shared by rail consumer dots, session
 * list icons, attention theater badges, etc. Keep in sync with the iOS
 * `SessionBrand.color(for:)` switch and the D200H hardware color map.
 */
fun brandColorForAgent(agentType: String?): Color = when (agentType) {
    "claude-code" -> Color(0xFFC07058)
    "codex"       -> Color(0xFF6166E0)
    "codex-cli"   -> Color(0xFF6166E0)
    "codex-app"   -> Color(0xFF6166E0)
    "openclaw"    -> Color(0xFFFF4D4D)
    "opencode"    -> Color(0xFFF1ECEC)
    "antigravity" -> Color(0xFF5F6368)
    "daemon"      -> Color(0xFF8C8C99)
    else          -> Color(0xFF94A3B8)
}

/**
 * Human-readable brand name for an agentType id. The SINGLE Kotlin copy of this
 * map — mirror of shared/src/timeline-label.ts `agentDisplayLabel` and iOS
 * `SessionFormatters.displayAgentLabel`. Timeline surfaces (tablet strip, e-ink
 * panel) route through this instead of hand-rolling the switch. Never
 * abbreviate "OpenClaw" (see memory `brand-direction.md`). Returns "" for null
 * so callers can decide whether to show a fallback.
 */
fun agentDisplayLabel(agentType: String?): String = when (agentType) {
    "claude-code" -> "Claude"
    "codex", "codex-cli" -> "Codex CLI"
    "codex-app" -> "Codex App"
    "openclaw" -> "OpenClaw"
    "opencode" -> "OpenCode"
    "antigravity" -> "Antigravity"
    "monitor" -> "Monitor"
    "daemon" -> "Daemon"
    null -> ""
    else -> agentType.replace('-', ' ').replaceFirstChar { it.uppercase() }
}

private class BrandIconSpec(
    val pathDataList: List<String>,
    val viewBox: Float,
    val color: Color,
    val einkColor: Color,
    val rainbow: Boolean = false,
) {
    companion object {
        fun fromAgentType(agentType: String?): BrandIconSpec? = when (agentType) {
            "claude-code" -> BrandIconSpec(
                pathDataList = listOf(CLAUDE_PATH),
                viewBox = 24f,
                color = Color(0xFFC07058),  // terracotta
                einkColor = Color(0xFF333333),
            )
            // "codex" is the generic provider key emitted by codexLimitRows for the
            // LIMITS surfaces; "codex-cli"/"codex-app" are the session agent types.
            "codex", "codex-cli", "codex-app" -> BrandIconSpec(
                pathDataList = listOf(OPENAI_PATH),
                viewBox = 24f,
                color = Color(0xFF6166E0),  // indigo
                einkColor = Color(0xFF444444),
            )
            "openclaw" -> BrandIconSpec(
                pathDataList = OPENCLAW_PATHS,
                viewBox = 24f,
                color = Color(0xFFFF4D4D),  // red
                einkColor = Color(0xFF333333),
            )
            "opencode" -> BrandIconSpec(
                pathDataList = listOf(OPENCODE_PATH),
                viewBox = 24f,
                color = Color(0xFFF1ECEC),  // warm gray
                einkColor = Color(0xFF444444),
            )
            "antigravity" -> BrandIconSpec(
                pathDataList = listOf(ANTIGRAVITY_PATH),
                viewBox = 24f,
                color = Color(0xFF5F6368),
                einkColor = Color(0xFF444444),
                rainbow = true,
            )
            else -> null
        }
    }
}

private val ANTIGRAVITY_RAINBOW = listOf(
    Color(0xFF5CD64D),
    Color(0xFF1FC6B3),
    Color(0xFF3AC7EB),
    Color(0xFF247EFF),
    Color(0xFF666FE1),
    Color(0xFFB75CB6),
    Color(0xFFFF5241),
    Color(0xFFFF8410),
    Color(0xFFF5CB24),
)

// Claude Code mark — lobe-icons MIT (viewBox 0 0 24 24, grid pattern)
private const val CLAUDE_PATH =
    "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"

// OpenAI — knot mark / Codex CLI (viewBox 0 0 24 24)
private const val OPENAI_PATH =
    "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"

// OpenCode mark — lobe-icons MIT (viewBox 0 0 24 24, nested-square)
private const val OPENCODE_PATH =
    "M16 6H8v12h8V6zm4 16H4V2h16v20z"

// Antigravity mark — lobe-icons MIT (viewBox 0 0 24 24, peak/arc)
private const val ANTIGRAVITY_PATH =
    "M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"

// OpenClaw — front-facing crayfish multi-path (viewBox 0 0 24 24)
private val OPENCLAW_PATHS = listOf(
    "M9.046 7.104a.527.527 0 110 1.055.527.527 0 010-1.055z",
    "M15.376 7.104a.528.528 0 110 1.056.528.528 0 010-1.056z",
    "M16.877 1.912c.58-.27 1.14-.323 1.616-.037a.317.317 0 01-.326.542c-.227-.136-.547-.153-1.022.068-.352.165-.765.45-1.234.866 2.683 1.17 4.4 3.5 5.148 5.921a6.421 6.421 0 00-.704.184c-.578.016-1.174.204-1.502.735-.338.55-.268 1.276.072 2.069l.005.012.007.014c.523 1.045 1.318 1.91 2.2 2.284-.912 3.274-3.44 6.144-5.972 6.988v2.109h-2.11v-2.11c-1.043.417-2.086.01-2.11 0v2.11h-2.11v-2.11c-2.531-.843-5.061-3.713-5.973-6.987.882-.373 1.678-1.238 2.2-2.284l.007-.014.006-.012c.34-.793.41-1.518.071-2.069-.327-.531-.923-.719-1.503-.735a6.409 6.409 0 00-.704-.183c.749-2.421 2.466-4.751 5.149-5.922-.47-.416-.88-.701-1.234-.866-.474-.221-.794-.204-1.021-.068a.318.318 0 01-.435-.109.317.317 0 01.109-.433c.476-.286 1.036-.233 1.615.037.49.229 1.031.628 1.621 1.182A9.924 9.924 0 0112 2.568c1.199 0 2.284.19 3.256.526.59-.554 1.13-.953 1.62-1.182zM8.835 6.577a1.266 1.266 0 100 2.532 1.266 1.266 0 000-2.532zm6.33 0a1.267 1.267 0 100 2.533 1.267 1.267 0 000-2.533z",
    "M.395 13.118c-.966-1.932-.163-3.863 2.41-3.365v-.001l.05.01c.084.018.17.038.26.06.033.009.067.017.1.027.084.022.168.048.255.076l.09.027c.528 0 .95.158 1.16.501.212.343.212.87-.105 1.61-.085.17-.178.333-.276.489l-.01.017a4.967 4.967 0 01-.62.791l-.019.02c-1.092 1.117-2.496 1.336-3.295-.262z",
    "M21.193 9.753c2.574-.5 3.378 1.433 2.411 3.365-.58 1.159-1.476 1.361-2.342.96l-.011-.005a2.419 2.419 0 01-.114-.056l-.019-.01a2.751 2.751 0 01-.115-.067l-.023-.014c-.035-.022-.071-.044-.106-.068l-.05-.035c-.55-.388-1.062-1.007-1.44-1.76-.276-.647-.311-1.132-.174-1.472.176-.439.636-.639 1.23-.639.032-.011.066-.02.099-.03.08-.026.16-.05.238-.072l.117-.03a5.502 5.502 0 01.3-.067z",
)
