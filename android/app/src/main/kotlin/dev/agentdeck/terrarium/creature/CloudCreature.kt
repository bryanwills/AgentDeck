package dev.agentdeck.terrarium.creature

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import dev.agentdeck.terrarium.OctopusVisualState
import dev.agentdeck.terrarium.TerrariumColors
import dev.agentdeck.terrarium.TerrariumLayout
import dev.agentdeck.terrarium.TerrariumTiming
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Codex CLI cloud creature — 6-lobe clover shape with blue-purple gradient.
 * Represents Codex CLI sessions in the terrarium. The shape mirrors the Codex CLI icon:
 * a 6-lobe clover/flower pattern with a `>_` terminal prompt inside.
 *
 * Colors: lavender (#B394E5) top → deep blue (#3342C7) bottom gradient.
 * Working state shows bioluminescent orbiting particles.
 * Same public API as OctopusCreature for interchangeable use.
 */
class CloudCreature(
    centerXFraction: Float = TerrariumLayout.OCTOPUS_CENTER_X_FRACTION,
    centerYFraction: Float = TerrariumLayout.OCTOPUS_CENTER_Y_FRACTION,
    private var scaleFactor: Float = 1f,
    phaseOffset: Float = 0f,
    displayName: String? = null,
) : Creature {

    private var visualState by mutableStateOf(OctopusVisualState.FLOATING)
    private var time by mutableFloatStateOf(phaseOffset)
    private var transitionProgress by mutableFloatStateOf(1f)
    private var nameTag: String? by mutableStateOf(displayName)
    private var showNameTag by mutableStateOf(displayName != null)

    // Swimming state
    private var homeX = centerXFraction
    private var homeY = centerYFraction
    private var currentX = centerXFraction
    private var currentY = centerYFraction
    private var targetX = centerXFraction
    private var targetY = centerYFraction
    private var waypointTimer = 0f
    private var waypointInterval = TerrariumTiming.WAYPOINT_MIN_INTERVAL +
        kotlin.random.Random.nextFloat() * (TerrariumTiming.WAYPOINT_MAX_INTERVAL - TerrariumTiming.WAYPOINT_MIN_INTERVAL)
    private val standingJitter = kotlin.random.Random.nextFloat() * 0.06f - 0.03f

    // Bioluminescent particle state (8 orbiting particles when WORKING)
    private data class GlowParticle(
        val orbitRadius: Float,
        val orbitSpeed: Float,
        val phaseOffset: Float,
        val size: Float,
        val color: Color,
    )

    private val glowParticles = List(GLOW_PARTICLE_COUNT) { i ->
        GlowParticle(
            orbitRadius = 0.7f + kotlin.random.Random.nextFloat() * 0.6f, // 0.7–1.3 of body radius
            orbitSpeed = 0.8f + kotlin.random.Random.nextFloat() * 0.6f,
            phaseOffset = i * (2f * PI.toFloat() / GLOW_PARTICLE_COUNT),
            size = 0.04f + kotlin.random.Random.nextFloat() * 0.03f,
            color = if (i % 2 == 0) GLOW_CYAN else GLOW_LAVENDER,
        )
    }

    /** Callback invoked when transitioning away from ASKING (bubble pop trigger). */
    var onAskingExit: ((nx: Float, ny: Float) -> Unit)? = null

    fun setState(newState: OctopusVisualState) {
        if (newState != visualState) {
            if (visualState == OctopusVisualState.ASKING) {
                onAskingExit?.invoke(currentX, currentY)
            }
            visualState = newState
            transitionProgress = 0f
        }
    }

    fun setDisplayName(name: String?, show: Boolean = name != null) {
        nameTag = name
        showNameTag = show
    }

    /** Update home position — creature lerps naturally (no teleport). */
    fun setHomePosition(x: Float, y: Float, scale: Float) {
        homeX = x
        homeY = y
        scaleFactor = scale
    }

    /** Current live position for tetra attractor tracking. */
    fun currentPosition(): Pair<Float, Float> = currentX to currentY

    /** Whether this cloud is currently working (swimming, scattering data). */
    fun isWorking(): Boolean = visualState == OctopusVisualState.WORKING

    override fun update(dt: Float) {
        time += dt
        if (transitionProgress < 1f) {
            transitionProgress = (transitionProgress + dt * 3f).coerceAtMost(1f)
        }

        when (visualState) {
            OctopusVisualState.SLEEPING -> {
                val myDeepY = STANDING_Y_DEEP + standingJitter * 0.5f
                currentX += (homeX - currentX) * dt * 4f
                currentY += (myDeepY - currentY) * dt * 4f
            }
            OctopusVisualState.FLOATING -> {
                val myStandingY = STANDING_Y + standingJitter + (homeX - 0.4f) * 0.15f
                val breathBob = sin(time * 0.6f) * 0.003f
                val idleSway = sin(time * 0.25f) * 0.004f
                currentX += (homeX + idleSway - currentX) * dt * 4f
                currentY += (myStandingY + breathBob - currentY) * dt * 4f
            }
            OctopusVisualState.ASKING -> {
                val myStandingY = ASKING_Y + standingJitter + (homeX - 0.4f) * 0.15f
                val fidgetX = sin(time * 1.0f) * 0.006f
                currentX += (homeX + fidgetX - currentX) * dt * 4f
                currentY += (myStandingY - currentY) * dt * 4f
            }
            OctopusVisualState.WORKING -> {
                waypointTimer += dt
                if (waypointTimer >= waypointInterval) {
                    waypointTimer = 0f
                    waypointInterval = TerrariumTiming.WAYPOINT_MIN_INTERVAL +
                        kotlin.random.Random.nextFloat() * (TerrariumTiming.WAYPOINT_MAX_INTERVAL - TerrariumTiming.WAYPOINT_MIN_INTERVAL)
                    pickNewWaypoint()
                }
                val rate = TerrariumTiming.SWIM_LERP_RATE * dt
                currentX += (targetX - currentX) * rate
                currentY += (targetY - currentY) * rate
                currentX = currentX.coerceIn(TerrariumLayout.SWIM_MIN_X, TerrariumLayout.SWIM_MAX_X)
                currentY = currentY.coerceIn(WORKING_MIN_Y, WORKING_MAX_Y)
            }
        }
    }

    private fun pickNewWaypoint() {
        val angle = kotlin.random.Random.nextFloat() * 2f * PI.toFloat()
        val wanderRadius = 0.15f // wider drift than octopus
        val radius = kotlin.random.Random.nextFloat() * wanderRadius
        targetX = (homeX + cos(angle) * radius)
            .coerceIn(TerrariumLayout.SWIM_MIN_X, TerrariumLayout.SWIM_MAX_X)
        targetY = (WORKING_CENTER_Y + sin(angle) * radius * 0.5f)
            .coerceIn(WORKING_MIN_Y, WORKING_MAX_Y)
    }

    override fun draw(scope: DrawScope) {
        val w = scope.size.width
        val h = scope.size.height

        val bodyRadius = w * TerrariumLayout.OCTOPUS_BODY_RADIUS_FRACTION * scaleFactor
        val centerX = w * currentX

        // Bob animation
        val bobOffset = when (visualState) {
            OctopusVisualState.WORKING -> sin(time * 2f * PI.toFloat() / (TerrariumTiming.FLOAT_PERIOD_MS / 1000f)) *
                h * TerrariumTiming.FLOAT_AMPLITUDE_FRACTION
            OctopusVisualState.FLOATING -> sin(time * 0.6f) * h * 0.003f
            else -> 0f
        }
        val centerY = h * currentY + bobOffset

        val bodyAlpha = when (visualState) {
            OctopusVisualState.SLEEPING -> 0.35f
            else -> 1f
        }

        // Bioluminescent glow particles (behind body, WORKING only)
        if (visualState == OctopusVisualState.WORKING) {
            drawGlowParticles(scope, centerX, centerY, bodyRadius, bodyAlpha)
        }

        // Draw 6-lobe cloud body
        drawCloudBody(scope, centerX, centerY, bodyRadius, bodyAlpha)

        // >_ prompt inside body
        drawPrompt(scope, centerX, centerY, bodyRadius, bodyAlpha)

        // ASKING: speech bubble with "?"
        if (visualState == OctopusVisualState.ASKING) {
            drawSpeechBubble(scope, centerX, centerY, bodyRadius)
        }

        // Name tag
        if (showNameTag && nameTag != null) {
            drawNameTag(scope, centerX, centerY, bodyRadius, nameTag!!)
        }
    }

    /**
     * Draw the 6-lobe clover/cloud shape using overlapping circles.
     * All lobes share the same gradient so overlap lines disappear.
     * Uses drawIntoCanvas with BlendMode for seamless merging.
     */
    private fun drawCloudBody(
        scope: DrawScope,
        cx: Float, cy: Float,
        bodyRadius: Float,
        alpha: Float,
    ) {
        // Lobe breath animation — subtle radial pulse
        val breathScale = when (visualState) {
            OctopusVisualState.WORKING -> 1f + sin(time * TerrariumTiming.THINKING_PULSE_SPEED) * 0.04f
            OctopusVisualState.FLOATING -> 1f + sin(time * 0.8f) * 0.015f
            OctopusVisualState.ASKING -> 1f + sin(time * 1.2f) * 0.02f
            OctopusVisualState.SLEEPING -> 0.95f
        }

        // Gradient colors with working pulse
        val topColor = when (visualState) {
            OctopusVisualState.WORKING -> {
                val t = sin(time * TerrariumTiming.THINKING_PULSE_SPEED) * 0.5f + 0.5f
                lerpColor(LAVENDER_TOP, LAVENDER_BRIGHT, t)
            }
            OctopusVisualState.SLEEPING -> LAVENDER_DIM
            else -> LAVENDER_TOP
        }
        val bottomColor = when (visualState) {
            OctopusVisualState.SLEEPING -> DEEP_BLUE_DIM
            else -> DEEP_BLUE_BOTTOM
        }

        val gradient = Brush.linearGradient(
            colors = listOf(topColor, bottomColor),
            start = Offset(cx, cy - bodyRadius),
            end = Offset(cx, cy + bodyRadius),
        )

        // Draw each lobe clipped individually, all sampling from the SAME gradient
        // so overlap regions have identical color → no visible seams
        for (i in LOBE_OFFSETS.indices) {
            val (dx, dy) = LOBE_OFFSETS[i]
            val lobeRadius = bodyRadius * LOBE_RADII[i] * breathScale
            val lobeCx = cx + bodyRadius * dx
            val lobeCy = cy + bodyRadius * dy

            scope.drawCircle(
                brush = gradient,
                alpha = alpha,
                radius = lobeRadius,
                center = Offset(lobeCx, lobeCy),
            )
        }

        // Central fill circle to cover any inter-lobe gaps
        scope.drawCircle(
            brush = gradient,
            alpha = alpha,
            radius = bodyRadius * 0.18f * breathScale,
            center = Offset(cx, cy),
        )
    }

    /**
     * Render ">_" terminal prompt inside the cloud body.
     * Morphing animation: cursor blinks, chevron subtly pulses.
     */
    private fun drawPrompt(
        scope: DrawScope,
        cx: Float, cy: Float,
        bodyRadius: Float,
        alpha: Float,
    ) {
        if (visualState == OctopusVisualState.SLEEPING) return

        val canvas = scope.drawContext.canvas.nativeCanvas
        val textSize = bodyRadius * 0.55f

        // Cursor blink (0.8s on, 0.4s off)
        val blinkCycle = (time % 1.2f)
        val showCursor = blinkCycle < 0.8f

        val promptText = if (showCursor) ">_" else "> "

        // Working state: gentle glow pulse on text
        val textAlpha = when (visualState) {
            OctopusVisualState.WORKING -> {
                val pulse = sin(time * 2.0f) * 0.15f + 0.85f
                (alpha * pulse * 0.95f).coerceIn(0f, 1f)
            }
            else -> alpha * 0.9f
        }

        promptPaint.textSize = textSize
        promptPaint.alpha = (textAlpha * 255).toInt()
        canvas.drawText(
            promptText, cx, cy + textSize * 0.3f,
            promptPaint,
        )
    }

    /**
     * Bioluminescent orbiting particles — shown when WORKING.
     * 8 particles orbit the cloud body at varying speeds/radii.
     */
    private fun drawGlowParticles(
        scope: DrawScope,
        cx: Float, cy: Float,
        bodyRadius: Float,
        alpha: Float,
    ) {
        for (particle in glowParticles) {
            val angle = time * particle.orbitSpeed + particle.phaseOffset
            val orbitR = bodyRadius * particle.orbitRadius
            val px = cx + cos(angle) * orbitR
            val py = cy + sin(angle) * orbitR * 0.7f // oval orbit

            val particleSize = bodyRadius * particle.size
            val pulseAlpha = (sin(time * 3f + particle.phaseOffset) * 0.3f + 0.7f) * alpha * 0.6f

            // Outer glow
            scope.drawCircle(
                color = particle.color,
                alpha = pulseAlpha * 0.3f,
                radius = particleSize * 2.5f,
                center = Offset(px, py),
            )
            // Core
            scope.drawCircle(
                color = Color.White,
                alpha = pulseAlpha * 0.8f,
                radius = particleSize,
                center = Offset(px, py),
            )
        }
    }

    // Pre-allocated speech bubble tail Path
    private val bubbleTailPath = Path()

    /** Speech bubble with "?" — shown during ASKING state. */
    private fun drawSpeechBubble(scope: DrawScope, cx: Float, cy: Float, bodyRadius: Float) {
        val bubbleX = cx + bodyRadius * 1.3f
        val bubbleY = cy
        val bubbleR = bodyRadius * 0.7f

        val pulse = sin(time * 2.5f) * 0.08f + 1f
        val r = bubbleR * pulse

        scope.drawCircle(
            color = Color.White,
            alpha = 0.25f,
            radius = r,
            center = Offset(bubbleX, bubbleY),
        )
        scope.drawCircle(
            color = TerrariumColors.HUDText,
            alpha = 0.5f,
            radius = r,
            center = Offset(bubbleX, bubbleY),
            style = Stroke(width = bodyRadius * 0.04f),
        )

        bubbleTailPath.reset()
        bubbleTailPath.moveTo(bubbleX - r * 0.3f, bubbleY + r * 0.3f)
        bubbleTailPath.lineTo(cx + bodyRadius * 0.6f, cy)
        bubbleTailPath.lineTo(bubbleX - r * 0.05f, bubbleY + r * 0.5f)
        bubbleTailPath.close()
        scope.drawPath(bubbleTailPath, color = Color.White, alpha = 0.25f)

        val canvas = scope.drawContext.canvas.nativeCanvas
        val textSize = r * 1.2f
        canvas.drawText(
            "?", bubbleX, bubbleY + textSize * 0.35f,
            questionMarkPaint.apply { this.textSize = textSize },
        )
    }

    // Cached name tag layout
    private var cachedNameLayout: CachedNameLayout? = null
    private data class CachedNameLayout(
        val name: String, val fontSize: Float, val bodyRadius: Float,
        val lines: List<String>, val lineHeight: Float, val hatHeight: Float,
    )

    /** Name tag above the cloud — only shown in multi-session mode. */
    private fun drawNameTag(scope: DrawScope, cx: Float, cy: Float, bodyRadius: Float, name: String) {
        val hatY = cy - bodyRadius * 0.9f // above the top lobes
        val hatWidth = bodyRadius * 1.8f
        val baseFontSize = bodyRadius * 0.5f

        val cached = cachedNameLayout
        val chosenSize: Float
        val lines: List<String>
        val lineHeight: Float
        val hatHeight: Float

        if (cached != null && cached.name == name && cached.bodyRadius == bodyRadius) {
            chosenSize = cached.fontSize
            lines = cached.lines
            lineHeight = cached.lineHeight
            hatHeight = cached.hatHeight
        } else {
            val tiers = floatArrayOf(0.60f, 0.45f, 0.35f)
            val maxTextWidth = hatWidth * 0.9f
            var cs = baseFontSize * tiers[0]
            var ls = listOf(name)

            for (tier in tiers) {
                cs = baseFontSize * tier
                nameTagPaint.textSize = cs
                val textWidth = nameTagPaint.measureText(name)
                if (textWidth <= maxTextWidth) {
                    ls = listOf(name)
                    break
                }
                if (tier == tiers.last()) {
                    ls = wrapToTwoLines(name, nameTagPaint, maxTextWidth)
                }
            }

            chosenSize = cs
            lines = ls
            lineHeight = cs * 1.3f
            hatHeight = if (ls.size == 1) bodyRadius * 0.5f else lineHeight * ls.size + cs * 0.3f
            cachedNameLayout = CachedNameLayout(name, cs, bodyRadius, ls, lineHeight, hatHeight)
        }

        val canvas = scope.drawContext.canvas.nativeCanvas

        // Hat background — codex blue-purple tint
        scope.drawRoundRect(
            color = DEEP_BLUE_BOTTOM,
            alpha = 0.6f,
            topLeft = Offset(cx - hatWidth / 2, hatY - hatHeight),
            size = Size(hatWidth, hatHeight),
            cornerRadius = CornerRadius(4f, 4f),
        )

        nameTagPaint.textSize = chosenSize
        if (lines.size == 1) {
            canvas.drawText(
                lines[0], cx, hatY - hatHeight * 0.25f,
                nameTagPaint,
            )
        } else {
            val topY = hatY - hatHeight + chosenSize * 0.3f + chosenSize
            for (i in lines.indices) {
                canvas.drawText(
                    lines[i], cx, topY + i * lineHeight,
                    nameTagPaint,
                )
            }
        }
    }

    private fun wrapToTwoLines(text: String, paint: Paint, maxWidth: Float): List<String> {
        val spaces = text.indices.filter { text[it] == ' ' }
        if (spaces.isEmpty()) return listOf(text)

        var bestSplit = spaces.minByOrNull { kotlin.math.abs(it - text.length / 2) } ?: return listOf(text)
        var bestMax = Float.MAX_VALUE

        for (sp in spaces) {
            val line1 = text.substring(0, sp)
            val line2 = text.substring(sp + 1)
            val w1 = paint.measureText(line1)
            val w2 = paint.measureText(line2)
            val maxW = maxOf(w1, w2)
            if (maxW < bestMax) {
                bestMax = maxW
                bestSplit = sp
            }
        }

        return listOf(text.substring(0, bestSplit), text.substring(bestSplit + 1))
    }

    private fun lerpColor(a: Color, b: Color, t: Float): Color {
        return Color(
            red = a.red + (b.red - a.red) * t,
            green = a.green + (b.green - a.green) * t,
            blue = a.blue + (b.blue - a.blue) * t,
            alpha = a.alpha + (b.alpha - a.alpha) * t,
        )
    }

    private val promptPaint = Paint().apply {
        isAntiAlias = true
        color = android.graphics.Color.WHITE
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }

    private val questionMarkPaint = Paint().apply {
        isAntiAlias = true
        color = android.graphics.Color.argb(180, 226, 232, 240)
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }

    private val nameTagPaint = Paint().apply {
        isAntiAlias = true
        color = android.graphics.Color.argb(220, 226, 232, 240)
        textAlign = Paint.Align.CENTER
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    }

    companion object {
        // Positions
        /** FLOATING (idle): rests on floor. */
        private const val STANDING_Y = 0.58f
        /** SLEEPING: dim, near bottom. */
        private const val STANDING_Y_DEEP = 0.75f
        /** ASKING: mid-water. */
        private const val ASKING_Y = 0.40f
        /** WORKING: floats near surface, wide drift zone. */
        private const val WORKING_CENTER_Y = 0.12f
        private const val WORKING_MIN_Y = 0.08f
        private const val WORKING_MAX_Y = 0.30f

        // Gradient colors — from official codex-color.svg: #B1A7FF → #7A9DFF → #3941FF
        private val LAVENDER_TOP = Color(0xFFB1A7FF)       // lavender (official top)
        private val DEEP_BLUE_BOTTOM = Color(0xFF3941FF)   // vivid blue (official bottom)
        private val LAVENDER_BRIGHT = Color(0xFFD0C4FF)    // working pulse bright
        private val LAVENDER_DIM = Color(0xFF7A7099)       // sleeping top
        private val DEEP_BLUE_DIM = Color(0xFF2A2F80)      // sleeping bottom

        // Bioluminescent glow particle colors
        private val GLOW_CYAN = Color(0xFF66DDFF)
        private val GLOW_LAVENDER = Color(0xFFD0AAFF)
        private const val GLOW_PARTICLE_COUNT = 8

        /**
         * 6-lobe clover offsets relative to body radius.
         * Arranged as: top-left, top-right, right, bottom-right, bottom-left, left.
         */
        private val LOBE_OFFSETS = arrayOf(
            -0.14f to -0.30f,  // top-left
             0.16f to -0.26f,  // top-right
             0.32f to -0.02f,  // right
             0.14f to  0.26f,  // bottom-right
            -0.16f to  0.26f,  // bottom-left
            -0.32f to -0.02f,  // left
        )

        /**
         * Lobe radii as fraction of bodyRadius (0.28–0.30 range).
         */
        private val LOBE_RADII = floatArrayOf(
            0.30f, 0.29f, 0.28f, 0.29f, 0.30f, 0.28f,
        )
    }
}
