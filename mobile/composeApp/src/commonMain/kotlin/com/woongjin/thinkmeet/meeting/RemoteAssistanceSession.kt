package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import kotlin.math.abs
import kotlin.time.Clock
import kotlin.time.Instant

/** The PiP presentation of the approved student: the teacher, or the student's own screen with the pointer (iOS). */
internal fun assistancePipTarget(remote: RemoteAssistanceController, userId: String, teacherId: String, geometry: AssistanceGeometry?): PipVideoTarget =
    if (!remote.showsPointerInPictureInPicture) PipVideoTarget(teacherId)
    else PipVideoTarget(userId, screen = true, aspectRatio = geometry?.takeIf { it.width > 0 && it.height > 0 }
        ?.let { it.width.toFloat() / it.height } ?: (16f / 9f))

internal fun assistanceAspectMatches(geometry: AssistanceGeometry?, aspect: Float?): Boolean =
    geometry != null && geometry.width > 0 && geometry.height > 0 && aspect != null && aspect.isFinite() &&
        abs(aspect / (geometry.width.toFloat() / geometry.height) - 1f) < .02f

/** Same pacing as the web teacher: moves at most 20/s, a held pointer refreshes the student's mark every 250ms. */
internal const val AssistancePointerIntervalMs = 50L
internal const val AssistancePointerHeartbeatMs = 250L

/** Positions outside the shared frame are dropped instead of being pinned to the student's screen edge. */
internal fun assistancePointerPosition(x: Float, y: Float, width: Int, height: Int): Pair<Double, Double>? {
    if (width <= 0 || height <= 0 || !x.isFinite() || !y.isFinite()) return null
    val normalizedX = x.toDouble() / width
    val normalizedY = y.toDouble() / height
    return if (normalizedX in 0.0..1.0 && normalizedY in 0.0..1.0) normalizedX to normalizedY else null
}

internal class AssistancePointerPacer(private val intervalMs: Long = AssistancePointerIntervalMs) {
    private var sentAt: Long? = null
    fun admit(now: Long): Boolean {
        val last = sentAt
        if (last != null && now - last < intervalMs) return false
        sentAt = now
        return true
    }
}

internal fun acceptsAssistancePointer(pointer: AssistancePointer, snapshot: MeetingSnapshot?, studentId: String, geometry: AssistanceGeometry?): Boolean {
    val session = snapshot?.assistance ?: return false
    val share = snapshot.share ?: return false
    return snapshot.lesson.status == "LIVE" && session.status == "active" && session.studentId == studentId &&
        pointer.lessonId == snapshot.lessonId && pointer.sessionId == session.id && pointer.shareId == share.id &&
        share.type == "screen" && share.ownerId == studentId && share.assistanceId == session.id && session.shareId == share.id &&
        pointer.authorId == snapshot.lesson.teacher.id && pointer.authorId == session.teacherId &&
        geometry != null && session.geometry == geometry && pointer.geometryVersion == geometry.version &&
        pointer.x.isFinite() && pointer.y.isFinite() && pointer.x in 0.0..1.0 && pointer.y in 0.0..1.0
}

/** Remote stroke previews expire like the stage's previews when the end-of-stroke message is lost. */
internal const val AssistancePreviewTtlMs = 2_000L

/**
 * The teacher's strokes to draw over the approved student's own screen: confirmed strokes and live previews of the
 * current share page only, and only for a session the server marked as annotation-capable (Android, never iOS).
 */
internal fun assistanceAnnotations(snapshot: MeetingSnapshot?, studentId: String, geometry: AssistanceGeometry?, previews: Collection<StrokePreview>): List<RemoteStroke> {
    val share = annotatableShare(snapshot, studentId, geometry) ?: return emptyList()
    // The teacher and, while allowed, the sharing student draw here; the server rejects everyone else.
    val authors = setOf(snapshot!!.assistance!!.teacherId, studentId)
    val confirmed = snapshot.strokes.filter { it.shareId == share.id && it.page == share.page && !it.deleted && it.authorId in authors }
        .map { RemoteStroke(it.tool, it.color, it.points) }
    val live = previews.filter { it.shareId == share.id && it.page == share.page && it.authorId in authors && it.points.isNotEmpty() }
        .map { RemoteStroke(it.tool, it.color, it.points) }
    return confirmed + live
}

/** The student's own active, annotation-capable share whose layout matches this device, or null. */
private fun annotatableShare(snapshot: MeetingSnapshot?, studentId: String, geometry: AssistanceGeometry?): Share? {
    val session = snapshot?.assistance ?: return null
    val share = snapshot.share ?: return null
    if (snapshot.lesson.status != "LIVE" || session.status != "active" || session.annotation != true || session.studentId != studentId ||
        session.teacherId != snapshot.lesson.teacher.id || share.type != "screen" || share.ownerId != studentId || share.assistanceId != session.id ||
        session.shareId != share.id || geometry == null || session.geometry != geometry) return null
    return share
}

