package dev.agentdeck.terrarium.environment

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import dev.agentdeck.terrarium.EnvironmentVisualState
import dev.agentdeck.terrarium.creature.Creature
import kotlin.math.PI
import kotlin.math.sin

/**
 * Water surface line at the top ~4% of the canvas.
 * Two-sine composite wave with meniscus curves at edges,
 * subtle air/water gradient above, and sparkle highlights on crests.
 */
class WaterSurface : Creature {

    private var time by mutableFloatStateOf(0f)
    private var envState by mutableStateOf(EnvironmentVisualState.CALM)

    // Pre-allocated Path objects
    private val wavePath = Path()
    private val gradientPath = Path()

    fun setState(state: EnvironmentVisualState) {
        envState = state
    }

    override fun update(dt: Float) {
        time += dt
    }

    override fun draw(scope: DrawScope) {
        val w = scope.size.width
        val h = scope.size.height
        val surfaceY = h * SURFACE_Y_FRACTION

        val amplitude1 = when (envState) {
            EnvironmentVisualState.DARK -> h * 0.002f
            EnvironmentVisualState.CALM -> h * 0.005f
            EnvironmentVisualState.ACTIVE -> h * 0.008f
            EnvironmentVisualState.ALERT -> h * 0.007f
        }
        val amplitude2 = amplitude1 * 0.4f
        val amplitude3 = if (envState == EnvironmentVisualState.ALERT) h * 0.003f else 0f

        val lineAlpha = when (envState) {
            EnvironmentVisualState.DARK -> 0.08f
            EnvironmentVisualState.CALM -> 0.20f
            EnvironmentVisualState.ACTIVE -> 0.25f
            EnvironmentVisualState.ALERT -> 0.22f
        }

        val gradAlpha = when (envState) {
            EnvironmentVisualState.DARK -> 0.03f
            EnvironmentVisualState.CALM -> 0.08f
            EnvironmentVisualState.ACTIVE -> 0.10f
            EnvironmentVisualState.ALERT -> 0.08f
        }

        // Build wave path
        wavePath.reset()
        for (i in 0..WAVE_SEGMENTS) {
            val nx = i.toFloat() / WAVE_SEGMENTS
            val x = nx * w
            val y = surfaceY +
                sin(nx * WAVE_FREQ_1 * 2f * PI.toFloat() + time * WAVE_SPEED_1) * amplitude1 +
                sin(nx * WAVE_FREQ_2 * 2f * PI.toFloat() + time * WAVE_SPEED_2) * amplitude2 +
                sin(nx * WAVE_FREQ_3 * 2f * PI.toFloat() + time * WAVE_SPEED_3) * amplitude3

            // Meniscus at edges: surface tension curves up near walls
            val meniscus = if (nx < 0.05f) {
                -amplitude1 * 0.6f * (1f - nx / 0.05f)
            } else if (nx > 0.95f) {
                -amplitude1 * 0.6f * ((nx - 0.95f) / 0.05f)
            } else 0f

            if (i == 0) wavePath.moveTo(x, y + meniscus) else wavePath.lineTo(x, y + meniscus)
        }

        // Air/water gradient above surface line
        gradientPath.reset()
        gradientPath.addPath(wavePath)
        // Close path above: extend to top of gradient zone
        gradientPath.lineTo(w, surfaceY - h * GRADIENT_HEIGHT)
        gradientPath.lineTo(0f, surfaceY - h * GRADIENT_HEIGHT)
        gradientPath.close()

        scope.drawPath(
            path = gradientPath,
            brush = Brush.verticalGradient(
                colors = listOf(Color.Transparent, Color.White.copy(alpha = gradAlpha)),
                startY = surfaceY - h * GRADIENT_HEIGHT,
                endY = surfaceY,
            ),
        )

        // Surface line stroke
        scope.drawPath(
            path = wavePath,
            color = Color.White.copy(alpha = lineAlpha),
            style = Stroke(width = 1.5f, cap = StrokeCap.Round),
        )

        // Sparkle highlights on wave crests (3-4 small bright ovals)
        for (i in 0 until SPARKLE_COUNT) {
            val nx = SPARKLE_POSITIONS[i] + sin(time * 0.2f + i * 1.3f) * 0.03f
            val x = nx * w
            val waveY = surfaceY +
                sin(nx * WAVE_FREQ_1 * 2f * PI.toFloat() + time * WAVE_SPEED_1) * amplitude1 +
                sin(nx * WAVE_FREQ_2 * 2f * PI.toFloat() + time * WAVE_SPEED_2) * amplitude2

            // Only show sparkle near crests
            val sparkleAlpha = lineAlpha * 0.6f * ((sin(time * 0.8f + i * 2.1f) + 1f) * 0.5f)
            if (sparkleAlpha > 0.02f) {
                scope.drawOval(
                    color = Color.White.copy(alpha = sparkleAlpha),
                    topLeft = Offset(x - w * 0.006f, waveY - h * 0.002f),
                    size = Size(w * 0.012f, h * 0.003f),
                )
            }
        }
    }

    companion object {
        private const val SURFACE_Y_FRACTION = 0.04f
        private const val GRADIENT_HEIGHT = 0.03f // gradient zone above surface
        private const val WAVE_SEGMENTS = 60
        private const val WAVE_FREQ_1 = 2.5f  // long wavelength
        private const val WAVE_FREQ_2 = 5.0f  // short wavelength
        private const val WAVE_FREQ_3 = 8.0f  // fast ripple (ALERT only)
        private const val WAVE_SPEED_1 = 0.6f
        private const val WAVE_SPEED_2 = 1.2f
        private const val WAVE_SPEED_3 = 2.5f
        private const val SPARKLE_COUNT = 4
        private val SPARKLE_POSITIONS = floatArrayOf(0.15f, 0.38f, 0.62f, 0.85f)
    }
}
