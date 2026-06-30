package dev.agentdeck.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BridgeDiscoveryTest {

    @Test
    fun `ws url uses primary host and preserves pairing token`() {
        val bridge = DiscoveredBridge(
            name = "daemon-9120",
            host = "192.168.1.20",
            port = 9120,
            token = "abcdef0123456789",
            agentType = "daemon",
            fallbackHost = "192.168.1.21",
        )

        assertEquals("ws://192.168.1.20:9120?token=abcdef0123456789", bridge.wsUrl())
        assertEquals("ws://192.168.1.21:9120?token=abcdef0123456789", bridge.fallbackWsUrl())
    }

    @Test
    fun `fallback url is absent without a fallback host`() {
        val bridge = DiscoveredBridge(
            name = "daemon-9120",
            host = "192.168.1.20",
            port = 9120,
            token = "abcdef0123456789",
            agentType = "daemon",
        )

        assertEquals("ws://192.168.1.20:9120?token=abcdef0123456789", bridge.wsUrl())
        assertNull(bridge.fallbackWsUrl())
    }
}
