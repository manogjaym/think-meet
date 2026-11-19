package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.ApiException
import com.woongjin.thinkmeet.data.JoinResult
import com.woongjin.thinkmeet.data.MeetingRealtime
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.RealtimeError
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.PictureInPictureController
import com.woongjin.thinkmeet.platform.RemoteAssistanceController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.supervisorScope

internal data class MeetingSessionState(
    val busy: Boolean = false,
    val exited: Boolean = false,
    val fatalError: String? = null,
)

/** Main-thread owner of one admission. close() stops observers and drains the claimed exit. */
internal class MeetingSession(
    private val link: MeetingSessionTransport,
    private val media: MediaController,
    private val pip: PictureInPictureController,
    private val remote: RemoteAssistanceController,
    private val onExit: (Boolean) -> Unit,
    private val report: (String) -> Unit,
    dispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    private val job = SupervisorJob()
    private val scope = CoroutineScope(dispatcher + job)
    private val mutable = MutableStateFlow(MeetingSessionState())
    val state = mutable.asStateFlow()
    private val serverEnded = CompletableDeferred<Unit>()
    private var observers: Job? = null
    private var connection: Job? = null
    private var captureStop: Job? = null
    private var localCleanup: Job? = null
    private var realtimeClosed = false
    private var disposed = false

    fun start(admission: JoinResult, camera: Boolean, microphone: Boolean) {
        if (observers != null || disposed) return
        val watching = SupervisorJob(job)
        observers = watching
        val watch = CoroutineScope(scope.coroutineContext + watching)
        watch.launch { link.snapshot.collect { if (snapshotHasEnded()) endFromServer() } }
        // Observe native dismissal directly even while the stopped Activity is not recomposing.
        watch.launch { pip.state.collect { if (it.closedByUser) requestExit(Exit.Pip) } }
        watch.launch {
            link.roomErrors.collect { error ->
                val code = error.code.lowercase()
                when {
                    code == "ended" || code == "cancelled" -> endFromServer()
                    roomAccessErrors.any(code::contains) -> fail(error.message)
                }
            }
        }
        watch.launch {
            media.state.map { it.error }.distinctUntilChanged().collect { message ->
                if (message != null) {
                    if (mediaAccessErrors.any(message.lowercase()::contains)) fail("다른 기기에서 입장했거나 수업 접근이 종료되었어요.")
                    else report(message)
                }
            }
        }
        watch.launch {
            media.state.map { it.connected }.distinctUntilChanged().collectLatest { connected ->
                if (connected) confirmConnection()
            }
        }
        watch.launch {
            while (isActive) {
                delay(if (link.connected.value) 12_000L else 3_000L)
                refreshSnapshot()
            }
        }
        link.start()
        val connecting = watch.launch(start = CoroutineStart.LAZY) {
            refreshSnapshot(reportFailure = true)
            if (snapshotHasEnded()) endFromServer()
            if (localCleanup != null || serverEnded.isCompleted) return@launch
            val token = admission.token
            val url = admission.livekitUrl
            if (token.isNullOrBlank() || url.isNullOrBlank()) {
                fail("입장 정보가 만료되었어요. 수업에서 다시 입장해 주세요.")
                return@launch
            }
            try { media.connect(url, token, camera, microphone) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { fail(error.message ?: "영상 연결에 실패했어요.") }
        }
        connection = connecting
        connecting.start()
    }

    private suspend fun refreshSnapshot(reportFailure: Boolean = false) {
        try { link.refreshSnapshot() }
        catch (error: CancellationException) { throw error }
        catch (error: ApiException) {
            when {
                error.code == "ENDED" || error.code == "CANCELLED" -> endFromServer()
                error.status == 401 || error.status == 403 || error.code in snapshotAccessErrors -> fail(error.message)
                reportFailure -> report(error.message)
            }
        }
        catch (error: Exception) { if (reportFailure) report(error.message ?: requestError) }
    }

    private suspend fun confirmConnection() {
        var lastError: Exception? = null
        // LiveKit must contain the participant before the server will mark the owner LIVE.
        repeat(8) { attempt ->
            try { link.confirmConnection(); return }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                lastError = error
                delay(350L * (attempt + 1))
            }
        }
        lastError?.let { report(it.message ?: requestError) }
    }

    fun leave(endForAll: Boolean) = requestExit(if (endForAll) Exit.End else Exit.Leave)
    fun returnToLessons() = requestExit(Exit.Return)

    private fun snapshotHasEnded(): Boolean {
        val status = link.snapshot.value?.lesson?.status
        return status == "ENDED" || status == "CANCELLED"
    }

    private fun endFromServer() {
        serverEnded.complete(Unit)
        requestExit(Exit.Server)
    }

    private fun requestExit(exit: Exit) {
        if (disposed || mutable.value.busy || mutable.value.exited) return
        if (snapshotHasEnded()) serverEnded.complete(Unit)
        mutable.value = mutable.value.copy(busy = true)
        scope.launch {
            try {
                if (exit.force || serverEnded.isCompleted) releaseLocal()
                else {
                    pip.update(false, null)
                    stopCapture().join()
                }
                if (exit != Exit.Server) notifyServer(exit == Exit.End)
            } catch (error: CancellationException) {
                resetExitAttempt()
                throw error
            } catch (error: Exception) {
                if (!exit.force && !serverEnded.isCompleted && !disposed) {
                    resetExitAttempt()
                    report(error.message ?: requestError)
                    return@launch
                }
            }
            releaseLocal().join()
            val ended = exit == Exit.End || serverEnded.isCompleted || snapshotHasEnded()
            closeRealtime()
            mutable.value = mutable.value.copy(busy = false, exited = true)
            if (!disposed) onExit(ended)
            job.complete()
        }
    }

    private fun resetExitAttempt() {
        if (localCleanup == null) captureStop = null
        mutable.value = mutable.value.copy(busy = false)
    }

    private suspend fun notifyServer(endForAll: Boolean) = supervisorScope {
        if (serverEnded.isCompleted || snapshotHasEnded()) return@supervisorScope
        val request = async { link.requestExit(endForAll) }
        try {
            select<Unit> {
                serverEnded.onAwait { }
                request.onAwait { }
            }
        } finally { request.cancel() }
    }

    private fun stopCapture(): Job = captureStop ?: scope.launch(start = CoroutineStart.LAZY) {
        remote.clearPointer()
        bestEffort { remote.stopScreenShare() }
    }.also { captureStop = it; it.start() }

    private fun releaseLocal(): Job = localCleanup ?: scope.launch(start = CoroutineStart.LAZY) {
        connection?.cancel()
        pip.close()
        stopCapture().join()
        bestEffort { media.disconnect() }
    }.also { localCleanup = it; it.start() }

    private fun fail(message: String) {
        if (disposed || localCleanup != null || mutable.value.exited) return
        mutable.value = mutable.value.copy(fatalError = message)
        releaseLocal()
        closeRealtime()
    }

    private fun closeRealtime() {
        if (realtimeClosed) return
        realtimeClosed = true
        observers?.cancel()
        link.close()
    }

    fun close() {
        if (disposed) return
        // Android can destroy the Activity before the observer sees the sticky PiP event.
        if (pip.state.value.closedByUser) requestExit(Exit.Pip)
        disposed = true
        closeRealtime()
        val cleanup = releaseLocal()
        scope.launch { cleanup.join(); job.complete() }
    }

    private suspend fun bestEffort(block: suspend () -> Unit) {
        try { block() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { /* Continue with the remaining resources. */ }
    }

    private enum class Exit(val force: Boolean = false) { Leave, End, Pip(true), Return(true), Server(true) }

    private companion object {
        const val requestError = "요청을 처리하지 못했어요."
        val roomAccessErrors = listOf("kick", "forbidden", "unauthorized", "unauthenticated", "not_invited", "account", "expired", "replaced", "banned")
        val snapshotAccessErrors = setOf("KICKED", "NOT_INVITED", "ACCOUNT", "REPLACED")
        val mediaAccessErrors = listOf("replaced", "duplicate_identity", "participant_removed", "kicked")
    }
}

internal interface MeetingSessionTransport {
    val snapshot: StateFlow<MeetingSnapshot?>
    val connected: StateFlow<Boolean>
    val roomErrors: Flow<RealtimeError>
    fun start()
    suspend fun refreshSnapshot()
    suspend fun confirmConnection()
    suspend fun requestExit(endForAll: Boolean)
    fun close()
}

internal class ApiMeetingSessionTransport(
    private val api: ThinkMeetApi,
    private val realtime: MeetingRealtime,
    private val lessonId: String,
) : MeetingSessionTransport {
    override val snapshot = realtime.snapshot
    override val connected = realtime.connected
    override val roomErrors = realtime.roomErrors
    override fun start() = realtime.start()
    override suspend fun refreshSnapshot() = realtime.accept(api.snapshot(lessonId))
    override suspend fun confirmConnection() { api.connected(lessonId) }
    override suspend fun requestExit(endForAll: Boolean) {
        if (endForAll) api.end(lessonId) else api.leave(lessonId)
    }
    override fun close() = realtime.close()
}
