package dev.agentdeck.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.agentdeck.net.ModelCatalogEntry
import dev.agentdeck.state.AgentStateHolder
import dev.agentdeck.state.SessionMetrics
import dev.agentdeck.ui.component.TokenCounter
import dev.agentdeck.ui.component.UsageGauge
import dev.agentdeck.ui.eink.formatDuration
import dev.agentdeck.ui.eink.formatDurationLong
import dev.agentdeck.ui.theme.AgentDeckColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun UsageScreen(
    stateHolder: AgentStateHolder,
    isEink: Boolean,
) {
    val state by stateHolder.state.collectAsState()
    val usage = state.usage
    val metrics by SessionMetrics.instance.metrics.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Usage",
            style = MaterialTheme.typography.headlineMedium,
        )

        // Rate limit gauges
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = "Rate Limits",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                UsageGauge(label = "5-Hour", percent = usage.fiveHourPercent)
                if (usage.fiveHourResetsAt != null) {
                    Text(
                        text = "Resets at ${formatTimestamp(usage.fiveHourResetsAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                UsageGauge(label = "7-Day", percent = usage.sevenDayPercent)
                if (usage.sevenDayResetsAt != null) {
                    Text(
                        text = "Resets at ${formatTimestamp(usage.sevenDayResetsAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        // Extra usage section
        if (usage.extraUsageEnabled == true) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = "Extra Usage",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (usage.extraUsageMonthlyLimit != null) {
                        InfoRow(
                            label = "Monthly limit",
                            value = "$${String.format("%.2f", usage.extraUsageMonthlyLimit)}",
                        )
                    }
                    if (usage.extraUsageUsedCredits != null) {
                        InfoRow(
                            label = "Used",
                            value = "$${String.format("%.2f", usage.extraUsageUsedCredits)}",
                        )
                    }
                    if (usage.extraUsageUtilization != null) {
                        UsageGauge(
                            label = "Utilization",
                            percent = usage.extraUsageUtilization,
                        )
                    }
                }
            }
        }

        // Session tokens
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = "Session",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                // Uptime from SessionMetrics
                val connectedSince = metrics.connectedSince
                val uptimeText = if (connectedSince != null) {
                    val elapsed = System.currentTimeMillis() - connectedSince
                    formatDurationLong(elapsed)
                } else {
                    formatDuration(usage.sessionDurationSec)
                }
                InfoRow(label = "Uptime", value = uptimeText)

                TokenCounter(label = "Input tokens", count = usage.inputTokens)
                TokenCounter(label = "Output tokens", count = usage.outputTokens)
                TokenCounter(label = "Tool calls", count = usage.toolCalls)

                if (usage.estimatedCostUsd != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    InfoRow(
                        label = "Estimated cost",
                        value = "$${String.format("%.4f", usage.estimatedCostUsd)}",
                        valueStyle = MaterialTheme.typography.titleMedium,
                    )
                }

                if (metrics.reconnectCount > 0) {
                    InfoRow(
                        label = "Reconnects",
                        value = "${metrics.reconnectCount}",
                    )
                }
            }
        }

        // Model catalog (OpenClaw)
        val catalog = state.modelCatalog
        if (!catalog.isNullOrEmpty()) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Models",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    catalog.forEach { entry ->
                        ModelRow(entry)
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
    valueStyle: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.labelLarge,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = valueStyle,
        )
    }
}

@Composable
private fun ModelRow(entry: ModelCatalogEntry) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = entry.name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (entry.role != null) {
                Text(
                    text = entry.role,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Text(
            text = if (entry.available) "\u2713" else "\u2717",
            style = MaterialTheme.typography.bodyMedium,
            color = if (entry.available) AgentDeckColors.Green else AgentDeckColors.SlateText,
        )
    }
}

private val timeFormatter = SimpleDateFormat("HH:mm", Locale.US)

private fun formatTimestamp(epochMs: Long): String {
    return timeFormatter.format(Date(epochMs))
}

