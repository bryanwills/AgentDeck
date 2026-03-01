package dev.agentdeck.terrarium.creature

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import dev.agentdeck.terrarium.OctopusVisualState
import dev.agentdeck.terrarium.TerrariumColors
import dev.agentdeck.terrarium.TerrariumLayout
import dev.agentdeck.terrarium.TerrariumTiming
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Claude Code pixel mascot — 14×5 portrait-rectangle character (terracotta).
 * Each pixel is 1:2 (w:h) ratio. Thin gap between blocks for visual separation.
 * Rounded body with protruding animated arms and 4 stretch-animated tentacles.
 *
 * Pixel cell types:
 *   0=transparent, 1=body, 2=eye, 3=left arm, 4=right arm,
 *   5=left tentacle, 6=right tentacle
 *
 * Arms bob vertically. Tentacles stretch height (no position shift, no gaps).
 * THINKING state shows rotating Anthropic starburst behind the body.
 */
class OctopusCreature(
    private val centerXFraction: Float = TerrariumLayout.OCTOPUS_CENTER_X_FRACTION,
    private val centerYFraction: Float = TerrariumLayout.OCTOPUS_CENTER_Y_FRACTION,
    private val scaleFactor: Float = 1f,
) : Creature {

    private var visualState by mutableStateOf(OctopusVisualState.FLOATING)
    private var time by mutableFloatStateOf(0f)
    private var transitionProgress by mutableFloatStateOf(1f)
    private var agentMark: AgentMark? by mutableStateOf(null)

    fun setState(newState: OctopusVisualState) {
        if (newState != visualState) {
            visualState = newState
            transitionProgress = 0f
        }
    }

    fun setMark(newMark: AgentMark?) {
        agentMark = newMark
    }

    override fun update(dt: Float) {
        time += dt
        if (transitionProgress < 1f) {
            transitionProgress = (transitionProgress + dt * 2f).coerceAtMost(1f)
        }
    }

    override fun draw(scope: DrawScope) {
        val w = scope.size.width
        val h = scope.size.height

        val bodyRadius = w * TerrariumLayout.OCTOPUS_BODY_RADIUS_FRACTION * scaleFactor
        val centerX = w * centerXFraction

        // Float bob
        val bobOffset = when (visualState) {
            OctopusVisualState.SLEEPING -> 0f
            else -> sin(time * 2f * PI.toFloat() / (TerrariumTiming.FLOAT_PERIOD_MS / 1000f)) *
                h * TerrariumTiming.FLOAT_AMPLITUDE_FRACTION
        }
        val centerY = h * centerYFraction + bobOffset

        // Sleeping: lower position, dimmer
        val effectiveCenterY = if (visualState == OctopusVisualState.SLEEPING) {
            h * 0.82f
        } else centerY

        val bodyAlpha = if (visualState == OctopusVisualState.SLEEPING) 0.4f else 1f

        // THINKING: draw starburst behind pixel body
        if (visualState == OctopusVisualState.THINKING) {
            drawStarburst(scope, centerX, effectiveCenterY, bodyRadius * 2.5f, bodyAlpha)
        }

        // Draw pixel body with animated tentacles
        drawPixelBody(scope, centerX, effectiveCenterY, bodyRadius, bodyAlpha)

        // Holographic keyboard for TYPING state
        if (visualState == OctopusVisualState.TYPING) {
            val pixelW = bodyRadius * 2f / GRID_COLS
            val gridH = GRID_ROWS * pixelW * PIXEL_ASPECT
            val kbY = effectiveCenterY + gridH * 0.6f
            drawHolographicKeyboard(scope, centerX, kbY, bodyRadius)
        }

        // Option cards for PRESENTING state
        if (visualState == OctopusVisualState.PRESENTING) {
            drawOptionCards(scope, centerX, effectiveCenterY, bodyRadius)
        }

        // Document review for REVIEWING state
        if (visualState == OctopusVisualState.REVIEWING) {
            drawReviewDocs(scope, centerX, effectiveCenterY, bodyRadius)
        }
    }

    // --- Tentacle animation offsets ---

    /** Y-offset for tentacle animation. Left and right pairs sway in opposite phase. */
    private fun tentacleOffset(isLeft: Boolean, pixelSize: Float): Float {
        val phase = if (isLeft) PI.toFloat() else 0f

        val (speed, amplitude) = when (visualState) {
            OctopusVisualState.TYPING -> TerrariumTiming.TYPING_SPEED to 0.35f
            OctopusVisualState.FLOATING -> 2.0f to 0.15f
            OctopusVisualState.THINKING -> 1.5f to 0.08f
            OctopusVisualState.OFFERING,
            OctopusVisualState.PRESENTING -> 1.5f to 0.10f
            OctopusVisualState.REVIEWING -> 1.0f to 0.05f
            OctopusVisualState.SLEEPING -> return 0f
        }

        return sin(time * speed + phase) * pixelSize * amplitude
    }

    /** Y-offset for arm animation. Gentle bob, opposite phase from tentacles. */
    private fun armOffset(isLeft: Boolean, pixelSize: Float): Float {
        val phase = if (isLeft) 0f else PI.toFloat()

        val (speed, amplitude) = when (visualState) {
            OctopusVisualState.TYPING -> 4.0f to 0.20f
            OctopusVisualState.FLOATING -> 1.5f to 0.12f
            OctopusVisualState.THINKING -> 1.0f to 0.06f
            OctopusVisualState.OFFERING,
            OctopusVisualState.PRESENTING -> 1.5f to 0.08f
            OctopusVisualState.REVIEWING -> 0.8f to 0.04f
            OctopusVisualState.SLEEPING -> return 0f
        }

        return sin(time * speed + phase) * pixelSize * amplitude
    }

    private fun drawPixelBody(
        scope: DrawScope,
        cx: Float, cy: Float,
        bodyRadius: Float,
        alpha: Float,
    ) {
        val pixelW = bodyRadius * 2f / GRID_COLS
        val pixelH = pixelW * PIXEL_ASPECT
        val gridW = GRID_COLS * pixelW
        val gridH = GRID_ROWS * pixelH
        val startX = cx - gridW / 2f
        val startY = cy - gridH / 2f

        val bodyColor = bodyColorForState()

        for (row in 0 until GRID_ROWS) {
            for (col in 0 until GRID_COLS) {
                val cell = PIXEL_GRID[row][col]
                if (cell == EMPTY) continue

                val px = startX + col * pixelW
                var py = startY + row * pixelH

                // Apply animation offsets
                when (cell) {
                    LEFT_ARM -> py += armOffset(isLeft = true, pixelH)
                    RIGHT_ARM -> py += armOffset(isLeft = false, pixelH)
                    LEFT_LEG -> py += tentacleOffset(isLeft = true, pixelH)
                    RIGHT_LEG -> py += tentacleOffset(isLeft = false, pixelH)
                }

                when (cell) {
                    EYE -> {
                        if (visualState == OctopusVisualState.SLEEPING) {
                            // Closed eyes — thin horizontal line
                            scope.drawRect(
                                color = TerrariumColors.ClaudeEye.copy(alpha = alpha * 0.6f),
                                topLeft = Offset(px, py + pixelH * 0.4f),
                                size = Size(pixelW, pixelH * 0.2f),
                            )
                        } else {
                            scope.drawRect(
                                color = TerrariumColors.ClaudeEye.copy(alpha = alpha),
                                topLeft = Offset(px, py),
                                size = Size(pixelW, pixelH),
                            )
                        }
                    }
                    else -> {
                        // Body or tentacle pixel — all use body color
                        scope.drawRect(
                            color = bodyColor.copy(alpha = alpha),
                            topLeft = Offset(px, py),
                            size = Size(pixelW, pixelH),
                        )
                    }
                }
            }
        }
    }

    private fun bodyColorForState(): Color {
        return when (visualState) {
            OctopusVisualState.THINKING -> {
                val t = sin(time * TerrariumTiming.THINKING_PULSE_SPEED) * 0.5f + 0.5f
                lerpColor(TerrariumColors.ClaudeBody, TerrariumColors.ClaudeBodyLight, t)
            }
            else -> TerrariumColors.ClaudeBody
        }
    }

    /**
     * Anthropic sparkle/starburst — 10 radiating arms behind the pixel body.
     * Slowly rotates and pulses during THINKING state.
     */
    private fun drawStarburst(scope: DrawScope, cx: Float, cy: Float, radius: Float, alpha: Float) {
        val rotation = time * 0.5f
        val pulse = sin(time * TerrariumTiming.THINKING_PULSE_SPEED) * 0.15f + 0.85f

        for (i in 0 until STARBURST_ARM_COUNT) {
            val baseAngle = (i.toFloat() / STARBURST_ARM_COUNT) * 2f * PI.toFloat() + rotation
            val armLen = radius * pulse * STARBURST_ARM_LENGTHS[i % STARBURST_ARM_LENGTHS.size]
            val endX = cx + cos(baseAngle) * armLen
            val endY = cy + sin(baseAngle) * armLen

            scope.drawLine(
                color = TerrariumColors.ClaudeBody.copy(alpha = alpha * 0.35f),
                start = Offset(cx, cy),
                end = Offset(endX, endY),
                strokeWidth = radius * 0.10f,
                cap = StrokeCap.Round,
            )
        }
    }

    private fun drawHolographicKeyboard(scope: DrawScope, cx: Float, kbY: Float, bodyRadius: Float) {
        val kbWidth = bodyRadius * 4f
        val kbHeight = bodyRadius * 1.5f

        scope.drawRoundRect(
            color = TerrariumColors.HoloBlue.copy(alpha = 0.15f),
            topLeft = Offset(cx - kbWidth / 2, kbY),
            size = Size(kbWidth, kbHeight),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(4f),
        )

        val rows = 3
        val cols = 10
        for (r in 0..rows) {
            val y = kbY + (r.toFloat() / rows) * kbHeight
            scope.drawLine(
                color = TerrariumColors.HoloText.copy(alpha = 0.2f),
                start = Offset(cx - kbWidth / 2, y),
                end = Offset(cx + kbWidth / 2, y),
                strokeWidth = 0.5f,
            )
        }
        for (c in 0..cols) {
            val x = cx - kbWidth / 2 + (c.toFloat() / cols) * kbWidth
            scope.drawLine(
                color = TerrariumColors.HoloText.copy(alpha = 0.2f),
                start = Offset(x, kbY),
                end = Offset(x, kbY + kbHeight),
                strokeWidth = 0.5f,
            )
        }

        val activeCol = ((time * TerrariumTiming.TYPING_SPEED * 2f) % cols).toInt()
        val activeRow = ((time * TerrariumTiming.TYPING_SPEED) % rows).toInt()
        val keyW = kbWidth / cols
        val keyH = kbHeight / rows
        scope.drawRoundRect(
            color = TerrariumColors.TetraNeon.copy(alpha = 0.4f),
            topLeft = Offset(cx - kbWidth / 2 + activeCol * keyW, kbY + activeRow * keyH),
            size = Size(keyW, keyH),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(2f),
        )
    }

    private fun drawOptionCards(scope: DrawScope, cx: Float, cy: Float, bodyRadius: Float) {
        val cardWidth = bodyRadius * 2f
        val cardHeight = bodyRadius * 1.2f
        val startY = cy - bodyRadius * 1.5f

        for (i in 0 until 3) {
            val offsetX = (i - 1) * cardWidth * 1.2f
            scope.drawRoundRect(
                color = TerrariumColors.HoloBlue.copy(alpha = 0.2f),
                topLeft = Offset(cx + offsetX - cardWidth / 2, startY),
                size = Size(cardWidth, cardHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(4f),
            )
            scope.drawRoundRect(
                color = TerrariumColors.HoloText.copy(alpha = 0.4f),
                topLeft = Offset(cx + offsetX - cardWidth / 2, startY),
                size = Size(cardWidth, cardHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(4f),
                style = Stroke(width = 1f),
            )
        }
    }

    private fun drawReviewDocs(scope: DrawScope, cx: Float, cy: Float, bodyRadius: Float) {
        val docWidth = bodyRadius * 2.5f
        val docHeight = bodyRadius * 3f
        val docY = cy - bodyRadius * 0.5f

        for (side in listOf(-1f, 1f)) {
            val docX = cx + side * docWidth * 0.7f - docWidth / 2

            scope.drawRoundRect(
                color = TerrariumColors.HoloBlue.copy(alpha = 0.12f),
                topLeft = Offset(docX, docY),
                size = Size(docWidth, docHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(2f),
            )

            for (line in 0 until 8) {
                val lineY = docY + 8f + line * (docHeight / 9f)
                val lineWidth = docWidth * (0.5f + (line * 17 % 5) * 0.1f)
                scope.drawLine(
                    color = TerrariumColors.HoloText.copy(alpha = 0.25f),
                    start = Offset(docX + 6f, lineY),
                    end = Offset(docX + 6f + lineWidth, lineY),
                    strokeWidth = 1.5f,
                )
            }

            val diffColor = if (side < 0) Color(0x60EF4444) else Color(0x6022C55E)
            scope.drawRoundRect(
                color = diffColor,
                topLeft = Offset(docX, docY),
                size = Size(3f, docHeight),
            )
        }
    }

    private fun lerpColor(a: Color, b: Color, t: Float): Color {
        return Color(
            red = a.red + (b.red - a.red) * t,
            green = a.green + (b.green - a.green) * t,
            blue = a.blue + (b.blue - a.blue) * t,
            alpha = a.alpha + (b.alpha - a.alpha) * t,
        )
    }

    companion object {
        // Pixel cell types
        private const val EMPTY = 0
        private const val BODY = 1
        private const val EYE = 2
        private const val LEFT_ARM = 3
        private const val RIGHT_ARM = 4
        private const val LEFT_LEG = 5
        private const val RIGHT_LEG = 6

        private const val GRID_COLS = 12
        private const val GRID_ROWS = 6

        /** Portrait pixel aspect ratio (height/width). */
        private const val PIXEL_ASPECT = 1.7f

        // Claude Code pixel mascot — 12 cols × 6 rows, portrait-rectangle pixels
        // Rounded body (10w) with protruding arms (12w at row 2) + 4 tentacles
        private val PIXEL_GRID = arrayOf(
            intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 0: head (10w)
            intArrayOf(0, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 0), // row 1: eyes (10w)
            intArrayOf(3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4), // row 2: body + arms (12w)
            intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 3: body (10w)
            intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 4: waist (10w)
            intArrayOf(0, 0, 5, 0, 5, 0, 0, 6, 0, 6, 0, 0), // row 5: tentacles ×4
        )

        // Starburst (Anthropic sparkle) — 10 arms with varying lengths
        private const val STARBURST_ARM_COUNT = 10
        private val STARBURST_ARM_LENGTHS = floatArrayOf(
            1.0f, 0.75f, 0.95f, 0.70f, 1.0f,
            0.80f, 0.90f, 0.72f, 0.98f, 0.78f,
        )
    }
}