/** The sharing student draws on their own screen only in lesson modes, and only while the teacher allows it. */
internal fun studentAnnotationAllowed(snapshot: MeetingSnapshot?, studentId: String): Boolean {
    val session = snapshot?.assistance ?: return false
    val share = snapshot.share ?: return false
    return snapshot.lesson.status == "LIVE" && snapshot.instruction != null && session.status == "active" && session.annotation == true &&
        session.studentId == studentId && share.ownerId == studentId && share.assistanceId == session.id && session.shareId == share.id &&
        snapshot.participants.firstOrNull { it.user.id == studentId }?.annotationAllowed == true
}

/** The student's own strokes under a finger, in device pixels (about 14dp on a typical phone). */
internal fun studentStrokesAt(snapshot: MeetingSnapshot, share: Share, studentId: String, point: Point, geometry: AssistanceGeometry): List<String> =
    snapshot.strokes.filter { it.shareId == share.id && it.page == share.page && !it.deleted && it.authorId == studentId &&
        hitsStroke(point, it.points, geometry.width.toFloat(), geometry.height.toFloat(), tolerance = 36.0) }.map { it.id }

/** Owns only the student-approved capture; ordinary classroom screen sharing stays independent. */
internal class RemoteAssistanceSession(
    private val link: AssistanceTransport,
    private val remote: RemoteAssistanceController,
    private val pip: PictureInPictureController,
    private val userId: String,
    parentScope: CoroutineScope,
    private val report: (Throwable) -> Unit,
) {
    constructor(api: ThinkMeetApi, realtime: MeetingRealtime, remote: RemoteAssistanceController,
        pip: PictureInPictureController, userId: String, parentScope: CoroutineScope, report: (Throwable) -> Unit) :
        this(ApiAssistanceTransport(api, realtime), remote, pip, userId, parentScope, report)

    private val scope = CoroutineScope(parentScope.coroutineContext + SupervisorJob(parentScope.coroutineContext[Job]) + Dispatchers.Main.immediate)
    private val mutableBusy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = mutableBusy.asStateFlow()
    private var ownedId: String? = null
    private var generation = 0L
    private var approval: Job? = null
    private var geometryJob: Job? = null
    private var sendingGeometry: AssistanceGeometry? = null
    private val previews = MutableStateFlow<Map<String, Pair<StrokePreview, Long>>>(emptyMap())
    // The student's finished strokes until the snapshot carries them, so the overlay never flickers.
    private val optimistic = MutableStateFlow<Map<String, RemoteStroke>>(emptyMap())
    private val erasing = mutableSetOf<String>()

    init {
        scope.launch {
            combine(link.snapshot, link.connected, link.capabilities, remote.state) { snapshot, connected, capabilities, state ->
                Reconciliation(snapshot, connected, capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance), state)
            }.collect { value ->
                val id = ownedId ?: return@collect
                val current = value.snapshot?.assistance
                if (!value.enabled || !value.connected || current?.id != id || current.studentId != userId || value.snapshot?.lesson?.status != "LIVE" ||
                    current.status == "active" && !value.state.capturing) {
                    generation++
                    approval?.cancel()
                    geometryJob?.cancel()
                    cleanup(id, notify = value.connected)
                    return@collect
                }
                if (current.status == "active") {
                    val geometry = value.state.geometry
                    if (geometry == null) remote.clearPointer()
                    else if (geometry != current.geometry && geometry.version > (current.geometry?.version ?: 0) &&
                        (geometryJob?.isActive != true || sendingGeometry != geometry)) {
                        // A slow ACK must never block consent revocation, disconnect or feature-OFF cleanup.
                        geometryJob?.cancel()
                        sendingGeometry = geometry
                        geometryJob = scope.launch {
                            try { link.send(ContractProtocol.Commands.AssistanceGeometry, AssistanceGeometryPayload(id, geometry)) } catch (error: CancellationException) { throw error }
                            catch (error: Throwable) { report(error); withContext(NonCancellable) { cleanup(id, notify = true) } }
                        }
                    }
                }
            }
        }
        scope.launch {
            link.previews.collect { preview ->
                val author = preview.authorId ?: return@collect
                previews.update { if (preview.points.isEmpty()) it - author else it + (author to (preview to Clock.System.now().toEpochMilliseconds())) }
            }
        }
        scope.launch {
            previews.collectLatest { current ->
                if (current.isEmpty()) return@collectLatest
                delay(AssistancePreviewTtlMs)
                val cutoff = Clock.System.now().toEpochMilliseconds() - AssistancePreviewTtlMs
                previews.update { entries -> entries.filterValues { it.second > cutoff } }
            }
        }
        val annotating = combine(link.snapshot, link.connected, link.capabilities, remote.state) { snapshot, connected, capabilities, state ->
            val owned = ownedId
            owned != null && snapshot?.assistance?.id == owned && connected && state.capturing &&
                capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) &&
                capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAnnotation)
        }
        scope.launch {
            combine(annotating, link.snapshot, remote.state, previews, optimistic) { enabled, snapshot, state, live, pending ->
                if (!enabled) emptyList()
                else assistanceAnnotations(snapshot, userId, state.geometry, live.values.map { it.first }) +
                    pending.filterKeys { id -> snapshot?.strokes?.none { it.id == id } != false }.values
            }.distinctUntilChanged().collect { remote.showAnnotations(it) }
        }
        scope.launch {
            // The toolbar follows the teacher's permission; the student has no button to close it.
            combine(annotating, link.snapshot) { enabled, snapshot -> enabled && studentAnnotationAllowed(snapshot, userId) }
                .distinctUntilChanged().collect { enabled -> remote.setStudentAnnotation(enabled); pip.setActionBarAtStart(enabled) }
        }
        scope.launch {
            link.snapshot.collect { snapshot ->
                val ids = snapshot?.strokes?.mapTo(HashSet()) { it.id } ?: return@collect
                if (optimistic.value.keys.any { it in ids }) optimistic.update { pending -> pending.filterKeys { it !in ids } }
            }
        }
        scope.launch { remote.studentInput.collect(::studentInput) }
        scope.launch {
            link.pointers.collect { pointer ->
                if (link.connected.value && link.capabilities.value.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) &&
                    ownedId == pointer.sessionId && remote.state.value.capturing &&
                    acceptsAssistancePointer(pointer, link.snapshot.value, userId, remote.state.value.geometry)) remote.showPointer(pointer)
            }
        }
    }

    private fun studentInput(input: StudentAnnotationInput) {
        val snapshot = link.snapshot.value ?: return
        val geometry = remote.state.value.geometry ?: return
        val capabilities = link.capabilities.value
        if (ownedId == null || snapshot.assistance?.id != ownedId || !link.connected.value || !remote.state.value.capturing ||
            !capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) || !capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAnnotation) ||
            !studentAnnotationAllowed(snapshot, userId)) return
        val share = annotatableShare(snapshot, userId, geometry) ?: return
        when (input) {
            is StudentAnnotationInput.Preview -> scope.launch {
                runCatching { link.preview(share.id, share.page, input.tool, input.color, input.points.takeLast(256)) }
            }
            is StudentAnnotationInput.Stroke -> {
                if (input.points.isEmpty()) return
                val id = uniqueId()
                val first = input.points.first()
                val points = if (input.points.size == 1) input.points + first.copy(x = kotlin.math.min(1.0, first.x + .0001)) else input.points
                optimistic.update { it + (id to RemoteStroke(input.tool, input.color, points)) }
                scope.launch {
                    try { link.send(ContractProtocol.Commands.StrokeAdd, StrokeAddPayload(id, share.id, share.page, input.tool, input.color, points)) }
                    catch (error: CancellationException) { throw error }
                    catch (error: Throwable) { optimistic.update { it - id }; report(error) }
                    finally { withContext(NonCancellable) { runCatching { link.preview(share.id, share.page, input.tool, input.color, emptyList()) } } }
                }
            }
            is StudentAnnotationInput.Erase -> {
                val ids = studentStrokesAt(snapshot, share, userId, input.point, geometry).filter { it !in erasing }
                if (ids.isEmpty()) return
                erasing += ids
                scope.launch {
                    try { link.send(ContractProtocol.Commands.StrokeErase, StrokeErasePayload(ids.take(500))) }
                    catch (error: CancellationException) { throw error }
                    catch (error: Throwable) { report(error) }
                    finally { erasing -= ids.toSet() }
                }
            }
            StudentAnnotationInput.Undo -> scope.launch {
                try { link.send(ContractProtocol.Commands.AnnotationUndo, EmptyPayload()) }
                catch (error: CancellationException) { throw error }
                catch (error: Throwable) { report(error) }
            }
        }
    }

    fun approve(sessionId: String) {
        if (mutableBusy.value || ownedId != null) return
        mutableBusy.value = true
        ownedId = sessionId
        val token = ++generation
        approval = scope.launch {
            try {
                requireCurrent(sessionId, token, "pending")
                // Android needs PiP for its overlay; iOS shares through ReplayKit and treats PiP as optional.
                val pipRequired = remote.showsPointerOverOtherApps
                val pipAvailable = pip.state.value.supported && link.capabilities.value.supports(ContractProtocol.FeatureIds.MeetingPip)
                if (!remote.state.value.supported || pipRequired && !pip.state.value.supported) error("이 기기에서는 다른 앱 위 화면 안내를 지원하지 않아요.")
                if (pipRequired && !pipAvailable) error("화면 속 화면을 사용할 수 없어 화면 안내를 시작하지 못했어요.")
                pip.update(false, null)
                remote.ensureOverlayPermission()
                requireCurrent(sessionId, token, "pending")
                link.send(ContractProtocol.Commands.AssistanceRespond, AssistanceRespondPayload(sessionId, true))
                requireCurrent(sessionId, token, "approved")
                val geometry = remote.startScreenShare()
                requireCurrent(sessionId, token, "approved")
                val snapshot = link.send(ContractProtocol.Commands.AssistanceStart, AssistanceStartPayload(sessionId, geometry))
                requireCurrent(sessionId, token, "active")
                if (pipAvailable) {
                    // A teacher with the camera off still has an audio-call PiP presentation.
                    pip.update(true, assistancePipTarget(remote, userId, snapshot.lesson.teacher.id, snapshot.assistance?.geometry))
                    if (pipRequired) pip.enter()
                    // iOS keeps sharing without PiP; leaving the app still enters it automatically when allowed.
                    else try { pip.enter() } catch (error: CancellationException) { throw error } catch (error: Throwable) { report(error) }
                }
            } catch (error: Throwable) {
                withContext(NonCancellable) { cleanup(sessionId, notify = link.connected.value) }
                if (error !is CancellationException) report(error)
            } finally { mutableBusy.value = false }
        }
    }

    suspend fun stop(sessionId: String) {
        generation++
        approval?.cancel()
        geometryJob?.cancel()
        if (ownedId == sessionId) cleanup(sessionId, notify = true)
        else link.send(ContractProtocol.Commands.AssistanceStop, AssistanceStopPayload(sessionId))
    }

    private fun requireCurrent(id: String, token: Long, status: String) {
        val current = link.snapshot.value?.assistance
        val expiresAt = current?.expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        check(ownedId == id && token == generation && link.connected.value && link.capabilities.value.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) &&
            current?.id == id && current.studentId == userId && current.status == status &&
            (expiresAt == null || expiresAt > Clock.System.now())) { "화면 보기 요청이 종료되었어요. 선생님에게 다시 요청해 주세요." }
    }

    private suspend fun cleanup(id: String, notify: Boolean) {
        if (ownedId != id) return
        ownedId = null
        sendingGeometry = null
        remote.clearPointer()
        remote.showAnnotations(emptyList())
        remote.setStudentAnnotation(false)
        pip.setActionBarAtStart(false)
        optimistic.value = emptyMap()
        try { remote.stopScreenShare() }
        catch (error: CancellationException) { throw error }
        catch (error: Throwable) { report(error) }
        finally {
            if (notify && link.connected.value) runCatching {
                link.send(ContractProtocol.Commands.AssistanceStop, AssistanceStopPayload(id))
            }
        }
    }

    fun close() {
        generation++; remote.clearPointer(); remote.showAnnotations(emptyList()); remote.setStudentAnnotation(false); pip.setActionBarAtStart(false)
        scope.cancel(); remote.close()
    }

    private data class Reconciliation(val snapshot: MeetingSnapshot?, val connected: Boolean, val enabled: Boolean, val state: RemoteAssistanceState)
}

