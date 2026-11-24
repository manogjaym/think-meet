package com.woongjin.thinkmeet.ui

import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.lessonRecordingSupported
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.datetime.*
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

sealed interface Route {
    data object Home : Route
    data object Create : Route
    data class Notes(val tab: NotesTab) : Route
    data object Students : Route
    data class Attendance(val student: User) : Route

    sealed interface ForLesson : Route { val lesson: Lesson }
    data class Detail(override val lesson: Lesson) : ForLesson
    data class Edit(override val lesson: Lesson) : ForLesson
    data class Created(override val lesson: Lesson) : ForLesson
    data class Prejoin(override val lesson: Lesson) : ForLesson
    data class Waiting(override val lesson: Lesson) : ForLesson
    data class Meeting(val admission: JoinResult) : ForLesson {
        init { require(!admission.waiting) }
        override val lesson: Lesson get() = admission.lesson
    }
    data class Ended(override val lesson: Lesson) : ForLesson
}

private fun Route.refreshFrom(lessons: List<Lesson>): Route {
    if (this !is Route.ForLesson) return this
    val current = lessons.find { it.id == lesson.id } ?: return this
    return when (this) {
        is Route.Detail -> copy(lesson = current)
        is Route.Edit -> copy(lesson = current)
        is Route.Created -> copy(lesson = current)
        is Route.Prejoin -> copy(lesson = current)
        is Route.Waiting -> copy(lesson = current)
        is Route.Meeting -> copy(admission = admission.copy(lesson = current))
        is Route.Ended -> copy(lesson = current)
    }
}

data class AppUiState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val user: User? = null,
    val lessons: List<Lesson> = emptyList(),
    val students: List<User> = emptyList(),
    val route: Route = Route.Home,
    val error: String? = null,
    val camera: Boolean = true,
    val microphone: Boolean = false,
    /** The owner chose to record the screen for the next admission from prejoin. */
    val recordLesson: Boolean = false,
)

