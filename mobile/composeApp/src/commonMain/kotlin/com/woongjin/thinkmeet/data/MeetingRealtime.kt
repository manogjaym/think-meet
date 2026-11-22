package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.platform.clientPlatformId
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.client.request.url
import io.ktor.http.HttpHeaders
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.encodedPath
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.math.min

/**
 * Engine.IO v4 over native WebSockets. A single connection carries class snapshots,
 * acknowledged commands and transient previews; it reconnects without replaying mutations.
 */
class MeetingRealtime internal constructor(
    private val api: ThinkMeetApi,
    private val scope: CoroutineScope,
    private val lessonId: String?,
) {
    private val state = MutableStateFlow<MeetingSnapshot?>(null)
    val snapshot: StateFlow<MeetingSnapshot?> = state.asStateFlow()
    private val connection = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = connection.asStateFlow()
    private val subscription = MutableStateFlow(false)
    val subscribed = subscription.asStateFlow()
    private val errorMessages = MutableSharedFlow<String>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val errors: SharedFlow<String> = errorMessages.asSharedFlow()
    private val roomErrorEvents = MutableSharedFlow<RealtimeError>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val roomErrors: SharedFlow<RealtimeError> = roomErrorEvents.asSharedFlow()
    private val previewEvents = MutableSharedFlow<StrokePreview>(extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val previews: SharedFlow<StrokePreview> = previewEvents.asSharedFlow()
    private val assistanceEvents = MutableSharedFlow<AssistancePointer>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val assistancePointers: SharedFlow<AssistancePointer> = assistanceEvents.asSharedFlow()
    private val lessonEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val lessonsChanged: SharedFlow<Unit> = lessonEvents.asSharedFlow()
    private val transportLock = Mutex()
    private val ackLock = Mutex()
    private val pending = mutableMapOf<Long, CompletableDeferred<JsonElement>>()
    private var nextAck = 0L
    private var transport: DefaultClientWebSocketSession? = null
    private var job: Job? = null
    private var closed = false

    fun start() {
        if (closed || job?.isActive == true) return
        job = scope.launch {
            var attempt = 0
            while (isActive) {
                try {
                    connect { attempt = 0 }
                } catch (_: TimeoutCancellationException) {
                    if (attempt == 0) errorMessages.tryEmit("실시간 연결을 복구하고 있어요.")
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    if (attempt == 0) errorMessages.tryEmit("실시간 연결을 복구하고 있어요.")
                } finally {
                    subscription.value = false
                    connection.value = false
                    withContext(NonCancellable) {
                        transportLock.withLock {
                            val session = transport
                            transport = null
                            if (session != null) {
                                try { withTimeoutOrNull(2_000) { session.close(CloseReason(CloseReason.Codes.NORMAL, "Client disconnected")) } }
                                finally { session.cancel() }
                            }
                        }
                        failPending()
                    }
                }
                delay(min(15_000L, 1_000L shl min(attempt++, 4)))
            }
        }
    }

    fun close() {
        closed = true
        job?.cancel()
        job = null
        subscription.value = false
        connection.value = false
    }

    /** Polling and reconnect acknowledgements share the same sequence guard. */
    fun accept(value: MeetingSnapshot) {
        state.update { current -> newerSnapshot(current, value, lessonId) }
    }

    private suspend fun connect(onReady: () -> Unit) = coroutineScope {
        val cookie = api.cookieHeader()
        val socketUrl = URLBuilder(api.origin).apply {
            protocol = if (protocol == URLProtocol.HTTPS) URLProtocol.WSS else URLProtocol.WS
            encodedPath = ContractProtocol.SocketPath.trimEnd('/') + "/"
            parameters.append("EIO", "4")
            parameters.append("transport", "websocket")
        }.buildString()
        val session = api.client.webSocketSession {
            url(socketUrl)
            header(HttpHeaders.Origin, api.origin)
            header(ContractProtocol.PlatformHeader, clientPlatformId())
            header(ContractProtocol.RevisionHeader, ContractProtocol.Revision.toString())
            if (cookie.isNotBlank()) header(HttpHeaders.Cookie, cookie)
        }
        transportLock.withLock { transport = session }
        var heartbeatTimeout = 65_000L
        while (isActive) {
            val frame = withTimeout(heartbeatTimeout) { session.incoming.receive() }
            if (frame !is Frame.Text) continue
            for (raw in frame.readText().split('\u001e')) {
                val packet = try { SocketIoCodec.decode(raw) } catch (_: Exception) { continue }
                when (packet) {
                    is SocketIoCodec.Packet.Open -> {
                        val data = packet.data.jsonObject
                        heartbeatTimeout = (data["pingInterval"]?.jsonPrimitive?.longOrNull ?: 25_000L) +
                            (data["pingTimeout"]?.jsonPrimitive?.longOrNull ?: 20_000L) + 5_000L
                        sendPacket("40")
                    }
                    SocketIoCodec.Packet.Connected -> {
                        connection.value = true
                        onReady()
                        if (lessonId != null) launch {
                            try {
                                val ack = request(ContractProtocol.Events.Subscribe, ThinkMeetJson.encodeToJsonElement(SubscribeInput(lessonId)))
                                accept(readAck(ack))
                                subscription.value = true
                            } catch (error: CancellationException) { throw error }
                            catch (error: Exception) { report(error) }
                        }
                    }
                    is SocketIoCodec.Packet.Ping -> sendPacket("3${packet.data}")
                    is SocketIoCodec.Packet.Ack -> ackLock.withLock { pending.remove(packet.id) }?.complete(packet.arguments.firstOrNull() ?: JsonObject(emptyMap()))
                    is SocketIoCodec.Packet.Event -> handleEvent(packet.name, packet.payload)
                    SocketIoCodec.Packet.Closed -> throw ApiException(0, "DISCONNECTED", "수업 연결이 끊어졌어요.")
                    SocketIoCodec.Packet.Ignore -> Unit
                }
            }
        }
    }

    private fun handleEvent(name: String, payload: JsonElement?) {
        try {
            when (name) {
                ContractProtocol.Events.Snapshot -> if (payload != null) accept(ThinkMeetJson.decodeFromString(payload.toString()))
                ContractProtocol.Events.StrokePreview -> if (payload != null) previewEvents.tryEmit(ThinkMeetJson.decodeFromString(payload.toString()))
                ContractProtocol.Events.AssistancePointer -> if (payload != null && api.supportsFeature(ContractProtocol.FeatureIds.MeetingRemoteAssistance)) assistanceEvents.tryEmit(ThinkMeetJson.decodeFromString(payload.toString()))
                ContractProtocol.Events.LessonsChanged -> lessonEvents.tryEmit(Unit)
                ContractProtocol.Events.SessionReplaced -> if (payload?.jsonObject?.get("lessonId")?.jsonPrimitive?.content == lessonId) {
                    roomErrorEvents.tryEmit(RealtimeError("SESSION_REPLACED", "다른 기기에서 같은 수업에 입장했어요."))
                }
                ContractProtocol.Events.RoomError -> if (payload != null) {
                    val error = ThinkMeetJson.decodeFromString<RealtimeError>(payload.toString())
                    if (error.code == "UNAUTHENTICATED") api.reportAuthExpired(error.message)
                    roomErrorEvents.tryEmit(error)
                    errorMessages.tryEmit(error.message)
                }
            }
        } catch (_: Exception) {
            // Unknown/malformed broadcasts cannot corrupt the last authoritative state.
        }
    }

    /** Typed command: the name and payload shape come from the generated contract. */
    suspend fun <P> send(command: ContractCommand<P>, payload: P, expectedShareId: String? = null): MeetingSnapshot =
        command(command.type, command.encode(payload), expectedShareId)

    /** Untyped escape hatch kept for smoke tests; app code uses [send]. */
    suspend fun command(type: String, payload: JsonObject = buildJsonObject {}, expectedShareId: String? = null): MeetingSnapshot {
        val id = lessonId ?: throw ApiException(400, "NO_LESSON", "수업을 먼저 선택해 주세요.")
        val ack = request(ContractProtocol.Events.Command, ThinkMeetJson.encodeToJsonElement(CommandEnvelope(id, type, payload, expectedShareId = expectedShareId)))
        return readAck(ack).also(::accept)
    }

    suspend fun preview(shareId: String, page: Int, tool: String, color: String, points: List<Point>) {
        val id = lessonId ?: return
        if (!connection.value) return
        api.requireEvent(ContractProtocol.Events.StrokePreview)
        val payload = ThinkMeetJson.encodeToJsonElement(StrokePreview(id, shareId, page, tool, color, points.takeLast(1000)))
        try { sendPacket(SocketIoCodec.event(ContractProtocol.Events.StrokePreview, payload)) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Transient previews need no retries. */ }
    }

    /** Pointer pulses are discarded while busy or disconnected; they never wait for a reconnect. */
    suspend fun assistancePointer(pointer: AssistancePointer) {
        if (!connection.value || !api.supportsFeature(ContractProtocol.FeatureIds.MeetingRemoteAssistance)) return
        val session = transport ?: return
        api.requireEvent(ContractProtocol.Events.AssistancePointer)
        if (!transportLock.tryLock()) return
        try {
            if (!connection.value || transport !== session || !api.supportsFeature(ContractProtocol.FeatureIds.MeetingRemoteAssistance)) return
            session.send(Frame.Text(SocketIoCodec.event(ContractProtocol.Events.AssistancePointer,
                ThinkMeetJson.encodeToJsonElement(pointer.copy(authorId = null)))))
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Transient pulses are not retried. */ }
        finally { transportLock.unlock() }
    }

    private suspend fun request(event: String, payload: JsonElement): JsonElement {
        val type = if (event == ContractProtocol.Events.Command) payload.jsonObject["type"]?.jsonPrimitive?.content else null
        api.requireEvent(event, type)
        if (!connection.value) throw ApiException(0, "RECONNECTING", "수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요.")
        val deferred = CompletableDeferred<JsonElement>()
        val ackId = ackLock.withLock { (++nextAck).also { pending[it] = deferred } }
        return try {
            sendPacket(SocketIoCodec.event(event, payload, ackId))
            try { withTimeout(15_000) { deferred.await() } }
            catch (_: TimeoutCancellationException) { throw ApiException(0, "ACK_TIMEOUT", "응답을 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.") }
        } finally {
            ackLock.withLock { pending.remove(ackId) }
        }
    }

    private fun readAck(ack: JsonElement): MeetingSnapshot {
        val body = ack.jsonObject
        if (body["ok"]?.jsonPrimitive?.booleanOrNull != true) {
            val error = body["error"]?.let { ThinkMeetJson.decodeFromString<RealtimeError>(it.toString()) } ?: RealtimeError("COMMAND_FAILED", "요청에 실패했어요.")
            throw ApiException(400, error.code, error.message)
        }
        return ThinkMeetJson.decodeFromString(body.getValue("snapshot").toString())
    }

    private suspend fun sendPacket(value: String) = transportLock.withLock {
        val session = transport ?: throw ApiException(0, "RECONNECTING", "수업 연결을 복구하고 있어요.")
        session.send(Frame.Text(value))
    }

    private suspend fun failPending() {
        val requests = ackLock.withLock { pending.values.toList().also { pending.clear() } }
        requests.forEach { it.completeExceptionally(ApiException(0, "RECONNECTING", "연결이 끊어졌어요. 다시 시도해 주세요.")) }
    }

    private fun report(error: Exception) {
        val message = error.message ?: "수업 상태를 불러오지 못했어요."
        errorMessages.tryEmit(message)
        if (error is ApiException) roomErrorEvents.tryEmit(RealtimeError(error.code, message))
        if (error is ApiException && error.code == "UNAUTHENTICATED") api.reportAuthExpired(message)
    }
}
