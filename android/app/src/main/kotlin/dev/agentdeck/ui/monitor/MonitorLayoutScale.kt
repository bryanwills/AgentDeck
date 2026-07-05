package dev.agentdeck.ui.monitor

import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Timeline layout dispatch:
 *   - Compact: phone-class device in portrait. Single-column with
 *     tap-to-expand inline detail. No right-side detail pane (the 35% pane
 *     would be ~120dp on a 340dp phone screen — too narrow to be useful).
 *   - Regular: tablet (any orientation), phone landscape, or anything else.
 *     The 65/35 HStack with right-side detail pane stays.
 *
 * Mirrors `TimelineLayoutMode` in
 * apple/AgentDeck/UI/Monitor/TimelineStripView.swift.
 */
enum class TimelineLayoutMode { Compact, Regular }

@Composable
@ReadOnlyComposable
fun rememberTimelineLayoutMode(): TimelineLayoutMode {
    val config = LocalConfiguration.current
    val isPhone = config.smallestScreenWidthDp < 600
    val isPortrait = config.orientation == Configuration.ORIENTATION_PORTRAIT
    return if (isPhone && isPortrait) TimelineLayoutMode.Compact else TimelineLayoutMode.Regular
}

/**
 * Density + typography scale the Monitor HUD uses to adapt between phone
 * and tablet form-factors. Tablet values intentionally stay close to the
 * macOS HUD density: this is an operational dashboard, not a card-heavy
 * tablet landing page.
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
        /** Phone density — fonts shrunk by one step from the tablet baseline
         *  because phone HUD areas (~340 dp wide) are too cramped at the
         *  tablet defaults. Sub goes 10→9 sp, body 12→11 sp, header 11→10 sp. */
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
            fontBody = 11.sp,
            fontSub = 9.sp,
            fontHeader = 10.sp,
        )

        /** Tablet density — macOS HUD proportions, not enlarged tablet cards.
         *  Session panel runs wider than the macOS 220dp cap: long worktree
         *  project names dominate the list on tablets and 220dp wrapped nearly
         *  every row (user request 2026-07-06). */
        val tablet = MonitorLayoutScale(
            isTablet = true,
            sessionPanelMaxWidth = 300.dp,
            topologyPanelMaxWidth = 300.dp,
            panelPadding = 8.dp,
            panelEdgeInset = 12.dp,
            sessionRowSpacing = 4.dp,
            topologyRowSpacing = 0.dp,
            topologySectionSpacing = 6.dp,
            providerRowSpacing = 5.dp,
            fontBody = 12.sp,
            fontSub = 10.sp,
            fontHeader = 11.sp,
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