/** A narrow connection boundary keeps capture/consent cancellation independently testable. */
internal interface AssistanceTransport {
    val snapshot: StateFlow<MeetingSnapshot?>
    val connected: StateFlow<Boolean>
    val capabilities: StateFlow<FeatureCapabilities>
    val pointers: SharedFlow<AssistancePointer>
    val previews: Flow<StrokePreview> get() = emptyFlow()
    suspend fun preview(shareId: String, page: Int, tool: String, color: String, points: List<Point>) {}
    suspend fun command(type: String, payload: JsonObject): MeetingSnapshot
    suspend fun <P> send(command: ContractCommand<P>, payload: P): MeetingSnapshot = command(command.type, command.encode(payload))
}

private class ApiAssistanceTransport(private val api: ThinkMeetApi, private val realtime: MeetingRealtime) : AssistanceTransport {
    override val snapshot = realtime.snapshot
    override val connected = realtime.connected
    override val capabilities = api.capabilities
    override val pointers = realtime.assistancePointers
    override val previews = realtime.previews
    override suspend fun preview(shareId: String, page: Int, tool: String, color: String, points: List<Point>) =
        realtime.preview(shareId, page, tool, color, points)
    override suspend fun command(type: String, payload: JsonObject) = realtime.command(type, payload)
}