/** One owner for requests and admission: repeated taps cannot rotate a live admission token. */
class AppState(val api: ThinkMeetApi, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow(AppUiState())
    val state = mutable.asStateFlow()
    val capabilities = api.capabilities
    fun supportsFeature(feature: String): Boolean = api.supportsFeature(feature)
    private var waitingJob: Job? = null
    private var sessionJob: Job? = null
    private var operationJob: Job? = null
    private var postMeetingJob: Job? = null
    private var operationVersion = 0L
    private var sessionVersion = 0L
    private var closed = false
    private val refreshLock = kotlinx.coroutines.sync.Mutex()
    private val authObserver = scope.launch {
        api.authExpired.collect { message ->
            if (state.value.user != null) expireSession(message)
        }
    }
    private val capabilityJob = scope.launch {
        while (isActive) { api.refreshCapabilities(); delay(CapabilityRefreshIntervalMillis) }
    }
    /** Device recordings upload for the signed-in teacher only and pause while signed out. */
    val recordings = RecordingUploads(api, scope)
    private val recordingObserver = scope.launch {
        state.map { it.user?.takeIf { user -> user.isTeacher }?.id }.distinctUntilChanged().collect { recordings.attach(it) }
    }

    init { restore() }

    private fun work(block: suspend () -> Unit) {
        if (closed) return
        val before = mutable.value
        // Claim the action before launching: two taps in the same UI frame cannot both join.
        if (before.busy || !mutable.compareAndSet(before, before.copy(busy = true, error = null))) return
        val version = ++operationVersion
        operationJob = scope.launch(start = CoroutineStart.LAZY) {
            try { block() }
            catch (e: CancellationException) { throw e }
            catch (e: Throwable) { handleFailure(e) }
            finally {
                if (version == operationVersion && !closed) mutable.update { it.copy(busy = false, loading = false) }
            }
        }.also { it.start() }
    }

    private fun cancelWork() {
        operationVersion++
        operationJob?.cancel(); operationJob = null
        mutable.update { it.copy(busy = false, loading = false) }
    }

    private fun expireSession(message: String) {
        sessionVersion++
        sessionJob?.cancel(); sessionJob = null
        cancelWaiting()
        postMeetingJob?.cancel(); postMeetingJob = null
        cancelWork()
        mutable.value = AppUiState(loading = false, error = message)
    }

    private fun handleFailure(error: Throwable) {
        if (error is ApiError && error.status == 401 && error.code != "INVALID_CREDENTIALS" && state.value.user != null) {
            expireSession(error.message)
        } else if (!closed) mutable.update { it.copy(error = error.message ?: "요청을 처리하지 못했어요.") }
    }

    fun restore() = work {
        val user = try { api.me() } catch (e: ApiError) {
            if (e.status == 401) null else throw e
        }
        if (user == null) {
            sessionVersion++
            sessionJob?.cancel(); cancelWaiting()
            mutable.value = AppUiState(loading = false, busy = true)
        } else {
            sessionVersion++
            mutable.update { it.copy(user = user) }
            refresh(); watchHome()
        }
    }

    fun login(username: String, password: String) = work {
        val user = api.login(username.trim(), password)
        sessionVersion++
        mutable.value = AppUiState(loading = false, busy = true, user = user)
        refresh(); watchHome()
    }

    @OptIn(FlowPreview::class)
    private fun watchHome() {
        sessionJob?.cancel()
        sessionJob = scope.launch {
            state.map { state ->
                val visible = when (state.route) {
                    Route.Home, is Route.Detail, is Route.Created -> true
                    else -> false
                }
                state.user?.id to visible
            }
                .distinctUntilChanged().collectLatest { (userId, visible) ->
                    if (userId == null || !visible) return@collectLatest
                    coroutineScope {
                        val socket = api.realtime(this)
                        suspend fun updateLessons() {
                            try { refresh() }
                            catch (e: CancellationException) { throw e }
                            catch (e: Throwable) { handleFailure(e) }
                        }
                        val changes = launch { socket.lessonsChanged.debounce(500).collect { updateLessons() } }
                        try {
                            while (isActive) { delay(15_000); updateLessons() }
                        } finally { changes.cancel(); socket.close() }
                    }
                }
        }
    }

    suspend fun refresh() {
        refreshLock.lock()
        try {
            val user = state.value.user ?: return
            val version = sessionVersion
            coroutineScope {
                val lessons = async { api.lessons() }
                val students = async { if (user.role == "teacher") api.students() else emptyList() }
                val rows = lessons.await(); val roster = students.await()
                currentCoroutineContext().ensureActive()
                mutable.update { old ->
                    if (version != sessionVersion || old.user?.id != user.id || closed) old
                    else old.copy(lessons = rows, students = roster, route = old.route.refreshFrom(rows), error = null)
                }
            }
        } finally { refreshLock.unlock() }
    }

    fun reload() = work { refresh() }
    fun dismissError() { mutable.update { it.copy(error = null) } }
    fun logout() = work {
        api.logout()
        sessionVersion++
        sessionJob?.cancel(); cancelWaiting(); postMeetingJob?.cancel()
        mutable.value = AppUiState(loading = false, busy = true)
    }
    fun home() {
        show(Route.Home)
        reload()
    }
    fun open(lesson: Lesson) = openLesson(lesson) { Route.Detail(it) }
    fun prejoin(lesson: Lesson) {
        chooseRecording(false)
        openLesson(lesson) { Route.Prejoin(it) }
    }

    private fun openLesson(lesson: Lesson, destination: (Lesson) -> Route.ForLesson) = work {
        cancelWaiting()
        val fetched = api.lesson(lesson.id)
        currentCoroutineContext().ensureActive()
        mutable.update { it.copy(route = destination(fetched)) }
    }
    internal fun notes(tab: NotesTab) = show(Route.Notes(tab))
    internal fun attendanceStudents() = show(Route.Students)
    internal fun studentAttendance(student: User) = show(Route.Attendance(student))
    fun form() = show(Route.Create)
    fun edit(lesson: Lesson) = show(Route.Edit(lesson))

    private fun show(route: Route) {
        cancelWork(); cancelWaiting()
        mutable.update { it.copy(route = route, error = null) }
    }

    fun detail() {
        val current = state.value.route as? Route.ForLesson ?: return
        show(Route.Detail(current.lesson))
    }
    internal fun prejoinUnavailable(lessonId: String, status: String? = null, message: String? = null) {
        val route = state.value.route as? Route.Prejoin ?: return
        if (route.lesson.id != lessonId) return
        if (status == "ENDED" || status == "CANCELLED") show(Route.Ended(route.lesson.copy(status = status)))
        else {
            show(Route.Detail(route.lesson))
            mutable.update { it.copy(error = message) }
        }
    }
    /** Only the lesson owner is asked, on a device that can record its own screen. */
    fun asksRecording(lesson: Lesson): Boolean = state.value.user?.let(lesson::isOwner) == true && lesson.canJoin &&
        supportsFeature(ContractProtocol.FeatureIds.ClassroomRecording) && lessonRecordingSupported()
    fun chooseRecording(record: Boolean) { mutable.update { it.copy(recordLesson = record) } }
    fun devices(camera: Boolean, microphone: Boolean) { mutable.update { it.copy(camera = camera, microphone = microphone) } }
    fun joinCode(value: String) = work {
        if (state.value.route is Route.Meeting) return@work
        val code = parseJoinCode(value, api.origin)
        val lesson = api.byCode(code)
        currentCoroutineContext().ensureActive()
        if (state.value.route is Route.Meeting) return@work
        cancelWaiting()
        mutable.update { it.copy(route = Route.Prejoin(lesson)) }
    }
    fun save(input: LessonInput, clearSubject: Boolean = false) = work {
        val lessonId = when (val route = state.value.route) {
            Route.Create -> null
            is Route.Edit -> route.lesson.id
            else -> return@work
        }
        val lesson = api.saveLesson(input, lessonId, clearSubject)
        mutable.update { it.copy(route = if (lessonId == null) Route.Created(lesson) else Route.Detail(lesson)) }
        refresh()
    }
    fun cancel() = work {
        val detail = state.value.route as? Route.Detail ?: return@work
        val lesson = api.cancel(detail.lesson.id)
        mutable.update { it.copy(route = Route.Detail(lesson)) }
        refresh()
    }
    fun join() = work {
        val prejoin = state.value.route as? Route.Prejoin ?: return@work
        val result = api.join(prejoin.lesson.id)
        currentCoroutineContext().ensureActive()
        val route = admissionRoute(result)
        mutable.update { it.copy(route = route, error = null) }
        if (route is Route.Waiting) waitForTeacher(route.lesson.id)
    }

    private fun admissionRoute(result: JoinResult): Route.ForLesson =
        if (result.waiting) Route.Waiting(result.lesson) else Route.Meeting(result)

    private fun cancelWaiting() {
        waitingJob?.cancel()
        waitingJob = null
    }

    @OptIn(ExperimentalUuidApi::class)
    private fun waitForTeacher(id: String) {
        cancelWaiting()
        val userId = state.value.user?.id ?: return
        val version = sessionVersion
        waitingJob = scope.launch {
            val realtime = api.realtime(this, id)
            val admissionLock = kotlinx.coroutines.sync.Mutex()
            fun waitingRoute(): Route.Waiting? {
                val current = state.value
                if (version != sessionVersion || current.user?.id != userId) return null
                return (current.route as? Route.Waiting)?.takeIf { it.lesson.id == id }
            }
            suspend fun consider(lesson: Lesson) {
                admissionLock.lock()
                try {
                    if (waitingRoute() == null) return
                    if (lesson.status in listOf("ENDED", "CANCELLED")) {
                        mutable.update { it.copy(route = Route.Ended(lesson), error = null) }
                        return
                    }
                    mutable.update { it.copy(route = Route.Waiting(lesson), error = null) }
                    if (lesson.status == "LIVE") {
                        // Socket broadcasts and fallback polls share one admission gate.
                        val result = api.join(id)
                        currentCoroutineContext().ensureActive()
                        if (waitingRoute() != null) mutable.update { it.copy(route = admissionRoute(result), error = null) }
                    }
                } finally { admissionLock.unlock() }
            }
            val updates = launch {
                realtime.snapshot.filterNotNull().collect { snapshot ->
                    try { consider(snapshot.lesson) }
                    catch (e: CancellationException) { throw e }
                    catch (e: Throwable) { handleFailure(e) }
                }
            }
            val presence = launch {
                if (state.value.user?.role != "student") return@launch
                val clientId = Uuid.random().toString()
                var registered = false
                try {
                    while (isActive && waitingRoute() != null) {
                        if (supportsFeature(ContractProtocol.FeatureIds.ClassroomPrejoin)) {
                            registered = true
                            withTimeoutOrNull(4_000) {
                                try { api.setPrejoinWait(id, clientId, active = true) }
                                catch (cancelled: CancellationException) { throw cancelled }
                                catch (_: ApiError) { /* Lesson polling handles admission and access errors. */ }
                            }
                        }
                        delay(5_000)
                    }
                } finally {
                    if (registered) withContext(NonCancellable) {
                        withTimeoutOrNull(4_000) {
                            try { api.setPrejoinWait(id, clientId, active = false) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: ApiError) { /* The server expires the waiting record. */ }
                        }
                    }
                }
            }
            try {
                while (isActive && waitingRoute() != null) {
                    try { consider(api.lesson(id)) }
                    catch (e: CancellationException) { throw e }
                    catch (e: ApiError) {
                        val waiting = waitingRoute() ?: return@launch
                        if (e.status == 401) { handleFailure(e); return@launch }
                        if (e.status in listOf(403, 404)) {
                            mutable.update { it.copy(route = Route.Ended(waiting.lesson), error = e.message) }
                            return@launch
                        }
                        mutable.update { it.copy(error = e.message) }
                    } catch (e: Throwable) { handleFailure(e) }
                    if (waitingRoute() != null) delay(3_000)
                }
            } finally { presence.cancel(); updates.cancel(); realtime.close() }
        }
    }
    fun meetingExit(ended: Boolean) {
        val before = state.value
        val user = before.user ?: return
        val meeting = before.route as? Route.Meeting ?: return
        val endedRoute = Route.Ended(meeting.lesson)
        val version = sessionVersion
        mutable.update { it.copy(route = endedRoute, recordLesson = false) }
        postMeetingJob?.cancel()
        postMeetingJob = scope.launch {
            try {
                val lesson = api.lesson(meeting.lesson.id)
                currentCoroutineContext().ensureActive()
                mutable.update { old ->
                    // The summary belongs to this visit to Ended, even if the user rejoins the same lesson.
                    if (version == sessionVersion && old.user?.id == user.id && old.route === endedRoute && !closed) {
                        old.copy(route = Route.Ended(lesson))
                    } else old
                }
            } catch (e: CancellationException) { throw e }
            catch (e: ApiError) { if (e.status == 401) handleFailure(e) }
            catch (_: Exception) { /* Returning home remains available while offline. */ }
        }
    }
    fun close() {
        closed = true
        operationVersion++; sessionVersion++
        operationJob?.cancel(); waitingJob?.cancel(); sessionJob?.cancel(); postMeetingJob?.cancel(); authObserver.cancel(); capabilityJob.cancel()
        recordingObserver.cancel(); recordings.attach(null)
    }
}

