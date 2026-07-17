package dev.agentdeck.ui.monitor

import dev.agentdeck.state.GroupedEntry
import dev.agentdeck.state.TimelineEntry
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Day-break policy. Mirrors Swift `TimelineDayBreakTests` in
 * apple/AgentDeckTests/TimelineTests.swift — the two suites assert the same
 * cases so the platforms can't drift.
 */
class TimelineDayBreakTest {

    private val zone: ZoneId = ZoneId.of("Asia/Seoul")
    /** Fri 2026-07-17 14:30 KST. */
    private val now = at(2026, 7, 17, 14, 30)

    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int): Long =
        LocalDateTime.of(y, m, d, h, min).atZone(zone).toInstant().toEpochMilli()

    private fun groups(vararg timestamps: Long): List<GroupedEntry> =
        timestamps.map { GroupedEntry(TimelineEntry(timestamp = it, type = "chat_start", summary = "turn")) }

    @Test
    fun `all-today buffer gets no separator at all`() {
        val grouped = groups(at(2026, 7, 17, 9, 0), at(2026, 7, 17, 10, 0))
        assertNull(timelineDayBreakLabel(0, grouped, now, zone))
        assertNull(timelineDayBreakLabel(1, grouped, now, zone))
    }

    @Test
    fun `separator lands on the first row of the new day`() {
        val grouped = groups(at(2026, 7, 16, 23, 50), at(2026, 7, 17, 0, 10))
        assertEquals("YESTERDAY", timelineDayBreakLabel(0, grouped, now, zone))
        assertEquals("TODAY", timelineDayBreakLabel(1, grouped, now, zone))
    }

    @Test
    fun `index 0 anchors an older buffer but stays silent on today`() {
        assertEquals("WED, JUL 15", timelineDayBreakLabel(0, groups(at(2026, 7, 15, 9, 0)), now, zone))
        assertNull(timelineDayBreakLabel(0, groups(at(2026, 7, 17, 9, 0)), now, zone))
    }

    @Test
    fun `a day older than this year carries the year`() {
        val grouped = groups(at(2025, 12, 31, 9, 0), at(2026, 7, 17, 9, 0))
        assertEquals("DEC 31, 2025", timelineDayBreakLabel(0, grouped, now, zone))
        assertEquals("TODAY", timelineDayBreakLabel(1, grouped, now, zone))
    }

    @Test
    fun `same instant reads as a different day across zones`() {
        // 2026-07-17 08:30 KST == 2026-07-16 23:30 UTC. The separator must
        // follow the viewer's zone, not the stored epoch.
        val grouped = groups(at(2026, 7, 16, 23, 50), at(2026, 7, 17, 8, 30))
        assertEquals("TODAY", timelineDayBreakLabel(1, grouped, now, zone))
        assertNull(timelineDayBreakLabel(1, grouped, now, ZoneId.of("UTC")))
    }

    @Test
    fun `out-of-range index yields no separator`() {
        val grouped = groups(at(2026, 7, 17, 9, 0))
        assertNull(timelineDayBreakLabel(-1, grouped, now, zone))
        assertNull(timelineDayBreakLabel(1, grouped, now, zone))
    }
}
