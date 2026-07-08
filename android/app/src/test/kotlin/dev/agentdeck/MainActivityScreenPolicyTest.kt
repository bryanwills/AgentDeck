package dev.agentdeck

import dev.agentdeck.net.DimConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityScreenPolicyTest {

    @Test
    fun `LCD releases keep-screen-on for host full-off sleep`() {
        assertFalse(
            shouldKeepDashboardScreenOn(
                isEink = false,
                keepAwake = true,
                displaySyncEnabled = true,
                hostDisplayOn = false,
                hostDim = DimConfig(enabled = true, mode = "off", level = 10),
            )
        )
    }

    @Test
    fun `LCD releases keep-screen-on for legacy sleep event without dim config`() {
        assertFalse(
            shouldKeepDashboardScreenOn(
                isEink = false,
                keepAwake = true,
                displaySyncEnabled = true,
                hostDisplayOn = false,
                hostDim = null,
            )
        )
    }

    @Test
    fun `LCD stays on for minimum-brightness dim mode`() {
        assertTrue(
            shouldKeepDashboardScreenOn(
                isEink = false,
                keepAwake = true,
                displaySyncEnabled = true,
                hostDisplayOn = false,
                hostDim = DimConfig(enabled = true, mode = "min", level = 10),
            )
        )
    }

    @Test
    fun `e-ink stays on during host full-off sleep`() {
        assertTrue(
            shouldKeepDashboardScreenOn(
                isEink = true,
                keepAwake = true,
                displaySyncEnabled = true,
                hostDisplayOn = false,
                hostDim = DimConfig(enabled = true, mode = "off", level = 10),
            )
        )
    }
}
