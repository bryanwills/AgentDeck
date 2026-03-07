package dev.agentdeck.ui.eink

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentdeck.state.DashboardState
import dev.agentdeck.util.formatBytes
import dev.agentdeck.util.formatResetTime

/**
 * E-ink status display — "Instrument Panel" with arc gauges.
 * Side-by-side dials (thick strokes for e-ink), labels below.
 * Both sections left-aligned.
 */
@Composable
fun EinkStatusCompact(
    state: DashboardState,
    modifier: Modifier = Modifier,
) {
    val usage = state.usage
    val staleSuffix = if (usage.usageStale == true) " !" else ""

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val isWide = maxWidth > 700.dp
        // Adaptive dial size: ~55% of available height, clamped to reasonable range
        val dialSize = (maxHeight * 0.55f).coerceIn(32.dp, 54.dp)

        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 1.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Left: Rate Limits — side-by-side dials
            Column(
                modifier = Modifier.weight(0.30f).fillMaxHeight(),
            ) {
                SectionHeader("LIMITS")
                Spacer(Modifier.height(1.dp))
                if (state.billingType == "api") {
                    DataText("API Key")
                } else {
                    // Dials side by side
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        if (usage.fiveHourPercent != null) {
                            ArcGaugeWithLabel(
                                percent = usage.fiveHourPercent,
                                label = "5h$staleSuffix",
                                resetTime = usage.fiveHourResetsAt,
                                size = dialSize,
                            )
                        }
                        if (usage.sevenDayPercent != null) {
                            ArcGaugeWithLabel(
                                percent = usage.sevenDayPercent,
                                label = "7d$staleSuffix",
                                resetTime = usage.sevenDayResetsAt,
                                size = dialSize,
                            )
                        }
                    }
                    // Extra usage
                    val extraPct = usage.extraUsageUtilization
                    if (extraPct != null && usage.extraUsageEnabled == true) {
                        Text(
                            text = "Ex ${(extraPct * 100).toInt()}%",
                            fontSize = 9.sp,
                            lineHeight = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color.DarkGray,
                        )
                    }
                }
            }

            // Right: Models
            Column(
                modifier = Modifier.weight(0.70f).fillMaxHeight(),
            ) {
                SectionHeader("MODELS")
                Spacer(Modifier.height(1.dp))
                ModelsSection(state)
            }
        }
    }
}

// -- Arc gauge with label + reset below ---------------------------------------

@Composable
private fun ArcGaugeWithLabel(
    percent: Double,
    label: String,
    resetTime: String?,
    size: Dp,
) {
    val fillFraction = (percent / 100.0).coerceIn(0.0, 1.0).toFloat()
    // Percentage font scales with dial size
    val pctFontSize = if (size >= 44.dp) 12.sp else if (size >= 36.dp) 11.sp else 10.sp
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier.size(size),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                // Stroke scales with dial: ~7% track, ~15% fill
                val strokeTrack = (this.size.width * 0.07f).coerceIn(2.dp.toPx(), 4.dp.toPx())
                val strokeFill = (this.size.width * 0.15f).coerceIn(4.dp.toPx(), 8.dp.toPx())
                val pad = strokeFill / 2f
                val arcSize = androidx.compose.ui.geometry.Size(
                    this.size.width - pad * 2,
                    this.size.height - pad * 2,
                )
                val topLeft = androidx.compose.ui.geometry.Offset(pad, pad)
                drawArc(
                    color = Color.LightGray,
                    startAngle = 135f,
                    sweepAngle = 270f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeTrack),
                )
                drawArc(
                    color = Color.Black,
                    startAngle = 135f,
                    sweepAngle = 270f * fillFraction,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeFill),
                )
            }
            Text(
                text = "${percent.toInt()}%",
                fontSize = pctFontSize,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = Color.Black,
            )
        }
        // Label + reset on one compact line
        val suffix = resetTime?.let { " ${formatResetTime(it)}" } ?: ""
        Text(
            text = "$label$suffix",
            fontSize = 8.sp,
            lineHeight = 10.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.DarkGray,
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
    }
}

// -- Models -------------------------------------------------------------------

@Composable
private fun ModelsSection(state: DashboardState) {
    val lines = mutableListOf<String>()

    val catalog = state.modelCatalog
    if (state.oauthConnected == true) {
        if (catalog != null && catalog.isNotEmpty()) {
            val names = catalog.filter { it.available }.map { it.name }
            lines.add("OAuth: ${names.joinToString(", ")}")
        } else {
            lines.add("OAuth: connected")
        }
    } else if (state.oauthConnected == false) {
        lines.add("OAuth: disconnected")
    }

    val ollama = state.ollamaStatus
    if (ollama != null && ollama.available && ollama.models.isNotEmpty()) {
        val models = ollama.models.map { m ->
            val sizeStr = when {
                m.sizeVram > 0 -> " ${formatBytes(m.sizeVram)}"
                m.size > 0 -> " ${formatBytes(m.size)}"
                else -> ""
            }
            "${m.name}$sizeStr"
        }
        lines.add("Ollama: ${models.joinToString(", ")}")
    }

    if (lines.isNotEmpty()) {
        Text(
            text = lines.joinToString("\n"),
            fontSize = 11.sp,
            lineHeight = 14.sp,
            fontFamily = FontFamily.Monospace,
            color = Color.Black,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// -- Shared -------------------------------------------------------------------

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        fontSize = 10.sp,
        lineHeight = 12.sp,
        fontWeight = FontWeight.Bold,
        fontFamily = FontFamily.Monospace,
        letterSpacing = 1.sp,
        color = Color.DarkGray,
    )
}

@Composable
private fun DataText(text: String) {
    Text(
        text = text,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        fontFamily = FontFamily.Monospace,
        color = Color.Black,
    )
}
