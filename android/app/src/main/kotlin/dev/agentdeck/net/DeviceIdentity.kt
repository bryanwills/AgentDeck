package dev.agentdeck.net

import android.content.Context
import dev.agentdeck.AgentDeckApp
import java.security.SecureRandom

/**
 * A stable random identifier for this install, sent on every WebSocket
 * handshake so the daemon can approve THIS device rather than its address.
 *
 * The daemon decides whether to accept a peer at the HTTP upgrade, before any
 * frame — `client_register`, where this app says its name, has not been sent
 * yet — so an identity that arrives later is no use to it. An address was the
 * only thing available, and behind NAT an address is shared: approving one
 * device approved every device behind it.
 *
 * Random rather than derived from anything about the hardware. `ANDROID_ID`
 * and its relatives are either restricted, shared between apps, or stable
 * across a factory reset, and none of that is wanted here: the daemon needs to
 * tell two of the user's own devices apart, not to recognise a device the user
 * has wiped. A reinstall producing a new id is correct — it IS a new install,
 * and it should be approved again rather than inheriting a grant.
 *
 * Not a secret in transit: the link is plaintext `ws://`, so this is
 * observable on the segment exactly as the `?token=` query already is. It buys
 * granularity and revocation, not confidentiality.
 */
object DeviceIdentity {

    private const val PREFS = "agentdeck_identity"
    private const val KEY = "device_id"

    @Volatile private var cached: String? = null

    /**
     * This install's id, or null when there is no Application to read
     * preferences from. Null rather than a freshly minted value: an id that is
     * not persisted would differ on every connect and fill the operator's
     * approval list with rows that can never be approved usefully.
     */
    val current: String?
        get() = cached ?: synchronized(this) { cached ?: load()?.also { cached = it } }

    private fun load(): String? {
        val app = runCatching { AgentDeckApp.instance }.getOrNull() ?: return null
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        PairingCodeRules.normalizeDeviceId(prefs.getString(KEY, null))?.let { return it }
        val fresh = generate()
        prefs.edit().putString(KEY, fresh).apply()
        return fresh
    }

    private fun generate(): String {
        val bytes = ByteArray(PairingCodeRules.DEVICE_ID_LENGTH / 2)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
