package dev.agentdeck.terrarium.renderer

import android.graphics.Bitmap
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.IntSize
import dev.agentdeck.terrarium.CrayfishVisualState
import dev.agentdeck.terrarium.OctopusVisualState
import dev.agentdeck.terrarium.TetraVisualState
import dev.agentdeck.terrarium.TerrariumState
import dev.agentdeck.terrarium.TerrariumTiming
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** E-ink animation frame interval (ms). 800ms is safe for Crema A2 ~120ms refresh. */
private const val EINK_ANIM_FRAME_MS = 800L

// --- E-ink octopus pixel grid (12×9, matching OctopusCreature) ---

private const val EINK_OCTOPUS_COLS = 12
private const val EINK_OCTOPUS_ROWS = 6
private const val EINK_PIXEL_ASPECT = 1.7f
private val EINK_OCTOPUS_GRID = arrayOf(
    intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 0: head (10w)
    intArrayOf(0, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 0), // row 1: eyes (10w)
    intArrayOf(3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4), // row 2: body + arms (12w)
    intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 3: body (10w)
    intArrayOf(0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0), // row 4: waist (10w)
    intArrayOf(0, 0, 5, 0, 5, 0, 0, 6, 0, 6, 0, 0), // row 5: tentacles ×4
)

// --- E-ink crayfish SVG paths (cached, android.graphics.Path) ---

private const val EINK_SVG_VIEWBOX = 120f

private val einkCrayfishBodyPath: android.graphics.Path by lazy {
    android.graphics.Path().apply {
        moveTo(60f, 10f)
        cubicTo(30f, 10f, 15f, 35f, 15f, 55f)
        cubicTo(15f, 75f, 30f, 95f, 45f, 100f)
        lineTo(45f, 110f)
        lineTo(55f, 110f)
        lineTo(55f, 100f)
        cubicTo(55f, 100f, 60f, 102f, 65f, 100f)
        lineTo(65f, 110f)
        lineTo(75f, 110f)
        lineTo(75f, 100f)
        cubicTo(90f, 95f, 105f, 75f, 105f, 55f)
        cubicTo(105f, 35f, 90f, 10f, 60f, 10f)
        close()
    }
}

private val einkCrayfishLeftClawPath: android.graphics.Path by lazy {
    android.graphics.Path().apply {
        moveTo(20f, 45f)
        cubicTo(5f, 40f, 0f, 50f, 5f, 60f)
        cubicTo(10f, 70f, 20f, 65f, 25f, 55f)
        cubicTo(28f, 48f, 25f, 45f, 20f, 45f)
        close()
    }
}

private val einkCrayfishRightClawPath: android.graphics.Path by lazy {
    android.graphics.Path().apply {
        moveTo(100f, 45f)
        cubicTo(115f, 40f, 120f, 50f, 115f, 60f)
        cubicTo(110f, 70f, 100f, 65f, 95f, 55f)
        cubicTo(92f, 48f, 95f, 45f, 100f, 45f)
        close()
    }
}

private val einkCrayfishLeftAntennaPath: android.graphics.Path by lazy {
    android.graphics.Path().apply {
        moveTo(45f, 15f)
        quadTo(35f, 5f, 30f, 8f)
    }
}

private val einkCrayfishRightAntennaPath: android.graphics.Path by lazy {
    android.graphics.Path().apply {
        moveTo(75f, 15f)
        quadTo(85f, 5f, 90f, 8f)
    }
}

/**
 * E-ink terrarium renderer — draws creatures into an offscreen bitmap,
 * applies Floyd-Steinberg dithering, then renders the 1-bit result.
 *
 * Style: "Marine biologist's journal" — pixel blocks + SVG outlines, high contrast.
 * Supports slow 4-frame animation (800ms interval) for active states.
 */
