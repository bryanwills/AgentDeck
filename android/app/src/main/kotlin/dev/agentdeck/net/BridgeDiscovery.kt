package dev.agentdeck.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.shareIn

private const val TAG = "BridgeDiscovery"
private const val VERBOSE_DISCOVERY_LOGS = false

private inline fun discoveryDebug(message: () -> String) {
    if (VERBOSE_DISCOVERY_LOGS || Log.isLoggable(TAG, Log.DEBUG)) {
        Log.d(TAG, message())
    }
}

private fun isUsableBridgeHost(host: String?): Boolean {
    if (host.isNullOrBlank()) return false
    if (host.startsWith("169.254.")) return false
    // The daemon advertises/listens on IPv4 today, and raw IPv6 strings need
    // bracketed URL handling. Keep discovery URLs IPv4-only until IPv6 is owned.
    if (host.contains(":")) return false
    return true
}

data class DiscoveredBridge(
    val name: String,
    val host: String,
    val port: Int,
    val token: String? = null,
    val agentType: String? = null,
    /**
     * Secondary address from the NSD-resolved hostname, kept only when it differs
     * from the primary [host] (which prefers the TXT `ip`). On a dual-homed daemon
     * the advertised TXT ip can sit on an interface whose return path is broken; the
     * connection layer retries this resolved address before giving up and re-discovering.
     */
    val fallbackHost: String? = null,
) {
    /** Build WebSocket URL with auth token if available */
    fun wsUrl(): String = wsUrlFor(host)

    /**
     * WS URL for the secondary [fallbackHost], or null when there is no distinct
     * fallback. Pass alongside [wsUrl] to `BridgeConnection.connect` so a failing
     * primary (TXT-ip) endpoint can fail over to the NSD-resolved one.
     */
    fun fallbackWsUrl(): String? = fallbackHost?.let { wsUrlFor(it) }

    private fun wsUrlFor(h: String): String {
        val base = "ws://$h:$port"
        return if (token != null) "$base?token=$token" else base
    }
}

class BridgeDiscovery(context: Context) {

    private val appContext = context.applicationContext

    /**
     * mDNS discovery of `_agentdeck._tcp` daemons.
     *
     * Returns a single process-wide shared flow rather than a fresh NSD discovery
     * per call. This is deliberate: the screens collect discovery from several
     * `LaunchedEffect`s at once (persistent UI list, initial auto-connect, recovery
     * loop) and re-key those effects on the fast-flipping connection status/URL.
     * A per-call cold flow meant each re-key cancelled `discoverServices()` —
     * tearing down the async `resolveService()` before `onServiceResolved` could
     * fire — and concurrent collectors each issued their own resolve, colliding on
     * Android NSD's single-in-flight-resolve limit. The net effect was a livelock:
     * the daemon was discovered but never resolved to a connectable host, so the
     * app fell back to the (often dead) localhost/USB URL forever.
     *
     * Sharing the flow means exactly one underlying discovery+resolve runs no
     * matter how many collectors attach, and `WhileSubscribed(stopTimeoutMillis)`
     * keeps it alive across the sub-second gaps when an effect re-keys, so resolves
     * actually complete. `replay = 1` lets a re-subscriber (e.g. the recovery loop)
     * see the last discovered daemon immediately.
     */
    fun discover(): Flow<List<DiscoveredBridge>> = shared(appContext)

    companion object {
        private const val SERVICE_TYPE = "_agentdeck._tcp."

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        @Volatile
        private var sharedFlow: SharedFlow<List<DiscoveredBridge>>? = null

        private fun shared(context: Context): SharedFlow<List<DiscoveredBridge>> {
            sharedFlow?.let { return it }
            return synchronized(this) {
                sharedFlow ?: rawDiscover(context).shareIn(
                    scope,
                    // Keep NSD discovery alive for 5s after the last collector leaves
                    // so brief LaunchedEffect re-keys don't abort in-flight resolves.
                    SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000),
                    replay = 1,
                ).also { sharedFlow = it }
            }
        }

