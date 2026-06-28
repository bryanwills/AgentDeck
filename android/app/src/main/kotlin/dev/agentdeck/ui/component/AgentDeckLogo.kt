package dev.agentdeck.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentdeck.terrarium.TerrariumColors

/**
 * AgentDeck brand logo — bold monospace text + accent underline bar.
 * Two variants: e-ink (black on white, solid bar) and tablet (HUD text, neon cyan glow bar).
 */
@Composable
fun AgentDeckLogo(isEink: Boolean, modifier: Modifier = Modifier) {
    if (isEink) {
        EinkLogo(modifier)
    } else {
        TabletLogo(modifier)
    }
}

@Composable
private fun EinkLogo(modifier: Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Dome mark + wordmark, matching the macOS dashboard logo. Single-colour
        // (onSurface) so it threshes cleanly to 1-bit on e-ink panels.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AgentDeckMark(size = 24.dp, color = MaterialTheme.colorScheme.onSurface)
            Text(
                text = "AgentDeck",
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Spacer(modifier = Modifier.height(3.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth(0.8f)
                .height(2.dp)
                .background(
                    MaterialTheme.colorScheme.onSurface,
                    RoundedCornerShape(1.dp),
                ),
        )
    }
}

@Composable
private fun TabletLogo(modifier: Modifier) {
    val accentColor = Color(0xFF00E5FF) // Neon cyan

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Stacked-deck mark + wordmark, matching the menubar/iOS brand. The
        // deck glyph on the left gives users a recognizable AgentDeck shape
        // independent of the wordmark.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AgentDeckMark(size = 20.dp, color = accentColor)
            Text(
                text = "AgentDeck",
                color = TerrariumColors.HUDText,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            )
        }
        Spacer(modifier = Modifier.height(3.dp))
        // Glow layer (3dp, 30% opacity) + crisp bar (2dp)
        Box(
            modifier = Modifier
                .fillMaxWidth(0.8f)
                .height(5.dp)
                .drawBehind {
                    // Glow layer
                    drawRoundRect(
                        color = accentColor.copy(alpha = 0.30f),
                        topLeft = Offset.Zero,
                        size = Size(size.width, 3.dp.toPx()),
                        cornerRadius = CornerRadius(1.5.dp.toPx()),
                    )
                    // Crisp bar
                    drawRoundRect(
                        color = accentColor,
                        topLeft = Offset(0f, 3.dp.toPx()),
                        size = Size(size.width, 2.dp.toPx()),
                        cornerRadius = CornerRadius(1.dp.toPx()),
                    )
                },
        )
    }
}

/**
 * AgentDeck product mark — the glass dome over a button deck, the same
 * silhouette as the app icon. Geometry is a direct port of the canonical
 * Swift `AgentDeckLogo` (unit-space 0..24: dome curve, waterline, highlight,
 * deck base, three keys, two interior bubbles), so the menubar popup,
 * iOS/macOS dashboard, Android tablet HUD, and e-ink headers all show the
 * same mark. Only the tint varies per context. Replaces the older abstract
 * stacked-card mark, which looked unrelated to the icon.
 *
 * Usage:
 *   AgentDeckMark(size = 18.dp, color = TerrariumColors.TetraNeon)
 */
@Composable
fun AgentDeckMark(size: Dp = 20.dp, color: Color = TerrariumColors.HUDText) {
    Canvas(modifier = Modifier.size(size)) {
        val s = this.size.minDimension / 24f  // unit-space 0..24

        // Glass dome.
        val dome = Path().apply {
            moveTo(4.7f * s, 12.8f * s)
            cubicTo(5.3f * s, 4.9f * s, 18.7f * s, 4.9f * s, 19.3f * s, 12.8f * s)
        }
        drawPath(
            dome, color,
            style = Stroke(
                width = (1.55f * s).coerceAtLeast(1.0f),
                cap = StrokeCap.Round, join = StrokeJoin.Round,
            ),
        )
        // Waterline.
        val water = Path().apply {
            moveTo(6.1f * s, 11.2f * s)
            cubicTo(8.8f * s, 12.5f * s, 15.2f * s, 12.5f * s, 17.9f * s, 11.2f * s)
        }
        drawPath(
            water, color.copy(alpha = 0.58f),
            style = Stroke(
                width = (1.15f * s).coerceAtLeast(0.75f),
                cap = StrokeCap.Round, join = StrokeJoin.Round,
            ),
        )
        // Glass highlight.
        val highlight = Path().apply {
            moveTo(8.0f * s, 7.7f * s)
            cubicTo(10.0f * s, 5.7f * s, 13.2f * s, 5.4f * s, 15.8f * s, 6.1f * s)
        }
        drawPath(
            highlight, color.copy(alpha = 0.34f),
            style = Stroke(
                width = (0.9f * s).coerceAtLeast(0.6f),
                cap = StrokeCap.Round, join = StrokeJoin.Round,
            ),
        )
        // Button deck base.
        drawRoundRect(
            color = color.copy(alpha = 0.88f),
            topLeft = Offset(3.4f * s, 12.2f * s),
            size = Size(17.2f * s, 7.8f * s),
            cornerRadius = CornerRadius(2.2f * s, 2.2f * s),
            style = Stroke(
                width = (1.55f * s).coerceAtLeast(1.0f),
                cap = StrokeCap.Round, join = StrokeJoin.Round,
            ),
        )
        // Three deck keys, centre brightest.
        val keys = listOf(
            Triple(6.5f, 15.4f, 0.70f),
            Triple(10.4f, 15.4f, 0.92f),
            Triple(14.3f, 15.4f, 0.70f),
        )
        for ((kx, ky, alpha) in keys) {
            drawRoundRect(
                color = color.copy(alpha = alpha),
                topLeft = Offset(kx * s, ky * s),
                size = Size(3.1f * s, 2.0f * s),
                cornerRadius = CornerRadius(1.5f * s, 1.5f * s),
            )
        }
        // Interior bubbles.
        drawCircle(color = color.copy(alpha = 0.62f), radius = 0.95f * s, center = Offset(9.6f * s, 9.0f * s))
        drawCircle(color = color.copy(alpha = 0.42f), radius = 0.60f * s, center = Offset(14.8f * s, 8.2f * s))
    }
}