@Composable
fun EinkTerrariumView(
    state: TerrariumState,
    modifier: Modifier = Modifier,
) {
    var renderedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var lastRenderState by remember { mutableStateOf<TerrariumState?>(null) }
    var pendingRender by remember { mutableLongStateOf(0L) }
    var animFrame by remember { mutableIntStateOf(0) }

    val isAnimating = state.octopus != OctopusVisualState.SLEEPING ||
        (state.crayfish != CrayfishVisualState.DORMANT && state.crayfish != CrayfishVisualState.SITTING)

    // Animation loop for active states (4-frame, 800ms interval)
    LaunchedEffect(isAnimating) {
        if (!isAnimating) return@LaunchedEffect
        while (isActive) {
            delay(EINK_ANIM_FRAME_MS)
            animFrame = (animFrame + 1) % 4
            renderedBitmap = renderEinkFrame(state, EINK_WIDTH, EINK_HEIGHT, animFrame)
        }
    }

    // Debounced re-render on state change
    LaunchedEffect(state.octopus, state.crayfish, state.tetra, state.environment, state.agents.size) {
        if (state == lastRenderState) return@LaunchedEffect
        pendingRender = System.currentTimeMillis()
        delay(TerrariumTiming.EINK_DEBOUNCE_MS)

        if (System.currentTimeMillis() - pendingRender >= TerrariumTiming.EINK_DEBOUNCE_MS - 50) {
            lastRenderState = state
            animFrame = 0
            renderedBitmap = renderEinkFrame(state, EINK_WIDTH, EINK_HEIGHT, 0)
        }
    }

    // Initial render
    LaunchedEffect(Unit) {
        if (renderedBitmap == null) {
            renderedBitmap = renderEinkFrame(state, EINK_WIDTH, EINK_HEIGHT, 0)
            lastRenderState = state
        }
    }

    Canvas(modifier = modifier.fillMaxSize()) {
        val bmp = renderedBitmap ?: return@Canvas
        drawImage(
            image = bmp.asImageBitmap(),
            dstSize = IntSize(size.width.toInt(), size.height.toInt()),
        )
    }
}

/** Render a single e-ink frame with optional animation. */
private fun renderEinkFrame(
    state: TerrariumState, width: Int, height: Int, animFrame: Int = 0,
): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val paint = Paint().apply { isAntiAlias = false }

    // White background
    canvas.drawColor(android.graphics.Color.WHITE)

    // Tank border — rounded rectangle for aquarium glass feel
    paint.color = android.graphics.Color.BLACK
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 3f
    val tankRect = RectF(4f, 4f, width - 4f, height - 4f)
    canvas.drawRoundRect(tankRect, 12f, 12f, paint)

    // Water surface — double wave
    val surfaceY = height * 0.08f
    paint.strokeWidth = 1.5f
    canvas.drawLine(8f, surfaceY, width - 8f, surfaceY, paint)

    // Wave marks on surface
    paint.strokeWidth = 1f
    for (i in 0 until 8) {
        val x = width * (0.05f + i * 0.12f)
        canvas.drawArc(
            RectF(x, surfaceY - 3f, x + 15f, surfaceY + 3f),
            180f, 180f, false, paint,
        )
    }

    // Bubbles — scattered near surface
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 0.8f
    for (i in 0 until 4) {
        val bx = width * (0.15f + i * 0.2f + (i % 2) * 0.05f)
        val by = surfaceY + height * (0.05f + i * 0.08f)
        canvas.drawCircle(bx, by, 2f + i * 0.5f, paint)
    }

    // Environment
    drawEinkSeaweed(canvas, paint, width, height)
    drawEinkRocks(canvas, paint, width, height)
    drawEinkGravel(canvas, paint, width, height)

    // Creatures
    if (state.agents.size > 1) {
        val slots = dev.agentdeck.terrarium.layoutOctopuses(state.agents.size)
        for (i in state.agents.indices) {
            val slot = slots.getOrElse(i) { slots.last() }
            drawEinkOctopus(canvas, paint, width, height,
                state.agents[i].visualState, state.agents[i].agentType,
                centerXFraction = slot.centerXFraction, centerYFraction = slot.centerYFraction,
                scaleFactor = slot.scaleFactor, animFrame = animFrame)
        }
    } else {
        drawEinkOctopus(canvas, paint, width, height, state.octopus, state.agentType,
            animFrame = animFrame)
    }
    drawEinkCrayfish(canvas, paint, width, height, state.crayfish, animFrame)
    drawEinkDataParticles(canvas, paint, width, height, state.tetra, state.agents.size)

    // State label at bottom
    paint.style = Paint.Style.FILL
    paint.textSize = 14f
    paint.color = android.graphics.Color.BLACK
    val label = einkStateLabel(state)
    val textWidth = paint.measureText(label)
    canvas.drawText(label, (width - textWidth) / 2, height - 12f, paint)

    // Apply Floyd-Steinberg dithering
    DitherEngine.floydSteinberg(bitmap)

    return bitmap
}