        private fun rawDiscover(context: Context): Flow<List<DiscoveredBridge>> = callbackFlow {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            val bridges = mutableMapOf<String, DiscoveredBridge>()

            // Android NsdManager allows only one in-flight resolveService() per
            // process on many platform versions; a second concurrent call fails
            // immediately with errorCode=3 (FAILURE_ALREADY_ACTIVE). Stale
            // _agentdeck._tcp records from past session bridges (e.g. 9121+)
            // can race the live daemon's advertisement and silently lose this
            // race, leaving the live daemon unresolved. We (a) pre-filter by
            // TXT port so stale services never even reach resolve, (b) prefer
            // a TXT-only fast path that skips resolve entirely when TXT already
            // carries ip+port, and (c) serialize the remaining resolves with a
            // 250ms retry on errorCode=3.
            val resolveLock = Any()
            val resolveQueue = ArrayDeque<NsdServiceInfo>()
            val queuedNames = mutableSetOf<String>()
            var resolveInFlight = false

            fun tryEmit() {
                trySend(bridges.values.toList())
            }

            fun startNextResolve() {
                synchronized(resolveLock) {
                    if (resolveInFlight) return
                    val next = resolveQueue.removeFirstOrNull() ?: return
                    resolveInFlight = true

                    val listener = object : NsdManager.ResolveListener {
                        override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                            synchronized(resolveLock) { resolveInFlight = false }
                            if (errorCode == 3 /* FAILURE_ALREADY_ACTIVE */) {
                                // Another resolve (possibly leaked getaddrinfo on Lenovo
                                // Android 11) still holds the slot. Re-queue at head and
                                // retry after a short backoff so the live daemon eventually
                                // resolves instead of being silently dropped.
                                Log.w(TAG, "Resolve busy (errorCode=3) for ${si.serviceName} — retrying in 250ms")
                                scope.launch {
                                    delay(250)
                                    synchronized(resolveLock) {
                                        if (queuedNames.add(si.serviceName)) {
                                            resolveQueue.addFirst(si)
                                        }
                                        startNextResolve()
                                    }
                                }
                            } else {
                                Log.w(TAG, "Resolve failed for ${si.serviceName}: errorCode=$errorCode")
                                queuedNames.remove(si.serviceName)
                                startNextResolve()
                            }
                        }

                        override fun onServiceResolved(si: NsdServiceInfo) {
                            synchronized(resolveLock) {
                                resolveInFlight = false
                                queuedNames.remove(si.serviceName)
                            }
                            val resolvedHost = si.host?.hostAddress
                            val token = try {
                                si.attributes["token"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }
                            val agentType = try {
                                si.attributes["agent"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }
                            val txtIp = try {
                                si.attributes["ip"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }

                            val host = txtIp
                                ?.takeIf(::isUsableBridgeHost)
                                ?: resolvedHost?.takeIf(::isUsableBridgeHost)
                                ?: run { startNextResolve(); return }
                            val fallbackHost = resolvedHost
                                ?.takeIf { it != host && isUsableBridgeHost(it) }
                            val bridge = DiscoveredBridge(
                                name = si.serviceName,
                                host = host,
                                port = si.port,
                                token = token,
                                agentType = agentType,
                                fallbackHost = fallbackHost,
                            )
                            discoveryDebug { "Resolved ${si.serviceName} -> ${bridge.host}:${bridge.port} (agent=$agentType)" }
                            bridges[si.serviceName] = bridge
                            tryEmit()
                            startNextResolve()
                        }
                    }
                    try {
                        nsdManager.resolveService(next, listener)
                    } catch (e: Exception) {
                        // NsdManager throws when the same listener is reused or
                        // discovery is gone. Re-queue and try the next.
                        resolveInFlight = false
                        queuedNames.remove(next.serviceName)
                        Log.w(TAG, "resolveService threw for ${next.serviceName}: ${e.message}")
                        startNextResolve()
                    }
                }
            }

            fun enqueueResolve(info: NsdServiceInfo) {
                synchronized(resolveLock) {
                    if (!queuedNames.add(info.serviceName)) return
                    resolveQueue.addLast(info)
                    startNextResolve()
                }
            }

            val discoveryListener = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {}

                override fun onDiscoveryStopped(serviceType: String) {}

                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    if (!serviceInfo.serviceType.contains("_agentdeck")) return

                    // Pre-filter stale session-bridge advertisements. Only the
                    // daemon hub advertises on BridgeConstants.WS_PORT; past
                    // session bridges (or older daemons) advertised on 9121+
                    // and their mDNS records can linger in NSD cache beyond TTL.
                    val txtPort = try {
                        serviceInfo.attributes["port"]
                            ?.let { String(it, Charsets.UTF_8).toIntOrNull() }
                    } catch (_: Exception) { null }
                    if (txtPort != null && txtPort != BridgeConstants.WS_PORT) {
                        discoveryDebug {
                            "Skip ${serviceInfo.serviceName} (TXT port=$txtPort ≠ ${BridgeConstants.WS_PORT})"
                        }
                        return
                    }

                    val txtIp = try {
                        serviceInfo.attributes["ip"]?.let { String(it, Charsets.UTF_8) }
                    } catch (_: Exception) { null }
                    val token = try {
                        serviceInfo.attributes["token"]?.let { String(it, Charsets.UTF_8) }
                    } catch (_: Exception) { null }
                    val agentType = try {
                        serviceInfo.attributes["agent"]?.let { String(it, Charsets.UTF_8) }
                    } catch (_: Exception) { null }

                    // Fast path: TXT provides ip (+port). Emit immediately and
                    // skip resolveService() entirely — this avoids the platform's
                    // 1-in-flight-resolve limit that otherwise makes the live
                    // daemon lose to a stale service in a discovery race.
                    if (txtIp != null && isUsableBridgeHost(txtIp)) {
                        val port = txtPort ?: BridgeConstants.WS_PORT
                        val bridge = DiscoveredBridge(
                            name = serviceInfo.serviceName,
                            host = txtIp,
                            port = port,
                            token = token,
                            agentType = agentType,
                            fallbackHost = null,
                        )
                        discoveryDebug { "TXT-resolved ${serviceInfo.serviceName} -> $txtIp:$port (agent=$agentType)" }
                        bridges[serviceInfo.serviceName] = bridge
                        tryEmit()
                        return
                    }

                    // Slow path: TXT missing ip. Fall back to resolveService,
                    // serialized through the queue above so concurrent finds
                    // don't trip FAILURE_ALREADY_ACTIVE.
                    enqueueResolve(serviceInfo)
                }

                override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                    bridges.remove(serviceInfo.serviceName)
                    synchronized(resolveLock) {
                        queuedNames.remove(serviceInfo.serviceName)
                    }
                    tryEmit()
                }

                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.w(TAG, "Start discovery failed: errorCode=$errorCode")
                    close()
                }

                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            }

            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)

            awaitClose {
                try {
                    nsdManager.stopServiceDiscovery(discoveryListener)
                } catch (_: Exception) {
                    // Already stopped
                }
            }
        }
    }
}
