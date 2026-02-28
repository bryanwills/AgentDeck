package dev.agentdeck.ui.eink

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import dev.agentdeck.net.UsageUpdate

@Composable
fun EinkUsagePanel(
    usage: UsageUpdate,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Rate limit bars
        if (usage.fiveHourPercent != null) {
            EinkTextGauge(label = "5h", percent = usage.fiveHourPercent)
        }
        if (usage.sevenDayPercent != null) {
            EinkTextGauge(label = "7d", percent = usage.sevenDayPercent)
        }

        // Token counters
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "In: ${formatCount(usage.inputTokens)}",
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Out: ${formatCount(usage.outputTokens)}",
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Tool: ${usage.toolCalls}",
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Duration + cost
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = formatDuration(usage.sessionDurationSec),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (usage.estimatedCostUsd != null) {
                Text(
                    text = "$${String.format("%.4f", usage.estimatedCostUsd)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun EinkTextGauge(
    label: String,
    percent: Double,
) {
    val pct = percent.coerceIn(0.0, 100.0).toInt()
    val filled = (pct / 5).coerceAtMost(20)
    val empty = 20 - filled
    val bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)  // █ and ░

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "$label:",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = "[$bar] $pct%",
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * Compact single-line usage for portrait header.
 */
@Composable
fun EinkUsageCompact(
    usage: UsageUpdate,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (usage.fiveHourPercent != null) {
            val pct = usage.fiveHourPercent.coerceIn(0.0, 100.0).toInt()
            val filled = (pct / 10).coerceAtMost(10)
            val empty = 10 - filled
            val bar = "\u2588".repeat(filled) + "\u2591".repeat(empty)
            Text(
                text = "5h: [$bar] $pct%",
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Text(
            text = "Tok: ${formatCount(usage.inputTokens + usage.outputTokens)}",
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

private fun formatCount(n: Int): String = when {
    n >= 1_000_000 -> "%.1fM".format(n / 1_000_000.0)
    n >= 1_000 -> "%.1fK".format(n / 1_000.0)
    else -> n.toString()
}

private fun formatDuration(seconds: Int): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