// --- Environment ---

private fun drawEinkRocks(canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int) {
    val bottomY = h * 0.82f
    paint.style = Paint.Style.FILL
    paint.color = android.graphics.Color.BLACK

    // Right rock cluster
    val rockPath = android.graphics.Path().apply {
        moveTo(w * 0.65f, h.toFloat())
        lineTo(w * 0.62f, bottomY)
        cubicTo(w * 0.68f, bottomY - h * 0.06f, w * 0.82f, bottomY - h * 0.08f, w * 0.88f, bottomY)
        lineTo(w * 0.92f, h.toFloat())
        close()
    }
    canvas.drawPath(rockPath, paint)

    // Left small rocks
    val leftRock = android.graphics.Path().apply {
        moveTo(w * 0.02f, h.toFloat())
        lineTo(w * 0.04f, bottomY + h * 0.02f)
        cubicTo(w * 0.08f, bottomY - h * 0.02f, w * 0.14f, bottomY - h * 0.01f, w * 0.18f, bottomY + h * 0.03f)
        lineTo(w * 0.20f, h.toFloat())
        close()
    }
    canvas.drawPath(leftRock, paint)

    // Sand texture lines
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 0.5f
    for (i in 0 until 4) {
        val y = bottomY + (h - bottomY) * (0.3f + i * 0.15f)
        canvas.drawLine(w * 0.05f, y, w * 0.25f + i * w * 0.1f, y + 2f, paint)
    }
}

private fun drawEinkSeaweed(canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int) {
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1.2f
    paint.color = android.graphics.Color.BLACK

    // Left wall: 2 wavy stems
    for (stem in 0 until 2) {
        val baseX = w * (0.04f + stem * 0.04f)
        val path = android.graphics.Path().apply {
            moveTo(baseX, h * 0.85f)
            for (seg in 0 until 4) {
                val segY = h * (0.85f - (seg + 1) * 0.12f)
                val cpX = baseX + (if (seg % 2 == 0) w * 0.02f else -w * 0.01f)
                quadTo(cpX, segY + h * 0.06f, baseX + (seg % 2) * w * 0.01f, segY)
            }
        }
        canvas.drawPath(path, paint)
    }

    // Right wall: 1 stem near rocks
    val rightBaseX = w * 0.93f
    val rightPath = android.graphics.Path().apply {
        moveTo(rightBaseX, h * 0.85f)
        for (seg in 0 until 3) {
            val segY = h * (0.85f - (seg + 1) * 0.14f)
            val cpX = rightBaseX + (if (seg % 2 == 0) -w * 0.015f else w * 0.01f)
            quadTo(cpX, segY + h * 0.07f, rightBaseX - (seg % 2) * w * 0.005f, segY)
        }
    }
    canvas.drawPath(rightPath, paint)
}

