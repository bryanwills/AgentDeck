// To parse the JSON, install Klaxon and do:
//
//   val gatewayFrame = GatewayFrame.fromJson(jsonString)

package dev.agentdeck.generated

import com.beust.klaxon.*

private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) =
    this.converter(object: Converter {
        @Suppress("UNCHECKED_CAST")
        override fun toJson(value: Any)        = toJson(value as T)
        override fun fromJson(jv: JsonValue)   = fromJson(jv) as Any
        override fun canConvert(cls: Class<*>) = cls == k.java || (isUnion && cls.superclass == k.java)
    })

private val klaxon = Klaxon()
    .convert(GatewayEventName::class,            { GatewayEventName.fromValue(it.string!!) },            { "\"${it.value}\"" })
    .convert(GatewayMethodName::class,           { GatewayMethodName.fromValue(it.string!!) },           { "\"${it.value}\"" })
    .convert(ClientMode::class,                  { ClientMode.fromValue(it.string!!) },                  { "\"${it.value}\"" })
    .convert(GatewayMethodParamsDecision::class, { GatewayMethodParamsDecision.fromValue(it.string!!) }, { "\"${it.value}\"" })
    .convert(PayloadDecision::class,             { PayloadDecision.fromValue(it.string!!) },             { "\"${it.value}\"" })
    .convert(State::class,                       { State.fromValue(it.string!!) },                       { "\"${it.value}\"" })
    .convert(Status::class,                      { Status.fromValue(it.string!!) },                      { "\"${it.value}\"" })
    .convert(Type::class,                        { Type.fromValue(it.string!!) },                        { "\"${it.value}\"" })

/**
 * Client → Gateway: RPC request.
 *
 * Gateway → Client: RPC response (ok=true) or error (ok=false).
 *
 * Gateway → Client: unsolicited event.
 */
data class GatewayFrame (
    val id: String? = null,
    val method: GatewayMethodName? = null,
    val params: GatewayMethodParams? = null,
    val type: Type,
    val error: GatewayError? = null,
    val ok: Boolean? = null,
    val payload: Gateway? = null,
    val event: GatewayEventName? = null,

    /**
     * Monotonic sequence number (optional, used for ordering on reconnect).
     */
    val seq: String? = null,

    /**
     * Server-side state version for dedup on replay.
     */
    val stateVersion: String? = null
) {
    public fun toJson() = klaxon.toJsonString(this)

    companion object {
        public fun fromJson(json: String) = klaxon.parse<GatewayFrame>(json)
    }
}

data class GatewayError (
    val code: String,
    val details: Any? = null,
    val message: String
)

enum class GatewayEventName(val value: String) {
    Chat("chat"),
    ConnectChallenge("connect.challenge"),
    ExecApprovalRequested("exec.approval.requested"),
    ExecApprovalResolved("exec.approval.resolved"),
    Presence("presence"),
    Shutdown("shutdown"),
    Tick("tick");

    companion object {
        public fun fromValue(value: String): GatewayEventName = when (value) {
            "chat"                    -> Chat
            "connect.challenge"       -> ConnectChallenge
            "exec.approval.requested" -> ExecApprovalRequested
            "exec.approval.resolved"  -> ExecApprovalResolved
            "presence"                -> Presence
            "shutdown"                -> Shutdown
            "tick"                    -> Tick
            else                      -> throw IllegalArgumentException()
        }
    }
}

enum class GatewayMethodName(val value: String) {
    ChatAbort("chat.abort"),
    ChatSend("chat.send"),
    Connect("connect"),
    ExecApprovalResolve("exec.approval.resolve"),
    SessionsList("sessions.list");

    companion object {
        public fun fromValue(value: String): GatewayMethodName = when (value) {
            "chat.abort"            -> ChatAbort
            "chat.send"             -> ChatSend
            "connect"               -> Connect
            "exec.approval.resolve" -> ExecApprovalResolve
            "sessions.list"         -> SessionsList
            else                    -> throw IllegalArgumentException()
        }
    }
}

data class GatewayMethodParams (
    val auth: DeviceAuth? = null,
    val clientInfo: ClientInfo? = null,
    val requestScopes: List<String>? = null,
    val idempotencyKey: String? = null,
    val message: String? = null,
    val sessionKey: String? = null,

    @Json(name = "runId")
    val runID: String? = null,

    val decision: GatewayMethodParamsDecision? = null,
    val id: String? = null,
    val kind: String? = null
)

