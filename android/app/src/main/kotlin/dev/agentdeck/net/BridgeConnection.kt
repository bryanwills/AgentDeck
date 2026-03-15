package dev.agentdeck.net

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min

private const val TAG = "BridgeConnection"

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
}

class BridgeConnection private constructor() {

    companion object {
        val instance: BridgeConnection by lazy { BridgeConnection() }
        private const val INITIAL_BACKOFF_MS = 1000L
        private const val MAX_BACKOFF_MS = 8_000L
        /** Stop reconnecting to localhost after this many failures (allow mDNS fallback). */
        private const val MAX_LOCALHOST_ATTEMPTS = 5
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .readTimeout(45, TimeUnit.SECONDS) // Detect half-open connections (server pings every 15s)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var backoffMs = INITIAL_BACKOFF_MS
    private var shouldReconnect = false

    private val _status = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    private val _url = MutableStateFlow<String?>(null)
    val url: StateFlow<String?> = _url.asStateFlow()

    /** Last connection error message (cleared on next connect attempt). */
    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    /** True when actively trying to reconnect to a known URL. */
    private val _isReconnecting = MutableStateFlow(false)
    val isReconnecting: StateFlow<Boolean> = _isReconnecting.asStateFlow()

    /** Current reconnect attempt number (reset on connect/disconnect). */
    private val _reconnectAttempt = MutableStateFlow(0)
    val reconnectAttempt: StateFlow<Int> = _reconnectAttempt.asStateFlow()

    var onEvent: ((BridgeEvent) -> Unit)? = null

    fun connect(wsUrl: String) {
        Log.i(TAG, "connect($wsUrl) — current status=${_status.value}")
        // Cancel any existing connection/reconnect loop before starting fresh
        shouldReconnect = false
        webSocket?.close(1000, "New connection")
        webSocket = null

        _url.value = wsUrl
        _status.value = ConnectionStatus.DISCONNECTED
        _lastError.value = null
        _reconnectAttempt.value = 0
        _isReconnecting.value = false
        shouldReconnect = true
        backoffMs = INITIAL_BACKOFF_MS
        doConnect(wsUrl)
    }

    fun disconnect() {
        shouldReconnect = false
        _isReconnecting.value = false
        _reconnectAttempt.value = 0
        _url.value = null
        _lastError.value = null
        webSocket?.close(1000, "User disconnect")
        webSocket = null
        _status.value = ConnectionStatus.DISCONNECTED
        onEvent?.invoke(BridgeEvent.Disconnected)
    }

    fun send(message: String) {
        webSocket?.send(message)
    }

    fun sendRespond(value: String) = send(PluginCommands.respond(value))
    fun sendSelectOption(index: Int) = send(PluginCommands.selectOption(index))
    fun sendPrompt(text: String) = send(PluginCommands.sendPrompt(text))
    fun sendInterrupt() = send(PluginCommands.interrupt())
    fun sendEscape() = send(PluginCommands.escape())
    fun sendQueryUsage() = send(PluginCommands.queryUsage())
    fun sendSwitchMode() = send(PluginCommands.switchMode())
    /** Connect to a saved URL if not already connected. */
    fun autoConnect(savedUrl: String?) {
        if (savedUrl != null && _status.value == ConnectionStatus.DISCONNECTED) {
            connect(savedUrl)
        }
    }

    private fun doConnect(wsUrl: String) {
        if (_status.value == ConnectionStatus.CONNECTING) {
            Log.d(TAG, "doConnect($wsUrl) — skipped, already CONNECTING")
            return
        }
        Log.i(TAG, "doConnect($wsUrl) — opening WebSocket")
        _status.value = ConnectionStatus.CONNECTING

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "onOpen — connected to $wsUrl")
                _status.value = ConnectionStatus.CONNECTED
                _isReconnecting.value = false
                _reconnectAttempt.value = 0
                backoffMs = INITIAL_BACKOFF_MS
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val event = parseBridgeMessage(text)
                if (event != null) {
                    if (event is BridgeEvent.State) {
                        Log.d("Terrarium", "WS raw state_update: agentType=${event.data.agentType}, state=${event.data.state}, gwAvail=${event.data.gatewayAvailable}, gwErr=${event.data.gatewayHasError}")
                    }
                    onEvent?.invoke(event)
                } else {
                    Log.w(TAG, "Unparsed WS message: ${text.take(200)}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "onClosing — code=$code reason=$reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "onClosed — code=$code reason=$reason")
                _status.value = ConnectionStatus.DISCONNECTED
                onEvent?.invoke(BridgeEvent.Disconnected)
                // Don't reconnect on auth rejection — token required
                if (code == 4001) {
                    Log.w(TAG, "Auth rejected (4001) — stopping reconnect")
                    shouldReconnect = false
                    _url.value = null
                    _lastError.value = "Unauthorized — check pairing token"
                } else {
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "onFailure — ${t.message}", t)
                _status.value = ConnectionStatus.DISCONNECTED
                _lastError.value = t.message
                onEvent?.invoke(BridgeEvent.Disconnected)
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val currentUrl = _url.value ?: return

        _isReconnecting.value = true
        _reconnectAttempt.value++

        // Give up reconnecting to localhost after MAX_LOCALHOST_ATTEMPTS —
        // adb reverse tunnel is likely broken, let user choose WiFi/mDNS instead
        val isLocalhost = currentUrl.contains("127.0.0.1") || currentUrl.contains("localhost")
        if (isLocalhost && _reconnectAttempt.value > MAX_LOCALHOST_ATTEMPTS) {
            Log.w(TAG, "Giving up localhost reconnect after ${_reconnectAttempt.value} attempts — adb reverse likely broken")
            shouldReconnect = false
            _isReconnecting.value = false
            _url.value = null  // Clear URL so mDNS discovery activates
            _lastError.value = "USB connection lost"
            return
        }

        Log.d(TAG, "scheduleReconnect — attempt=${_reconnectAttempt.value} backoff=${backoffMs}ms url=$currentUrl")
        scope.launch {
            delay(backoffMs)
            backoffMs = min(backoffMs * 2, MAX_BACKOFF_MS)
            if (shouldReconnect && _status.value == ConnectionStatus.DISCONNECTED) {
                doConnect(currentUrl)
            }
        }
    }
}
