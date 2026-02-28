package dev.agentdeck.ui.eink

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.agentdeck.net.AgentState

@Composable
fun EinkStatusPanel(
    agentState: AgentState,
    projectName: String?,
    modelName: String?,
    agentType: String?,
    currentTool: String?,
    toolProgress: String?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // State marker with text prefix
        Text(
            text = stateMarker(agentState),
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = if (agentState == AgentState.PROCESSING) FontWeight.Bold else FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSurface,
        )

        // Project name
        if (projectName != null) {
            Text(
                text = projectName,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Agent type + model
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (agentType != null) {
                Text(
                    text = agentType,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (modelName != null) {
                Text(
                    text = modelName,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Current tool (during processing)
        if (currentTool != null && agentState == AgentState.PROCESSING) {
            Text(
                text = buildString {
                    append("> ")
                    append(currentTool)
                    if (toolProgress != null) {
                        append(" (")
                        append(toolProgress)
                        append(")")
                    }
                },
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

private fun stateMarker(state: AgentState): String = when (state) {
    AgentState.IDLE -> "\u25CF IDLE"                          // ●
    AgentState.PROCESSING -> "\u25C9 PROCESSING"              // ◉
    AgentState.AWAITING_PERMISSION -> "\u26A0 PERMISSION"     // ⚠
    AgentState.AWAITING_OPTION -> "\u25C7 SELECT"             // ◇
    AgentState.AWAITING_DIFF -> "\u25A1 DIFF REVIEW"          // □
    AgentState.DISCONNECTED -> "\u25CB DISCONNECTED"          // ○
}
