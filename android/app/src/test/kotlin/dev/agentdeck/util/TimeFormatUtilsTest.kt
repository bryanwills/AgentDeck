package dev.agentdeck.util

import dev.agentdeck.net.CodexRateLimits
import dev.agentdeck.net.CodexRateLimitWindow
import org.junit.Assert.*
import org.junit.Test

class TimeFormatUtilsTest {

    // --- formatCount ---

    @Test
    fun `formatCount small numbers unchanged`() {
        assertEquals("0", formatCount(0))
        assertEquals("1", formatCount(1))
        assertEquals("999", formatCount(999))
    }

    @Test
    fun `formatCount thousands show K`() {
        assertEquals("1.0K", formatCount(1000))
        assertEquals("1.5K", formatCount(1500))
        assertEquals("999.9K", formatCount(999_900))
    }

    @Test
    fun `formatCount millions show M`() {
        assertEquals("1.0M", formatCount(1_000_000))
        assertEquals("1.5M", formatCount(1_500_000))
        assertEquals("10.0M", formatCount(10_000_000))
    }

    @Test
    fun `formatCount int overload works`() {
        val n: Int = 1000
        assertEquals("1.0K", formatCount(n))
    }

    // --- gaugeBar ---

    @Test
    fun `gaugeBar 0 percent is all empty`() {
        assertEquals("░░░░░░", gaugeBar(0.0))
    }

    @Test
    fun `gaugeBar 100 percent is all filled`() {
        assertEquals("██████", gaugeBar(100.0))
    }

    @Test
    fun `gaugeBar 50 percent is half filled`() {
        assertEquals("███░░░", gaugeBar(50.0))
    }

    @Test
    fun `gaugeBar custom width`() {
        assertEquals("████████░░", gaugeBar(80.0, 10))
    }

    @Test
    fun `gaugeBar clamps above 100`() {
        assertEquals("██████", gaugeBar(150.0))
    }

    @Test
    fun `gaugeBar clamps below 0`() {
        assertEquals("░░░░░░", gaugeBar(-10.0))
    }

    // --- formatBytes ---

    @Test
    fun `formatBytes small values`() {
        assertEquals("0B", formatBytes(0))
        assertEquals("512B", formatBytes(512))
    }

    @Test
    fun `formatBytes kilobytes`() {
        assertEquals("1K", formatBytes(1024))
        assertEquals("10K", formatBytes(10_240))
    }

    @Test
    fun `formatBytes megabytes`() {
        assertEquals("1M", formatBytes(1_048_576))
        assertEquals("512M", formatBytes(536_870_912))
    }

    @Test
    fun `formatBytes gigabytes`() {
        assertEquals("1.0G", formatBytes(1_073_741_824))
        assertEquals("4.5G", formatBytes(4_831_838_208))
    }

    // --- formatDurationCompact ---

    @Test
    fun `formatDurationCompact sub-second`() {
        assertEquals("<1s", formatDurationCompact(0))
        assertEquals("<1s", formatDurationCompact(999))
    }

    @Test
    fun `formatDurationCompact seconds`() {
        assertEquals("1s", formatDurationCompact(1000))
        assertEquals("45s", formatDurationCompact(45_000))
    }

    @Test
    fun `formatDurationCompact minutes`() {
        assertEquals("1m", formatDurationCompact(60_000))
        assertEquals("2m 5s", formatDurationCompact(125_000))
    }

    @Test
    fun `formatDurationCompact exact minutes no seconds`() {
        assertEquals("5m", formatDurationCompact(300_000))
    }

    // --- formatResetTime ---

    @Test
    fun `formatResetTime returns original on parse failure`() {
        assertEquals("not-a-date", formatResetTime("not-a-date"))
    }

    // --- formatUptime ---

    @Test
    fun `formatUptime zero returns 0 colon 00`() {
        assertEquals("0:00", formatUptime(0))
        assertEquals("0:00", formatUptime(-1))
    }

    // --- windowLabel ---

    @Test
    fun `windowLabel maps minutes to compact day-hour-minute labels`() {
        assertEquals("5h", windowLabel(300))
        assertEquals("7d", windowLabel(10080)) // days checked first: 10080 -> 7d not 168h
        assertEquals("1h", windowLabel(60))
        assertEquals("45m", windowLabel(45))
        assertEquals("·", windowLabel(null))
        assertEquals("·", windowLabel(0))
    }

    // --- codexLimitRows ---

    @Test
    fun `codexLimitRows returns empty when limits null`() {
        assertTrue(codexLimitRows(null).isEmpty())
    }

    @Test
    fun `codexLimitRows maps primary and secondary windows with agent tag`() {
        val rows = codexLimitRows(
            CodexRateLimits(
                primary = CodexRateLimitWindow(usedPercent = 67.0, windowMinutes = 300, resetsAt = "2026-06-29T15:00:00Z"),
                secondary = CodexRateLimitWindow(usedPercent = 9.0, windowMinutes = 10080, stale = true),
            ),
        )
        assertEquals(2, rows.size)
        assertEquals("codex", rows[0].agentType)
        assertEquals("5h", rows[0].label)
        assertEquals(67.0, rows[0].percent, 0.0)
        assertEquals("2026-06-29T15:00:00Z", rows[0].resetIso)
        assertFalse(rows[0].stale)
        assertEquals("7d", rows[1].label)
        assertTrue(rows[1].stale)
    }

    @Test
    fun `codexLimitRows skips windows with null usedPercent`() {
        val rows = codexLimitRows(
            CodexRateLimits(
                primary = CodexRateLimitWindow(usedPercent = null, windowMinutes = 300),
                secondary = CodexRateLimitWindow(usedPercent = 12.0, windowMinutes = 10080),
            ),
        )
        assertEquals(1, rows.size)
        assertEquals("7d", rows[0].label)
    }
}
