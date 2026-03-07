package dev.agentdeck.ui.monitor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentdeck.state.TimelineEntry
import dev.agentdeck.terrarium.TerrariumColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Bottom HUD strip — "TIMELINE"
 * Shows recent events with auto-scroll, type-based color prefix.
 */
@Composable
fun TimelineStrip(
    entries: List<TimelineEntry>,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    val recentEntries = entries.takeLast(20)

    // Auto-scroll to bottom on new entries
    LaunchedEffect(recentEntries.size) {
        if (recentEntries.isNotEmpty()) {
            listState.animateScrollToItem(recentEntries.lastIndex)
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp),
    ) {
        Text(
            text = "TIMELINE",
            color = TerrariumColors.HUDSubtext,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(bottom = 4.dp),
        )

        if (recentEntries.isEmpty()) {
            Text(
                text = "No events yet",
                color = TerrariumColors.HUDSubtext,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
            )
        } else {
            LazyColumn(
                state = listState,
                verticalArrangement = Arrangement.spacedBy(2.dp),
                modifier = Modifier.weight(1f, fill = false),
            ) {
                items(recentEntries) { entry ->
                    TimelineRow(entry)
                }
            }
        }
    }
}

@Composable
private fun TimelineRow(entry: TimelineEntry) {
    val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    val timeStr = timeFormat.format(Date(entry.timestamp))
    val agentTag = agentTag(entry.agentType)
    val prefix = typePrefix(entry.type)
    val prefixColor = typeColor(entry.type)

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = timeStr,
                color = TerrariumColors.HUDSubtext.copy(alpha = 0.6f),
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = if (agentTag.isNotEmpty()) "$agentTag $prefix" else prefix,
                color = prefixColor,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = entry.summary,
                color = TerrariumColors.HUDText,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        if (!entry.detail.isNullOrEmpty() && entry.detail != entry.summary) {
            Text(
                text = entry.detail,
                color = TerrariumColors.HUDSubtext.copy(alpha = 0.7f),
                fontSize = 9.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 60.dp),
            )
        }
    }
}

private fun typePrefix(type: String): String = when (type) {
    "tool_request" -> "Tool"
    "tool_resolved" -> "Tool"
    "model_call" -> "Model"
    "model_response" -> "Model"
    "chat_response" -> "Response"
    "memory_recall" -> "Memory"
    "tool_exec" -> "Exec"
    "chat_start" -> "Chat"
    "chat_end" -> "Chat"
    "error" -> "Error"
    "state_change" -> "State"
    else -> "?"
}

private fun typeColor(type: String) = when (type) {
    "tool_request", "tool_resolved", "tool_exec" -> TerrariumColors.LEDGreen
    "model_call", "model_response" -> TerrariumColors.TetraNeon
    "chat_response" -> TerrariumColors.TetraNeon
    "memory_recall" -> TerrariumColors.ClaudeBody
    "chat_start", "chat_end" -> TerrariumColors.HUDText
    "error" -> TerrariumColors.LEDRed
    "state_change" -> TerrariumColors.LEDAmber
    else -> TerrariumColors.HUDSubtext
}

private fun agentTag(agentType: String?): String = when (agentType) {
    "claude-code" -> "Claude"
    "openclaw" -> "OpenClaw"
    null -> ""
    else -> "Agent"
}