private fun drawEinkGravel(canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int) {
    val bottomY = h * 0.88f
    paint.color = android.graphics.Color.BLACK

    // Gravel: small dots along bottom
    paint.style = Paint.Style.FILL
    for (i in 0 until 20) {
        val x = w * (0.05f + i * 0.045f)
        val y = bottomY + (i % 3) * 3f
        canvas.drawCircle(x, y, 1f + (i % 2) * 0.5f, paint)
    }

    // Pebbles: small ovals
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 0.8f
    canvas.drawOval(RectF(w * 0.20f, bottomY, w * 0.26f, bottomY + h * 0.04f), paint)
    canvas.drawOval(RectF(w * 0.40f, bottomY + 2f, w * 0.45f, bottomY + h * 0.035f), paint)
    canvas.drawOval(RectF(w * 0.60f, bottomY + 1f, w * 0.64f, bottomY + h * 0.03f), paint)
}

// --- Creatures ---

/** E-ink octopus — 12×9 pixel block rendering matching the color OctopusCreature grid. */
private fun drawEinkOctopus(
    canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int,
    state: OctopusVisualState,
    agentType: String? = null,
    centerXFraction: Float = 0.38f,
    centerYFraction: Float = 0.42f,
    scaleFactor: Float = 1f,
    animFrame: Int = 0,
) {
    paint.color = android.graphics.Color.BLACK

    val cx = w * centerXFraction
    val cy = when (state) {
        OctopusVisualState.SLEEPING -> h * 0.75f
        else -> h * centerYFraction
    }

    // Pixel block grid — 12×7, portrait-rectangle pixels (1:1.3 aspect)
    val bodyWidth = w * 0.14f * scaleFactor
    val pixelW = bodyWidth / EINK_OCTOPUS_COLS
    val pixelH = pixelW * EINK_PIXEL_ASPECT
    val gridW = EINK_OCTOPUS_COLS * pixelW
    val gridH = EINK_OCTOPUS_ROWS * pixelH
    val startX = cx - gridW / 2f
    val startY = cy - gridH / 2f

    // Animation offsets (4-frame, left/right opposite phase)
    val isActive = state != OctopusVisualState.SLEEPING
    val leftTentacleOffset = if (isActive) when (animFrame % 4) {
        1 -> pixelH * 0.4f
        3 -> -pixelH * 0.4f
        else -> 0f
    } else 0f
    val rightTentacleOffset = -leftTentacleOffset
    val leftArmOffset = if (isActive) when (animFrame % 4) {
        0 -> pixelH * 0.2f
        2 -> -pixelH * 0.2f
        else -> 0f
    } else 0f
    val rightArmOffset = -leftArmOffset

    paint.style = Paint.Style.FILL
    for (row in 0 until EINK_OCTOPUS_ROWS) {
        for (col in 0 until EINK_OCTOPUS_COLS) {
            val cell = EINK_OCTOPUS_GRID[row][col]
            if (cell == 0) continue

            val px = startX + col * pixelW
            var py = startY + row * pixelH

            // Apply animation offsets
            when (cell) {
                3 -> py += leftArmOffset        // LEFT_ARM
                4 -> py += rightArmOffset        // RIGHT_ARM
                5 -> py += leftTentacleOffset    // LEFT_LEG
                6 -> py += rightTentacleOffset   // RIGHT_LEG
            }

            when (cell) {
                2 -> { // EYE
                    if (state == OctopusVisualState.SLEEPING) {
                        // Closed eyes — thin horizontal line
                        canvas.drawRect(
                            px, py + pixelH * 0.4f,
                            px + pixelW, py + pixelH * 0.6f, paint,
                        )
                    } else {
                        canvas.drawRect(px, py, px + pixelW, py + pixelH, paint)
                    }
                }
                else -> {
                    canvas.drawRect(px, py, px + pixelW, py + pixelH, paint)
                }
            }
        }
    }

    // State-specific decorations
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1f * scaleFactor
    when (state) {
        OctopusVisualState.TYPING -> {
            val kbW = gridW * 0.8f
            val kbH = gridH * 0.25f
            val kbY = startY + gridH + pixelH
            canvas.drawRect(cx - kbW / 2, kbY, cx + kbW / 2, kbY + kbH, paint)
            for (r in 1 until 3) {
                val y = kbY + r * kbH / 3
                canvas.drawLine(cx - kbW / 2, y, cx + kbW / 2, y, paint)
            }
        }
        OctopusVisualState.OFFERING -> {
            paint.strokeWidth = 2f * scaleFactor
            val checkX = cx - gridW * 0.6f
            val checkY = cy
            canvas.drawLine(checkX - 6f, checkY, checkX, checkY + 6f, paint)
            canvas.drawLine(checkX, checkY + 6f, checkX + 10f, checkY - 8f, paint)
            val xX = cx + gridW * 0.6f
            canvas.drawLine(xX - 6f, checkY - 6f, xX + 6f, checkY + 6f, paint)
            canvas.drawLine(xX + 6f, checkY - 6f, xX - 6f, checkY + 6f, paint)
        }
        OctopusVisualState.REVIEWING -> {
            val halfW = gridW / 2f
            val halfH = gridH / 2f
            for (side in listOf(-1f, 1f)) {
                val docX = cx + side * halfW * 2f
                val docY = cy - halfH * 0.5f
                canvas.drawRect(docX - halfW * 0.8f, docY, docX + halfW * 0.8f, docY + halfH * 1.5f, paint)
                for (l in 0 until 4) {
                    val ly = docY + 4f + l * halfH * 0.35f
                    canvas.drawLine(docX - halfW * 0.6f, ly, docX + halfW * 0.4f, ly, paint)
                }
            }
        }
        else -> {}
    }
}

