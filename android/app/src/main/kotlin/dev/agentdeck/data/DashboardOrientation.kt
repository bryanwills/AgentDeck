package dev.agentdeck.data

import android.content.pm.ActivityInfo

/**
 * Shared Dashboard orientation contract for Android tablet and e-ink surfaces.
 *
 * E-ink defaults to fixed landscape because several reader firmwares either
 * ignore sensor rotation or redraw too slowly during free rotation. Color
 * tablets default to Auto, but the explicit portrait/landscape choices remain
 * available so users can override a system rotation lock from inside AgentDeck.
 */
object DashboardOrientation {
    val Auto: Int = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    val Portrait: Int = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    val Landscape: Int = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE

    fun defaultFor(isEink: Boolean): Int =
        if (isEink) Landscape else Auto

    fun requestedActivityOrientation(preference: Int): Int =
        if (isAuto(preference)) Auto else preference

    fun isAuto(preference: Int): Boolean =
        preference == Auto ||
            preference == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED ||
            preference == ActivityInfo.SCREEN_ORIENTATION_USER ||
            preference == ActivityInfo.SCREEN_ORIENTATION_SENSOR ||
            preference == ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR

    fun nextManualOrientation(preference: Int, isCurrentlyLandscape: Boolean): Int =
        when (preference) {
            Landscape -> Portrait
            Portrait -> Landscape
            else -> if (isCurrentlyLandscape) Portrait else Landscape
        }
}
