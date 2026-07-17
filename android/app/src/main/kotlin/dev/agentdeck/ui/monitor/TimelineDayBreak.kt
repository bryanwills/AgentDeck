package dev.agentdeck.ui.monitor

import dev.agentdeck.state.GroupedEntry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Label to render ABOVE the row at [index], or null when that row continues the
 * previous row's calendar day. Mirrors Swift `timelineDayBreakLabel`
 * (apple/AgentDeck/UI/Monitor/TimelineStripView.swift) — keep the two in sync.
 *
 * Index 0 is deliberately asymmetric: it emits a separator only when the oldest
 * visible row is NOT from today. A single-day buffer is the overwhelmingly
 * common case, and a "TODAY" banner atop a HUD strip this small is pure chrome;
 * a buffer that opens on an older day genuinely needs the anchor, because every
 * row below it shows only HH:mm.
 */
fun timelineDayBreakLabel(
    index: Int,
    grouped: List<GroupedEntry>,
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): String? {
    if (index < 0 || index >= grouped.size) return null
    val day = grouped[index].entry.timestamp.toLocalDate(zone)
    if (index == 0) {
        if (day == now.toLocalDate(zone)) return null
    } else {
        if (day == grouped[index - 1].entry.timestamp.toLocalDate(zone)) return null
    }
    return timelineDayLabel(day, now.toLocalDate(zone))
}

fun timelineDayLabel(day: LocalDate, today: LocalDate): String = when {
    day == today -> "TODAY"
    day == today.minusDays(1) -> "YESTERDAY"
    // Fixed US locale, matching the rest of this English-only HUD ("No events
    // yet"). A device-locale month name would also break the monospaced column
    // rhythm the strip is built on.
    day.year == today.year -> day.format(SAME_YEAR_FORMAT).uppercase(Locale.US)
    else -> day.format(OTHER_YEAR_FORMAT).uppercase(Locale.US)
}

private fun Long.toLocalDate(zone: ZoneId): LocalDate =
    Instant.ofEpochMilli(this).atZone(zone).toLocalDate()

private val SAME_YEAR_FORMAT = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US)
private val OTHER_YEAR_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