data class DeviceAuth (
    val id: String,
    val nonce: String,
    val publicKey: String,
    val signature: String,
    val signedAt: Double
)

data class ClientInfo (
    @Json(name = "clientId")
    val clientID: String,

    val clientMode: ClientMode,
    val version: String? = null
)

enum class ClientMode(val value: String) {
    Backend("backend"),
    Frontend("frontend");

    companion object {
        public fun fromValue(value: String): ClientMode = when (value) {
            "backend"  -> Backend
            "frontend" -> Frontend
            else       -> throw IllegalArgumentException()
        }
    }
}

enum class GatewayMethodParamsDecision(val value: String) {
    Allow("allow"),
    Deny("deny");

    companion object {
        public fun fromValue(value: String): GatewayMethodParamsDecision = when (value) {
            "allow" -> Allow
            "deny"  -> Deny
            else    -> throw IllegalArgumentException()
        }
    }
}

data class Gateway (
    val accepted: Boolean? = null,
    val expiresAt: Double? = null,
    val sessionToken: String? = null,

    @Json(name = "runId")
    val runID: String? = null,

    val aborted: Boolean? = null,
    val resolved: Boolean? = null,
    val sessions: List<GatewaySession>? = null,
    val nonce: String? = null,

    /**
     * Incremental text chunk (delta state).
     */
    val delta: String? = null,

    /**
     * Error message (error state).
     */
    val error: String? = null,

    /**
     * Token accounting (final state).
     */
    val inputTokens: Double? = null,

    /**
     * Model identifier used for this turn.
     */
    @Json(name = "modelId")
    val modelID: String? = null,

    /**
     * Session identifier when Gateway creates a new session mid-chat.
     */
    @Json(name = "newSessionId")
    val newSessionID: String? = null,

    val outputTokens: Double? = null,

    /**
     * User prompt text, as echoed by Gateway on first delta.
     */
    val prompt: String? = null,

    /**
     * Full assembled response (final state).
     */
    val response: String? = null,

    val sessionKey: String? = null,
    val state: State? = null,

    /**
     * Tool invocations observed in this turn.
     */
    val tools: List<ChatToolInvocation>? = null,

    val command: String? = null,
    val id: String? = null,

    /**
     * Options surfaced to the user (default: allow/deny).
     */
    val options: List<Option>? = null,

    val reason: String? = null,
    val tool: String? = null,
    val decision: PayloadDecision? = null,

    @Json(name = "clientId")
    val clientID: String? = null,

    val connected: Boolean? = null,

    @Json(name = "deviceId")
    val deviceID: String? = null,

    val serverTime: Double? = null,
    val restartAt: Double? = null
)

enum class PayloadDecision(val value: String) {
    Allow("allow"),
    Deny("deny"),
    Timeout("timeout");

    companion object {
        public fun fromValue(value: String): PayloadDecision = when (value) {
            "allow"   -> Allow
            "deny"    -> Deny
            "timeout" -> Timeout
            else      -> throw IllegalArgumentException()
        }
    }
}

data class Option (
    val key: String,
    val label: String
)

data class GatewaySession (
    val displayName: String? = null,
    val key: String,
    val kind: String? = null,
    val label: String? = null,

    @Json(name = "sessionId")
    val sessionID: String? = null,

    val updatedAt: Double? = null
)

enum class State(val value: String) {
    Aborted("aborted"),
    Delta("delta"),
    Error("error"),
    Final("final");

    companion object {
        public fun fromValue(value: String): State = when (value) {
            "aborted" -> Aborted
            "delta"   -> Delta
            "error"   -> Error
            "final"   -> Final
            else      -> throw IllegalArgumentException()
        }
    }
}

data class ChatToolInvocation (
    val input: Any? = null,
    val name: String,
    val output: Any? = null,
    val status: Status? = null
)

enum class Status(val value: String) {
    Error("error"),
    Pending("pending"),
    Success("success");

    companion object {
        public fun fromValue(value: String): Status = when (value) {
            "error"   -> Error
            "pending" -> Pending
            "success" -> Success
            else      -> throw IllegalArgumentException()
        }
    }
}

enum class Type(val value: String) {
    Event("event"),
    Req("req"),
    Res("res");

    companion object {
        public fun fromValue(value: String): Type = when (value) {
            "event" -> Event
            "req"   -> Req
            "res"   -> Res
            else    -> throw IllegalArgumentException()
        }
    }
}
