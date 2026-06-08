package dev.agentdeck.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

data class DiscoveredBridge(
    val name: String,
    val host: String,
    val port: Int,
    val token: String? = null,
    val agentType: String? = null,
) {
    /** Build WebSocket URL with auth token if available */
    fun wsUrl(): String {
        val base = "ws://$host:$port"
        return if (token != null) "$base?token=$token" else base
    }
}

class BridgeDiscovery(context: Context) {

    companion object {
        private const val SERVICE_TYPE = "_agentdeck._tcp."
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    fun discover(): Flow<List<DiscoveredBridge>> = callbackFlow {
        val bridges = mutableMapOf<String, DiscoveredBridge>()

        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}

            override fun onDiscoveryStopped(serviceType: String) {}

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType.contains("_agentdeck")) {
                    // Each resolveService() call needs its own listener —
                    // NsdManager throws if a listener is reused while active
                    val resolveListener = object : NsdManager.ResolveListener {
                        override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                            // Resolve failed, ignore
                        }

                        override fun onServiceResolved(si: NsdServiceInfo) {
                            val resolvedHost = si.host?.hostAddress
                            // Parse TXT records for token and agentType only.
                            // ip TXT field is intentionally ignored: Bonjour caches can serve
                            // a stale IP after DHCP renewal, causing connect failures.
                            // Use NSD-resolved host directly (same policy as Swift BridgeDiscovery).
                            val token = try {
                                si.attributes["token"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }
                            val agentType = try {
                                si.attributes["agent"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }
                            val txtIp = try {
                                si.attributes["ip"]?.let { String(it, Charsets.UTF_8) }
                            } catch (_: Exception) { null }

                            val host = txtIp ?: resolvedHost ?: return
                            // Skip link-local addresses (169.254.x.x) — unreachable from WiFi
                            if (host.startsWith("169.254.")) return
                            val bridge = DiscoveredBridge(
                                name = si.serviceName,
                                host = host,
                                port = si.port,
                                token = token,
                                agentType = agentType,
                            )
                            bridges[si.serviceName] = bridge
                            trySend(bridges.values.toList())
                        }
                    }
                    nsdManager.resolveService(serviceInfo, resolveListener)
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                bridges.remove(serviceInfo.serviceName)
                trySend(bridges.values.toList())
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
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