/** E-ink crayfish — front-facing SVG path rendering with claw/antenna animation. */
private fun drawEinkCrayfish(
    canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int,
    state: CrayfishVisualState,
    animFrame: Int = 0,
) {
    paint.color = android.graphics.Color.BLACK

    val cx = w * 0.75f
    val cy = when (state) {
        CrayfishVisualState.DORMANT -> h * 0.82f
        else -> h * 0.65f
    }
    val bodyWidth = w * 0.14f

    if (state == CrayfishVisualState.DORMANT) {
        // Only show antenna tips above rocks
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        canvas.drawLine(cx - bodyWidth * 0.1f, cy - bodyWidth * 0.1f,
            cx - bodyWidth * 0.3f, cy - bodyWidth * 0.4f, paint)
        canvas.drawLine(cx + bodyWidth * 0.1f, cy - bodyWidth * 0.1f,
            cx + bodyWidth * 0.3f, cy - bodyWidth * 0.4f, paint)
        return
    }

    val scale = bodyWidth / EINK_SVG_VIEWBOX
    val offsetX = cx - EINK_SVG_VIEWBOX / 2f * scale
    val offsetY = cy - EINK_SVG_VIEWBOX / 2f * scale

    // Claw animation based on animFrame and state
    val isAnimated = state != CrayfishVisualState.SITTING && state != CrayfishVisualState.DORMANT
    val clawAngle = if (isAnimated) when (state) {
        CrayfishVisualState.ROUTING -> when (animFrame % 4) {
            1 -> 15f; 3 -> -10f; else -> 0f
        }
        CrayfishVisualState.OBSERVING -> when (animFrame % 4) {
            1 -> 8f; 3 -> -5f; else -> 3f
        }
        CrayfishVisualState.WAITING -> 12f  // claws open
        else -> 0f
    } else 0f

    // Antenna wiggle (in SVG coordinate units)
    val antennaWiggle = if (isAnimated) when (animFrame % 4) {
        1 -> 2f; 3 -> -2f; else -> 0f
    } else 0f

    canvas.save()
    canvas.translate(offsetX, offsetY)
    canvas.scale(scale, scale)

    // 1. Body — filled
    paint.style = Paint.Style.FILL
    canvas.drawPath(einkCrayfishBodyPath, paint)

    // 2. Left claw with rotation
    canvas.save()
    canvas.rotate(-clawAngle, 20f, 45f)
    canvas.drawPath(einkCrayfishLeftClawPath, paint)
    canvas.restore()

    // 3. Right claw with rotation
    canvas.save()
    canvas.rotate(clawAngle, 100f, 45f)
    canvas.drawPath(einkCrayfishRightClawPath, paint)
    canvas.restore()

    // 4. Antennae — stroked
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 3f
    paint.strokeCap = Paint.Cap.ROUND

    canvas.save()
    canvas.translate(antennaWiggle, 0f)
    canvas.drawPath(einkCrayfishLeftAntennaPath, paint)
    canvas.restore()

    canvas.save()
    canvas.translate(-antennaWiggle, 0f)
    canvas.drawPath(einkCrayfishRightAntennaPath, paint)
    canvas.restore()

    // 5. Eyes — white circles on black body
    paint.style = Paint.Style.FILL
    paint.color = android.graphics.Color.WHITE
    canvas.drawCircle(45f, 35f, 6f, paint)
    canvas.drawCircle(75f, 35f, 6f, paint)

    // Eye pupils
    paint.color = android.graphics.Color.BLACK
    canvas.drawCircle(46f, 34f, 2.5f, paint)
    canvas.drawCircle(76f, 34f, 2.5f, paint)

    canvas.restore() // main transform

    // ROUTING: signal arcs (outside SVG transform)
    if (state == CrayfishVisualState.ROUTING) {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.5f
        paint.color = android.graphics.Color.BLACK
        paint.strokeCap = Paint.Cap.BUTT
        for (i in 1..3) {
            val r = bodyWidth * 0.15f * i
            canvas.drawArc(
                RectF(cx - r, cy - r, cx + r, cy + r),
                150f, 60f, false, paint,
            )
        }
    }
}

