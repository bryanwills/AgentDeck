package dev.agentdeck.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
        Text(
            text = "AgentDeck",
            style = MaterialTheme.typography.headlineSmall.copy(
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            ),
            color = MaterialTheme.colorScheme.onSurface,
        )
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
        Text(
            text = "AgentDeck",
            color = TerrariumColors.HUDText,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
        )
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