fun parseJoinCode(value: String, origin: String): String {
    val text = value.trim()
    if (text.startsWith("https://") || text.startsWith("http://")) {
        require(text.startsWith("${origin.trimEnd('/')}/join/")) { "이 서버의 수업 참여 링크를 입력해 주세요." }
        val code = text.substringAfter("/join/").substringBefore('?').substringBefore('#').trimEnd('/')
        require(code.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "참여 링크가 올바르지 않아요." }
        return code
    }
    require(text.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "수업 코드 또는 참여 링크를 입력해 주세요." }
    return text
}

val Seoul: TimeZone = TimeZone.of("Asia/Seoul")
fun localDateTime(value: String): LocalDateTime? = runCatching { Instant.parse(value).toLocalDateTime(Seoul) }.getOrNull()
fun lessonDate(value: String): String = localDateTime(value)?.let {
    "${it.month.number}월 ${it.day}일 · ${it.hour.toString().padStart(2,'0')}:${it.minute.toString().padStart(2,'0')}"
} ?: value
fun statusText(value: String) = when(value) { "LIVE" -> "진행 중"; "ENDED" -> "종료"; "CANCELLED" -> "취소"; else -> "예정" }
fun nextLessonTime(): LocalDateTime = (Clock.System.now() + 60.minutes).toLocalDateTime(Seoul)
