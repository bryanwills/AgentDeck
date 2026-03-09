package dev.agentdeck.terrarium.environment

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import dev.agentdeck.terrarium.TerrariumColors
import dev.agentdeck.terrarium.TerrariumLayout
import dev.agentdeck.terrarium.TerrariumTiming
import kotlin.math.PI
import kotlin.math.sin

/**
 * Swaying kelp bezier curves growing from the bottom.
 * Each strand has a phase-offset sine for organic movement.
 */
class KelpField {

    private data class KelpStrand(
        val baseX: Float,    // 0..1 fraction of width
        val height: Float,   // 0..1 fraction of canvas height
        val phase: Float,    // sine phase offset
        val segments: Int,   // number of bezier segments (2-4)
    )

    private val strands = listOf(
        KelpStrand(0.08f, 0.25f, 0f, 3),
        KelpStrand(0.12f, 0.30f, 1.2f, 4),
        KelpStrand(0.15f, 0.20f, 2.5f, 2),
        KelpStrand(0.88f, 0.22f, 0.8f, 3),
        KelpStrand(0.92f, 0.28f, 1.8f, 3),
        KelpStrand(0.55f, 0.18f, 3.0f, 2),
    )

    // Ground cover: short grass blades in 3 clusters
    private data class GrassBlade(
        val baseX: Float,
        val height: Float, // 0.03~0.06 canvas height
        val phase: Float,
        val width: Float,  // stroke width multiplier
    )

    private val grassBlades = listOf(
        // Left cluster (near left rocks, 0.04~0.13)
        GrassBlade(0.04f, 0.035f, 0.3f, 0.8f),
        GrassBlade(0.06f, 0.050f, 1.1f, 1.0f),
        GrassBlade(0.08f, 0.040f, 2.0f, 0.7f),
        GrassBlade(0.10f, 0.055f, 0.7f, 0.9f),
        GrassBlade(0.13f, 0.030f, 1.5f, 0.8f),
        // Center cluster (0.42~0.48)
        GrassBlade(0.42f, 0.045f, 2.3f, 0.9f),
        GrassBlade(0.44f, 0.060f, 0.5f, 1.0f),
        GrassBlade(0.46f, 0.040f, 1.8f, 0.8f),
        GrassBlade(0.48f, 0.050f, 3.1f, 0.7f),
        GrassBlade(0.43f, 0.035f, 2.8f, 0.9f),
        // Right cluster (near right rocks, 0.83~0.91)
        GrassBlade(0.83f, 0.040f, 0.9f, 0.8f),
        GrassBlade(0.86f, 0.055f, 2.2f, 1.0f),
        GrassBlade(0.88f, 0.035f, 1.4f, 0.7f),
        GrassBlade(0.90f, 0.050f, 3.5f, 0.9f),
        GrassBlade(0.91f, 0.030f, 0.2f, 0.8f),
    )

    private var time by mutableFloatStateOf(0f)
    // Pre-allocated Path objects — one per strand, reused every frame
    private val strandPaths = Array(strands.size) { Path() }
    // Pre-allocated grass paths
    private val grassPaths = Array(grassBlades.size) { Path() }

    fun update(dt: Float) {
        time += dt * TerrariumTiming.KELP_SWAY_SPEED
    }

    fun draw(scope: DrawScope) {
        val w = scope.size.width
        val h = scope.size.height

        // Draw grass blades first (below kelp)
        for (i in grassBlades.indices) {
            drawGrassBlade(scope, grassBlades[i], w, h, grassPaths[i])
        }

        for (i in strands.indices) {
            drawStrand(scope, strands[i], w, h, strandPaths[i])
        }
    }

    private fun drawGrassBlade(scope: DrawScope, blade: GrassBlade, w: Float, h: Float, path: Path) {
        val baseX = blade.baseX * w
        val baseY = h * (1f - TerrariumLayout.SAND_HEIGHT_FRACTION)
        val tipY = baseY - blade.height * h

        // Faster sway than kelp
        val sway = sin(time * 1.5f + blade.phase) * w * 0.008f

        path.reset()
        path.moveTo(baseX, baseY)
        path.quadraticBezierTo(baseX + sway, (baseY + tipY) * 0.5f, baseX + sway * 0.7f, tipY)

        scope.drawPath(
            path = path,
            color = TerrariumColors.KelpDark.copy(alpha = 0.6f),
            style = Stroke(width = w * 0.002f * blade.width, cap = StrokeCap.Round),
        )
    }

    private fun drawStrand(scope: DrawScope, strand: KelpStrand, w: Float, h: Float, path: Path) {
        val baseX = strand.baseX * w
        val baseY = h * (1f - TerrariumLayout.SAND_HEIGHT_FRACTION) // sand top line (rock height)
        val topY = baseY - strand.height * h
        val segHeight = (baseY - topY) / strand.segments

        path.reset()
        path.moveTo(baseX, baseY)
        for (i in 0 until strand.segments) {
            val sway = sin(time + strand.phase + i * 0.8f) * w * 0.015f * (i + 1)
            val y1 = baseY - (i + 0.5f) * segHeight
            val y2 = baseY - (i + 1f) * segHeight
            val cpX = baseX + sway
            path.quadraticBezierTo(cpX, y1, baseX + sway * 0.6f, y2)
        }

        // Main stem
        scope.drawPath(
            path = path,
            color = TerrariumColors.KelpDark,
            style = Stroke(width = w * 0.004f, cap = StrokeCap.Round),
        )

        // Lighter inner stroke
        scope.drawPath(
            path = path,
            color = TerrariumColors.KelpGreen.copy(alpha = 0.5f),
            style = Stroke(width = w * 0.002f, cap = StrokeCap.Round),
        )

        // Leaf blobs at segment joints
        for (i in 1..strand.segments) {
            val sway = sin(time + strand.phase + i * 0.8f) * w * 0.015f * i
            val leafY = baseY - i * segHeight
            val leafX = baseX + sway * 0.6f

            scope.drawOval(
                color = TerrariumColors.KelpGreen.copy(alpha = 0.4f),
                topLeft = Offset(leafX - w * 0.006f, leafY - w * 0.003f),
                size = androidx.compose.ui.geometry.Size(w * 0.012f, w * 0.006f),
            )
        }
    }
}
