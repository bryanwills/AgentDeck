package dev.agentdeck.ui.monitor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Density + typography scale the Monitor HUD uses to adapt between phone
 * and tablet form-factors. Without this, the HUD panels stayed at phone
 * widths (220dp / 300dp) and 10sp fonts on a 10" tablet, leaving the
 * middle of the screen empty and rows cramped — the "줄 간격" complaint
 * in the parity review.
 *
 * Keep this the single source: every panel reads from the same
 * `MonitorLayoutScale` instance so density stays consistent across the
 * left/right rails.
 */
data class MonitorLayoutScale(
    val isTablet: Boolean,
    val sessionPanelMaxWidth: Dp,
    val topologyPanelMaxWidth: Dp,
    val panelPadding: Dp,
    val panelEdgeInset: Dp,
    val sessionRowSpacing: Dp,
    val topologyRowSpacing: Dp,
    val topologySectionSpacing: Dp,
    val providerRowSpacing: Dp,
    val fontBody: TextUnit,
    val fontSub: TextUnit,
    val fontHeader: TextUnit,
) {
    companion object {
        /** Phone density — matches the numbers the HUD shipped with before the scale layer. */
        val phone = MonitorLayoutScale(
            isTablet = false,
            sessionPanelMaxWidth = 220.dp,
            topologyPanelMaxWidth = 300.dp,
            panelPadding = 8.dp,
            panelEdgeInset = 12.dp,
            sessionRowSpacing = 4.dp,
            topologyRowSpacing = 2.dp,
            topologySectionSpacing = 5.dp,
            providerRowSpacing = 5.dp,
            fontBody = 12.sp,
            fontSub = 10.sp,
            fontHeader = 11.sp,
        )

        /** Tablet density — wider rails, taller rows, +2sp fonts. */
        val tablet = MonitorLayoutScale(
            isTablet = true,
            sessionPanelMaxWidth = 340.dp,
            topologyPanelMaxWidth = 420.dp,
            panelPadding = 14.dp,
            panelEdgeInset = 20.dp,
            sessionRowSpacing = 8.dp,
            topologyRowSpacing = 4.dp,
            topologySectionSpacing = 9.dp,
            providerRowSpacing = 8.dp,
            fontBody = 14.sp,
            fontSub = 12.sp,
            fontHeader = 12.sp,
        )
    }
}

/**
 * Picks the right scale for the current window. Uses
 * `smallestScreenWidthDp` (sw-qualifier equivalent) so foldables in
 * folded state and phones in landscape both count as "phone"; only
 * devices whose shortest side is ≥600dp (7"+ tablets) get the tablet
 * scale.
 */
@Composable
@ReadOnlyComposable
fun rememberMonitorLayoutScale(): MonitorLayoutScale {
    val config = LocalConfiguration.current
    return if (config.smallestScreenWidthDp >= 600) {
        MonitorLayoutScale.tablet
    } else {
        MonitorLayoutScale.phone
    }
}
