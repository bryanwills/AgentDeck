package dev.agentdeck.terrarium.environment

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.DrawScope
import dev.agentdeck.terrarium.EnvironmentVisualState
import dev.agentdeck.terrarium.TerrariumColors
import dev.agentdeck.terrarium.creature.Creature
import kotlin.random.Random

/**
 * Sand particles kicked up by creatures near the bottom.
 * Ring buffer of 20 particles — spawned when a creature's Y > 0.62.
 * Particles rise briefly then sink back down under gravity.
 */
class SandDisturbance : Creature {

    private data class SandParticle(
        var x: Float = 0f,
        var y: Float = 0f,
        var vx: Float = 0f,
        var vy: Float = 0f,
        var alpha: Float = 0f,
        var size: Float = 0f,
        var age: Float = 0f,
        var lifetime: Float = 0f,
        var alive: Boolean = false,
    )

    private val particles = Array(MAX_PARTICLES) { SandParticle() }
    private var nextSlot = 0
    private var time by mutableFloatStateOf(0f)
    private var timeSinceSpawn = 0f
    private var envState by mutableStateOf(EnvironmentVisualState.CALM)

    // Creature positions fed from MonitorScreen
    private var creaturePositions = listOf<Pair<Float, Float>>()

    fun setState(state: EnvironmentVisualState) {
        envState = state
    }

    /** Feed creature positions each frame for proximity check. */
    fun setCreaturePositions(positions: List<Pair<Float, Float>>) {
        creaturePositions = positions
    }

    override fun update(dt: Float) {
        time += dt
        timeSinceSpawn += dt * 1000f

        val spawnInterval = when (envState) {
            EnvironmentVisualState.DARK -> Float.MAX_VALUE
            EnvironmentVisualState.CALM -> 3000f
            EnvironmentVisualState.ACTIVE -> 1500f
            EnvironmentVisualState.ALERT -> 2000f
        }

        // Spawn from creatures near sand line
        if (timeSinceSpawn >= spawnInterval) {
            timeSinceSpawn -= spawnInterval
            for ((cx, cy) in creaturePositions) {
                if (cy > SAND_PROXIMITY_THRESHOLD) {
                    spawnParticle(cx, cy)
                    break // one burst per spawn tick
                }
            }
        }

        // Update existing particles
        for (p in particles) {
            if (!p.alive) continue
            p.age += dt
            if (p.age >= p.lifetime) {
                p.alive = false
                continue
            }

            p.vy += GRAVITY * dt // gravity pulls back down
            p.x += p.vx * dt
            p.y += p.vy * dt

            // Fade out over lifetime
            p.alpha = (0.3f * (1f - p.age / p.lifetime)).coerceAtLeast(0f)
        }
    }

    override fun draw(scope: DrawScope) {
        val w = scope.size.width
        val h = scope.size.height

        for (p in particles) {
            if (!p.alive) continue

            scope.drawCircle(
                color = TerrariumColors.SandLight.copy(alpha = p.alpha),
                radius = p.size * w,
                center = Offset(p.x * w, p.y * h),
            )
        }
    }

    /** Emit sand particles from external source (creature near bottom). */
    fun emitAt(nx: Float, ny: Float, count: Int = 3) {
        repeat(count) {
            spawnParticle(nx, ny)
        }
    }

    private fun spawnParticle(cx: Float, cy: Float) {
        val p = particles[nextSlot]
        nextSlot = (nextSlot + 1) % MAX_PARTICLES

        p.x = cx + (Random.nextFloat() - 0.5f) * 0.04f
        p.y = cy + Random.nextFloat() * 0.02f
        p.vx = (Random.nextFloat() - 0.5f) * 0.02f
        p.vy = -(Random.nextFloat() * 0.02f + 0.02f) // upward initial velocity
        p.alpha = 0.3f
        p.size = Random.nextFloat() * 0.002f + 0.001f
        p.age = 0f
        p.lifetime = Random.nextFloat() * 1f + 1.5f // 1.5-2.5s
        p.alive = true
    }

    companion object {
        private const val MAX_PARTICLES = 20
        private const val GRAVITY = 0.03f // fraction/s² — gentle pull down
        private const val SAND_PROXIMITY_THRESHOLD = 0.62f
    }
}
