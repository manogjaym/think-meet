package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.MeetingRealtime
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.MediaController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Binds one regular OS capture to an acknowledged server share. Approved assistance has its own owner. */
internal class ScreenShareSession(
    private val media: MediaController,
    private val link: ScreenShareTransport,
    private val userId: String,
    parentScope: CoroutineScope,
    private val report: (Throwable) -> Unit,
) {
    private val job = SupervisorJob(parentScope.coroutineContext[Job])
    private val scope = CoroutineScope(parentScope.coroutineContext + job)
    private var observer: Job? = null
    private var opening: Job? = null
    private var startRequest: Job? = null
    private var cleanup: Job? = null
    private var attemptedCapture = 0L
    private var owned: OwnedShare? = null
    private var pendingStop: String? = null
    private var sendingStop: Job? = null
    private var retryOnCompletion = false
    private val share get() = link.snapshot.value?.share
    private val canPublish get() = link.snapshot.value.let { snapshot ->
        snapshot?.instruction == null || (snapshot.instruction.phase == "classroom" && snapshot.lesson.teacher.id == userId)
    }

    fun observe() {
        if (observer != null) return
        observer = scope.launch {
            var wasReady = false
            combine(media.state, link.snapshot, link.subscribed) { _, _, _ -> Unit }.collect {
                val ready = link.subscribed.value
                reconcile()
                if (ready && !wasReady) {
                    if (sendingStop?.isActive == true) retryOnCompletion = true else flushStop()
                }
                wasReady = ready
            }
        }
    }

    fun startCapture() {
        if (!canPublish || !job.isActive || opening?.isActive == true || startRequest?.isActive == true || cleanup?.isActive == true ||
            media.state.value.screenCaptureId != 0L || media.state.value.screenSharing) return
        if (!media.state.value.connected || !link.subscribed.value) {
            report(IllegalStateException("수업 연결 후 화면을 공유해 주세요."))
            return
        }
        opening = scope.launch(start = CoroutineStart.LAZY) {
            try { media.setScreenShare(true) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
        }.also { it.start() }
    }

    fun stop(id: String) {
        val current = share?.takeIf { it.id == id } ?: return
        if (current.isRegularScreen() && (owned?.shareId == id || media.state.value.screenCaptureId != 0L)) stopCapture()
        requestStop(id, explicit = true)
    }

    fun stopCapture() {
        if (!job.isActive || cleanup?.isActive == true) return
        opening?.cancel()
        val id = owned?.shareId
        owned = null
        val captureId = media.state.value.screenCaptureId
        if (captureId != 0L) attemptedCapture = captureId
        cleanup = scope.launch(start = CoroutineStart.LAZY) {
            try { media.setScreenShare(false) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
        }.also { it.start() }
        if (id != null && share?.id == id) requestStop(id, explicit = false)
    }

    private fun reconcile() {
        val current = share
        val state = media.state.value
        if (pendingStop != current?.id) pendingStop = null
        val binding = owned
        if (binding != null) {
            if (binding.shareId != current?.id) {
                owned = null
                if (binding.captureId == state.screenCaptureId) stopCapture()
            } else if (binding.captureId != state.screenCaptureId) {
                owned = null
                requestStop(binding.shareId, explicit = false)
            }
        }
        val captureId = state.screenCaptureId
        if (!canPublish) {
            if (opening?.isActive == true || (captureId != 0L && captureId != attemptedCapture)) stopCapture()
            return
        }
        if (captureId == 0L || captureId == attemptedCapture || cleanup?.isActive == true || startRequest?.isActive == true ||
            !state.screenSharing || !state.connected || !link.subscribed.value) return
        attemptedCapture = captureId
        startRequest = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val selected = link.startShare()
                if (selected == null || !selected.isRegularScreen() || share?.id != selected.id) {
                    if (media.state.value.screenCaptureId == captureId) stopCapture()
                } else if (media.state.value.screenCaptureId != captureId || cleanup?.isActive == true) {
                    requestStop(selected.id, explicit = false)
                } else owned = OwnedShare(captureId, selected.id)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (media.state.value.screenCaptureId == captureId) stopCapture()
                report(error)
            }
        }.also { it.start() }
    }

    private fun requestStop(id: String, explicit: Boolean) {
        if (share?.id != id) return
        if (explicit && !link.guardedStop()) flushStop(legacyId = id)
        else {
            pendingStop = id
            flushStop()
        }
    }

    private fun flushStop(legacyId: String? = null) {
        val id = legacyId ?: pendingStop ?: return
        if (sendingStop?.isActive == true || share?.id != id || (legacyId == null && !link.guardedStop())) return
        if (!link.subscribed.value) {
            if (legacyId != null) report(IllegalStateException("수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요."))
            return
        }
        val send = scope.launch(start = CoroutineStart.LAZY) {
            try {
                link.stopShare(if (legacyId == null) id else null)
                if (pendingStop == id) pendingStop = null
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { report(error) }
            finally {
                sendingStop = null
                val retry = retryOnCompletion
                retryOnCompletion = false
                if (job.isActive && (retry || pendingStop != null && pendingStop != id)) flushStop()
            }
        }
        sendingStop = send
        send.start()
    }

    private fun Share.isRegularScreen() = type == "screen" && ownerId == userId && assistanceId == null

    fun close() { job.cancel() }

    private data class OwnedShare(val captureId: Long, val shareId: String)
}

internal interface ScreenShareTransport {
    val snapshot: StateFlow<MeetingSnapshot?>
    val subscribed: StateFlow<Boolean>
    fun guardedStop(): Boolean
    suspend fun startShare(): Share?
    suspend fun stopShare(expectedShareId: String?)
}

internal class RealtimeScreenShareTransport(private val api: ThinkMeetApi, private val realtime: MeetingRealtime) : ScreenShareTransport {
    override val snapshot = realtime.snapshot
    override val subscribed = realtime.subscribed
    override fun guardedStop() = (api.capabilities.value.contractRevision ?: 0) >= 5
    override suspend fun startShare() = realtime.command("share.start", buildJsonObject { put("type", "screen") }).share
    override suspend fun stopShare(expectedShareId: String?) {
        realtime.command("share.stop", expectedShareId = expectedShareId)
    }
}
