package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.ApiException
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.data.JoinResult
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.MeetingRealtime
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.RealtimeError
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.MediaFailure
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
    /**
     * classroom.subject-switch: when set, an ENDED lesson with `nextLessonId` continues in place (same media room)
     * and this receives the new lesson. If following fails, the session ends as before.
     */
    private val onContinued: ((Lesson) -> Unit)? = null,
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
    private var following: String? = null

    fun start(admission: JoinResult, camera: Boolean, microphone: Boolean) {
        if (observers != null || disposed) return
        val watching = SupervisorJob(job)
        observers = watching
        val watch = CoroutineScope(scope.coroutineContext + watching)
        watch.launch {
            link.snapshot.collect { snapshot ->
                val next = snapshot?.lesson?.nextLessonId
                if (snapshot?.lesson?.status == "ENDED" && next != null && onContinued != null) follow(next)
                else if (snapshotHasEnded()) endFromServer()
            }
        }
        // Observe native dismissal directly even while the stopped Activity is not recomposing.
        watch.launch { pip.state.collect { if (it.closedByUser) requestExit(Exit.Pip) } }
        watch.launch {
            link.roomErrors.collect { error ->
                when (error.code) {
                    in endedCodes -> endFromServer()
                    in roomAccessErrors -> fail(error.message)
                }
            }
        }
        watch.launch {
            media.state.map { (it.failure ?: MediaFailure.fromLegacyMessage(it.error)) to it.error }.distinctUntilChanged().collect { (failure, message) ->
                when {
                    failure != null -> fail("다른 기기에서 입장했거나 수업 접근이 종료되었어요.")
                    message != null -> report(message)
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
                error.code in endedCodes -> endFromServer()
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

    private fun follow(nextLessonId: String) {
        if (following == nextLessonId || disposed || localCleanup != null || mutable.value.exited) return
        following = nextLessonId
        scope.launch {
            val lesson = try { link.follow(nextLessonId) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { endFromServer(); return@launch }
            if (!disposed && localCleanup == null) onContinued?.invoke(lesson)
        }
    }

    fun leave(endForAll: Boolean) = requestExit(if (endForAll) Exit.End else Exit.Leave)
    fun returnToLessons() = requestExit(Exit.Return)

    private fun snapshotHasEnded(): Boolean {
        val lesson = link.snapshot.value?.lesson
        // A lesson being followed into its subject change is not over for this session.
        if (lesson?.status == "ENDED" && lesson.nextLessonId != null && lesson.nextLessonId == following) return false
        return lesson?.status == "ENDED" || lesson?.status == "CANCELLED"
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
        // Exact codes from contracts/openapi.json ErrorCode (plus the client-side session replacement).
        val endedCodes = setOf(ContractProtocol.ErrorCodes.Ended, ContractProtocol.ErrorCodes.Cancelled)
        val roomAccessErrors = setOf(ContractProtocol.ErrorCodes.Kicked, ContractProtocol.ErrorCodes.Forbidden, ContractProtocol.ErrorCodes.Unauthenticated, ContractProtocol.ErrorCodes.Account, SESSION_REPLACED)
        val snapshotAccessErrors = setOf(ContractProtocol.ErrorCodes.Kicked, ContractProtocol.ErrorCodes.Account)
        /** Emitted by MeetingRealtime when the same account subscribes from another device. */
        const val SESSION_REPLACED = "SESSION_REPLACED"
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
    /** Moves this session to the lesson that continues the ended one and returns it. */
    suspend fun follow(nextLessonId: String): Lesson
    fun close()
}

internal class ApiMeetingSessionTransport(
    private val api: ThinkMeetApi,
    private val realtime: MeetingRealtime,
    admittedLessonId: String,
) : MeetingSessionTransport {
    private val lessonId get() = realtime.currentLessonId.value ?: error("수업을 먼저 선택해 주세요.")
    init { check(realtime.currentLessonId.value == admittedLessonId) }
    override val snapshot = realtime.snapshot
    override val connected = realtime.connected
    override val roomErrors = realtime.roomErrors
    override fun start() = realtime.start()
    override suspend fun refreshSnapshot() = realtime.accept(api.snapshot(lessonId))
    override suspend fun confirmConnection() { api.connected(lessonId) }
    override suspend fun requestExit(endForAll: Boolean) {
        if (endForAll) api.end(lessonId) else api.leave(lessonId)
    }
    override suspend fun follow(nextLessonId: String): Lesson {
        realtime.follow(nextLessonId)
        // Confirms this participant in the moved room; the server keeps its admission and attendance.
        api.connected(nextLessonId)
        return api.snapshot(nextLessonId).also(realtime::accept).lesson
    }
    override fun close() = realtime.close()
}
