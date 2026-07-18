package dev.agentdeck.terrarium

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression lock for the ≤50% overlap cap in [layoutBand] (shared line-for-line
 * with apple/AgentDeck/Terrarium/CreatureLayout.swift). Neighbors standing in the
 * same row must never overlap by more than ~half a body width; when the band is
 * too tight the creatures shrink by the same ratio instead of piling up.
 */
class CreatureLayoutTest {

    // On-screen body-width fractions (must match the creatureWidth args in the
    // layoutXxx functions). Overlap is measured against width * slot.scaleFactor.
    private val octopusWidth = 0.11f
    private val cloudWidth = 0.080f
    private val openCodeWidth = 0.078f
    private val antigravityWidth = 0.096f

    /**
     * Worst overlap fraction between creatures standing in the same row. Rows
     * aren't tagged on the slot, but within-row Y spread (jitter ≤0.016) is far
     * below the ≥0.05 gap between rows, so a 0.03 Y threshold cleanly separates
     * them. Overlap of a pair = (bodyWidth - centerGap) / bodyWidth.
     */
    private fun worstOverlap(slots: List<CreatureSlot>, width: Float): Float {
        var worst = 0f
        for (i in slots.indices) {
            for (j in i + 1 until slots.size) {
                val a = slots[i]
                val b = slots[j]
                if (kotlin.math.abs(a.centerYFraction - b.centerYFraction) >= 0.03f) continue
                val w = width * maxOf(a.scaleFactor, b.scaleFactor)
                val d = kotlin.math.abs(a.centerXFraction - b.centerXFraction)
                val overlap = (w - d) / w
                if (overlap > worst) worst = overlap
            }
        }
        return worst
    }

    @Test
    fun `no row overlaps more than ~50 percent across realistic counts`() {
        for (n in 1..16) {
            assertOverlapWithin(layoutOctopuses(n), octopusWidth, n, "octopus")
            assertOverlapWithin(layoutCloudCreatures(n), cloudWidth, n, "cloud")
            assertOverlapWithin(layoutOpenCodeCreatures(n), openCodeWidth, n, "opencode")
            assertOverlapWithin(layoutAntigravityCreatures(n), antigravityWidth, n, "antigravity")
        }
    }

    @Test
    fun `floor-rest clear anchor stays left of the crayfish claws`() {
        // Idle/sleeping drifters anchor at ≤ CRAYFISH_CLEAR_MAX_X. Their right
        // edge must stay left of the crayfish's left claw reach (~one body
        // width left of center), else idle OpenCode lands on the OpenClaw
        // crayfish again (the original macOS/Android full-overlap bug).
        val clawLeftEdge =
            TerrariumLayout.CRAYFISH_CENTER_X_FRACTION - TerrariumLayout.CRAYFISH_WIDTH_FRACTION
        val widestRester = maxOf(openCodeWidth, antigravityWidth)
        assertTrue(
            "clear anchor ${TerrariumLayout.CRAYFISH_CLEAR_MAX_X} + half body reaches into crayfish claws",
            TerrariumLayout.CRAYFISH_CLEAR_MAX_X + widestRester / 2f < clawLeftEdge,
        )
    }

    @Test
    fun `low counts keep full size and do not shrink`() {
        // 1-2 sessions must not trigger any crowd shrink — they render large.
        assertTrue(layoutOctopuses(1).first().scaleFactor > 0.9f)
        assertTrue(layoutOctopuses(2).all { it.scaleFactor > 0.85f })
    }

    private fun assertOverlapWithin(slots: List<CreatureSlot>, width: Float, n: Int, name: String) {
        val overlap = worstOverlap(slots, width)
        // ≤50% is the target; allow a small slack for the crowded floor + jitter.
        assertTrue(
            "$name n=$n overlapped ${(overlap * 100).toInt()}% (> cap)",
            overlap <= 0.56f,
        )
    }
}