// --- Data particles & labels ---

private fun drawEinkDataParticles(
    canvas: android.graphics.Canvas, paint: Paint, w: Int, h: Int,
    state: TetraVisualState,
    agentCount: Int,
) {
    if (state == TetraVisualState.ABSENT) return

    paint.color = android.graphics.Color.BLACK
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 0.8f

    // Draw dotted connection lines between active agent positions
    val slots = dev.agentdeck.terrarium.layoutOctopuses(agentCount.coerceAtLeast(1))

    if (state == TetraVisualState.STREAMING || state == TetraVisualState.CIRCLING) {
        // Draw data flow dots from primary agent to environment
        val primary = slots.firstOrNull() ?: return
        val srcX = w * primary.centerXFraction
        val srcY = h * primary.centerYFraction

        // Dotted line down to rocks area
        val dstX = w * 0.5f
        val dstY = h * 0.75f
        val dotCount = 8
        val dotRadius = 1.5f
        paint.style = Paint.Style.FILL
        for (i in 0 until dotCount) {
            val t = i.toFloat() / (dotCount - 1)
            val x = srcX + (dstX - srcX) * t
            val y = srcY + (dstY - srcY) * t + kotlin.math.sin(t * 3.14f) * h * 0.05f
            canvas.drawCircle(x, y, dotRadius, paint)
        }

        // If multiple agents, draw dotted lines between them
        if (slots.size > 1) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 0.5f
            val dashPath = DashPathEffect(floatArrayOf(4f, 4f), 0f)
            paint.pathEffect = dashPath
            for (i in 0 until slots.size - 1) {
                val a = slots[i]
                val b = slots[i + 1]
                canvas.drawLine(
                    w * a.centerXFraction, h * a.centerYFraction,
                    w * b.centerXFraction, h * b.centerYFraction,
                    paint,
                )
            }
            paint.pathEffect = null
        }
    } else if (state == TetraVisualState.HOVERING) {
        // Small dots near options area
        paint.style = Paint.Style.FILL
        for (i in 0 until 5) {
            val x = w * (0.55f + (i % 3) * 0.04f)
            val y = h * (0.35f + (i / 3) * 0.04f)
            canvas.drawCircle(x, y, 1.5f, paint)
        }
    }
}

