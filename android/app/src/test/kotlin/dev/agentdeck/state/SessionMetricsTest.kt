package dev.agentdeck.state

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class SessionMetricsTest {

    private lateinit var metrics: SessionMetrics

    @Before
    fun setUp() {
        metrics = SessionMetrics.instance
        metrics.reset()
    }

    @Test
    fun `initial state has no connection`() {
        val snap = metrics.metrics.value
        assertNull(snap.connectedSince)
        assertNull(snap.lastMessageAt)
        assertEquals(0, snap.messageCount)
        assertEquals(0, snap.reconnectCount)
    }

    @Test
    fun `onConnected sets connectedSince`() {
        metrics.onConnected()
        assertNotNull(metrics.metrics.value.connectedSince)
        assertNotNull(metrics.metrics.value.lastMessageAt)
    }

    @Test
    fun `onDisconnected clears connectedSince`() {
        metrics.onConnected()
        metrics.onDisconnected()
        assertNull(metrics.metrics.value.connectedSince)
    }

    @Test
    fun `reconnect increments reconnectCount when still connected`() {
        // reconnectCount increments only when onConnected() is called while already connected
        metrics.onConnected()
        metrics.onConnected()  // second connect without disconnect = reconnect
        assertEquals(1, metrics.metrics.value.reconnectCount)
    }

    @Test
    fun `clean reconnect after disconnect does not increment`() {
        metrics.onConnected()
        metrics.onDisconnected()
        metrics.onConnected()  // fresh connect after clean disconnect
        assertEquals(0, metrics.metrics.value.reconnectCount)
    }

    @Test
    fun `onMessageReceived increments count`() {
        metrics.onMessageReceived()
        metrics.onMessageReceived()
        metrics.onMessageReceived()
        assertEquals(3, metrics.metrics.value.messageCount)
    }

    @Test
    fun `onMessageReceived updates lastMessageAt`() {
        metrics.onMessageReceived()
        assertNotNull(metrics.metrics.value.lastMessageAt)
    }

    @Test
    fun `reset clears all metrics`() {
        metrics.onConnected()
        metrics.onMessageReceived()
        metrics.reset()
        val snap = metrics.metrics.value
        assertNull(snap.connectedSince)
        assertEquals(0, snap.messageCount)
        assertEquals(0, snap.reconnectCount)
    }
}
