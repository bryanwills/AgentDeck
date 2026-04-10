package dev.agentdeck.terrarium

import android.graphics.Paint

object CreatureNameTagStyle {
    // Use the tablet OpenCode creature as the SSOT for name-tag sizing.
    const val REFERENCE_BODY_FRACTION = 0.064f
    const val GAP_RATIO = 0.05f
    const val WIDTH_RATIO = 1.6f
    const val BASE_FONT_RATIO = 0.40f
    const val MIN_HEIGHT_RATIO = 0.25f
    const val TEXT_WIDTH_RATIO = 0.9f
    const val PADDING_RATIO = 0.12f
    const val LINE_HEIGHT_RATIO = 1.3f
    const val MULTILINE_EXTRA_RATIO = 0.3f

    val FONT_TIERS = floatArrayOf(0.60f, 0.45f, 0.35f)
}

data class CreatureNameTagLayout(
    val bodyMetric: Float,
    val tagBottomY: Float,
    val tagWidth: Float,
    val tagHeight: Float,
    val fontSize: Float,
    val lines: List<String>,
    val lineHeight: Float,
)

fun creatureNameTagMetric(canvasWidth: Float, scaleFactor: Float): Float {
    return canvasWidth * CreatureNameTagStyle.REFERENCE_BODY_FRACTION * scaleFactor
}

fun resolveCreatureNameTagLayout(
    name: String,
    bodyTopY: Float,
    bodyMetric: Float,
    paint: Paint,
): CreatureNameTagLayout {
    val tagWidth = bodyMetric * CreatureNameTagStyle.WIDTH_RATIO
    val maxTextWidth = tagWidth * CreatureNameTagStyle.TEXT_WIDTH_RATIO
    var chosenSize = bodyMetric * CreatureNameTagStyle.BASE_FONT_RATIO * CreatureNameTagStyle.FONT_TIERS.first()
    var lines = listOf(name)

    for (tier in CreatureNameTagStyle.FONT_TIERS) {
        chosenSize = bodyMetric * CreatureNameTagStyle.BASE_FONT_RATIO * tier
        paint.textSize = chosenSize
        val textWidth = paint.measureText(name)
        if (textWidth <= maxTextWidth) {
            lines = listOf(name)
            break
        }
        if (tier == CreatureNameTagStyle.FONT_TIERS.last()) {
            lines = wrapCreatureNameTagToTwoLines(name, paint)
        }
    }

    val lineHeight = chosenSize * CreatureNameTagStyle.LINE_HEIGHT_RATIO
    val tagHeight = if (lines.size == 1) {
        bodyMetric * CreatureNameTagStyle.MIN_HEIGHT_RATIO
    } else {
        lineHeight * lines.size + chosenSize * CreatureNameTagStyle.MULTILINE_EXTRA_RATIO
    }

    return CreatureNameTagLayout(
        bodyMetric = bodyMetric,
        tagBottomY = bodyTopY - bodyMetric * CreatureNameTagStyle.GAP_RATIO,
        tagWidth = tagWidth,
        tagHeight = tagHeight,
        fontSize = chosenSize,
        lines = lines,
        lineHeight = lineHeight,
    )
}

fun wrapCreatureNameTagToTwoLines(text: String, paint: Paint): List<String> {
    val spaces = text.indices.filter { text[it] == ' ' }
    if (spaces.isEmpty()) return listOf(text)

    var bestSplit = spaces.minByOrNull { kotlin.math.abs(it - text.length / 2) } ?: return listOf(text)
    var bestMax = Float.MAX_VALUE

    for (sp in spaces) {
        val line1 = text.substring(0, sp)
        val line2 = text.substring(sp + 1)
        val maxWidth = maxOf(paint.measureText(line1), paint.measureText(line2))
        if (maxWidth < bestMax) {
            bestMax = maxWidth
            bestSplit = sp
        }
    }

    return listOf(text.substring(0, bestSplit), text.substring(bestSplit + 1))
}
