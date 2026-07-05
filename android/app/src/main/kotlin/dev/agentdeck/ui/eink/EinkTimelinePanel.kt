package dev.agentdeck.ui.eink

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentdeck.state.TimelineEntry
import dev.agentdeck.state.groupConsecutive
import dev.agentdeck.state.timelineDisplayGroups
import dev.agentdeck.ui.component.BrandIcon
import dev.agentdeck.ui.component.agentDisplayLabel
import dev.agentdeck.ui.timeline.stripMarkdownInline
import dev.agentdeck.ui.timeline.timelineIconKey
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * E-ink timeline — **latest-activity view, no scroll**.
 *
 * Product decision (2026-07-05): the e-ink device is a glance surface. It does
 * not need a scrollable history — it needs to answer "what is happening right
 * now, and who is doing it" at a look. So this panel renders ONLY the single
 * most recent meaningful timeline entry, large and explicitly attributed
 * (agent brand + project + task + activity text). No LazyColumn, no "▼ NEW"
 * affordance, no partial-refresh ghosting from a moving list.
 *
 * E-ink rules still apply: black on white only, no animation, bracket ASCII
 * status glyph (high 1-bit coverage).
 */
@Composable
fun EinkTimelinePanel(
    entries: List<TimelineEntry>,
    modifier: Modifier = Modifier,
) {
    // Newest meaningful group. groupConsecutive+displayGroups drops low-signal
    // rows and merges a turn's chat_start/response, so `.last()` is the current
    // work unit rather than a stray tool row.
    val latest = remember(entries) {
        timelineDisplayGroups(groupConsecutive(entries.takeLast(40))).lastOrNull()?.entry
    }
    // Resolve the enclosing task label (task_start.summary) for a turn row so
    // "which task" shows even though the turn row itself only carries taskId.
    val taskLabel = remember(entries, latest) {
        val e = latest ?: return@remember null
        when {
            e.type == "task_start" || e.type == "task_end" -> e.summary.takeIf { it.isNotBlank() }
            e.taskId != null -> entries.lastOrNull { it.type == "task_start" && it.taskId == e.taskId }
                ?.summary?.takeIf { it.isNotBlank() }
            else -> null
        }
    }

    Box(modifier = modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
        if (latest == null) {
            Text(
                text = "IDLE — no active work",
                color = Color.Black,
                fontSize = 16.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.align(Alignment.Center),
            )
        } else {
            EinkLatestActivity(latest, taskLabel)
        }
    }
}

@Composable
private fun EinkLatestActivity(entry: TimelineEntry, taskLabel: String?) {
    val tight = TextStyle(platformStyle = PlatformTextStyle(includeFontPadding = false))
    val iconKey = timelineIconKey(entry.type, entry.status)
    val agent = agentDisplayLabel(entry.agentType)
    val project = entry.projectName?.takeIf { it.isNotBlank() }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // ── Attribution header: brand glyph + agent + status marker ──
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!entry.agentType.isNullOrBlank()) {
                BrandIcon(agentType = entry.agentType, isEink = true, modifier = Modifier.size(28.dp))
            }
            Text(
                text = agent.ifEmpty { "Agent" },
                color = Color.Black,
                fontSize = 20.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = FontFamily.Monospace,
                style = tight,
            )
            Text(
                text = iconKey.einkGlyph,
                color = Color.Black,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                style = tight,
            )
            Text(
                text = formatTime(entry.timestamp),
                color = Color.Black,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                style = tight,
                modifier = Modifier.weight(1f),
            )
        }

        // ── project · task context line ──
        val context = listOfNotNull(project, taskLabel).joinToString("  ·  ")
        if (context.isNotEmpty()) {
            Text(
                text = context,
                color = Color.Black,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = tight,
            )
        }

        // ── the current activity text, large ──
        Text(
            text = entry.summary,
            color = Color.Black,
            fontSize = 22.sp,
            fontWeight = FontWeight.Normal,
            maxLines = 5,
            overflow = TextOverflow.Ellipsis,
            style = tight,
        )

        // ── optional one-line detail ──
        entry.detail
            ?.takeIf { it.isNotBlank() && entry.summaryKind != "none" && entry.summaryKind != "progress" }
            ?.let { detail ->
                val plain = stripMarkdownInline(detail).replace("\n", " ").trim()
                if (plain.isNotEmpty()) {
                    Text(
                        text = plain,
                        color = Color.Black,
                        fontSize = 14.sp,
                        fontStyle = FontStyle.Italic,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        style = tight,
                    )
                }
            }
    }
}

private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

private fun formatTime(timestamp: Long): String = timeFormat.format(Date(timestamp))
