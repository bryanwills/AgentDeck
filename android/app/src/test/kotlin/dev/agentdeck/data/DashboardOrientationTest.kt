package dev.agentdeck.data

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardOrientationTest {

    @Test
    fun `defaults keep e-ink fixed and tablets auto-rotating`() {
        assertEquals(DashboardOrientation.Landscape, DashboardOrientation.defaultFor(isEink = true))
        assertEquals(DashboardOrientation.Auto, DashboardOrientation.defaultFor(isEink = false))
    }

    @Test
    fun `legacy unspecified preference still counts as auto`() {
        assertTrue(DashboardOrientation.isAuto(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED))
        assertEquals(
            DashboardOrientation.Auto,
            DashboardOrientation.requestedActivityOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED),
        )
    }

    @Test
    fun `manual rotate toggles fixed modes from auto using current posture`() {
        assertEquals(
            DashboardOrientation.Portrait,
            DashboardOrientation.nextManualOrientation(DashboardOrientation.Auto, isCurrentlyLandscape = true),
        )
        assertEquals(
            DashboardOrientation.Landscape,
            DashboardOrientation.nextManualOrientation(DashboardOrientation.Auto, isCurrentlyLandscape = false),
        )
        assertEquals(
            DashboardOrientation.Portrait,
            DashboardOrientation.nextManualOrientation(DashboardOrientation.Landscape, isCurrentlyLandscape = true),
        )
        assertEquals(
            DashboardOrientation.Landscape,
            DashboardOrientation.nextManualOrientation(DashboardOrientation.Portrait, isCurrentlyLandscape = false),
        )
    }
}