private fun einkStateLabel(state: TerrariumState): String {
    val creature = when (state.octopus) {
        OctopusVisualState.SLEEPING -> "Dormant"
        OctopusVisualState.FLOATING -> "Observing"
        OctopusVisualState.THINKING -> "Contemplating"
        OctopusVisualState.TYPING -> "Scribing"
        OctopusVisualState.OFFERING -> "Presenting Choice"
        OctopusVisualState.PRESENTING -> "Displaying Options"
        OctopusVisualState.REVIEWING -> "Comparing Documents"
    }
    val tool = state.currentTool?.let { " — $it" } ?: ""
    val agents = if (state.agents.size > 1) " [${state.agents.size}]" else ""
    return "$creature$tool$agents"
}

/** Vendor-specific EPD refresh control. */
object EinkRefreshHelper {
    fun requestFullRefresh(view: View) {
        try {
            // Crema: com.crema.ink.EinkDisplay.requestFullUpdate()
            val cremaClass = Class.forName("com.crema.ink.EinkDisplay")
            cremaClass.getMethod("requestFullUpdate", View::class.java).invoke(null, view)
            return
        } catch (_: Exception) {}

        try {
            // Onyx: com.onyx.android.sdk.device.Device.requestFullUpdate()
            val onyxClass = Class.forName("com.onyx.android.sdk.device.Device")
            onyxClass.getMethod("requestScreenUpdate", View::class.java).invoke(null, view)
            return
        } catch (_: Exception) {}

        // Fallback: standard invalidate
        view.invalidate()
    }

    fun requestPartialRefresh(view: View) {
        view.invalidate()
    }

    /** A2 mode — fastest binary refresh, ideal for state markers and timeline. */
    fun requestA2Refresh(view: View) {
        try {
            // Onyx: setViewDefaultUpdateMode with ANIMATION/A2
            val deviceClass = Class.forName("com.onyx.android.sdk.device.BaseDevice")
            val instance = deviceClass.getMethod("currentDevice").invoke(null)
            val updateModeClass = Class.forName("com.onyx.android.sdk.device.BaseDevice\$UpdateMode")
            val a2Mode = updateModeClass.getField("ANIMATION").get(null)
            deviceClass.getMethod("setViewDefaultUpdateMode", View::class.java, updateModeClass)
                .invoke(instance, view, a2Mode)
            view.invalidate()
            return
        } catch (_: Exception) {}

        try {
            // Crema: requestPartialUpdate for region
            val cremaClass = Class.forName("com.crema.ink.EinkDisplay")
            cremaClass.getMethod("requestPartialUpdate", View::class.java).invoke(null, view)
            return
        } catch (_: Exception) {}

        // Fallback
        view.invalidate()
    }

    /** DU mode — fast monochrome refresh, ideal for usage gauges and footer. */
    fun requestDURefresh(view: View) {
        try {
            // Onyx: setViewDefaultUpdateMode with DU
            val deviceClass = Class.forName("com.onyx.android.sdk.device.BaseDevice")
            val instance = deviceClass.getMethod("currentDevice").invoke(null)
            val updateModeClass = Class.forName("com.onyx.android.sdk.device.BaseDevice\$UpdateMode")
            val duMode = updateModeClass.getField("DU").get(null)
            deviceClass.getMethod("setViewDefaultUpdateMode", View::class.java, updateModeClass)
                .invoke(instance, view, duMode)
            view.invalidate()
            return
        } catch (_: Exception) {}

        try {
            // Crema: requestPartialUpdate
            val cremaClass = Class.forName("com.crema.ink.EinkDisplay")
            cremaClass.getMethod("requestPartialUpdate", View::class.java).invoke(null, view)
            return
        } catch (_: Exception) {}

        // Fallback
        view.invalidate()
    }
}

private const val EINK_WIDTH = 600
private const val EINK_HEIGHT = 300
