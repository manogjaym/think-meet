package com.woongjin.thinkmeet.ui

import com.woongjin.thinkmeet.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.datetime.*
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

enum class Route { Home, Detail, Form, Created, Prejoin, Waiting, Meeting, Ended }
data class AppUiState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val user: User? = null,
    val lessons: List<Lesson> = emptyList(),
    val students: List<User> = emptyList(),
    val selected: Lesson? = null,
    val route: Route = Route.Home,
    val admission: JoinResult? = null,
    val error: String? = null,
    val camera: Boolean = true,
    val microphone: Boolean = false,
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
        while (isActive) { api.refreshCapabilities(); delay(CapabilityRefreshMillis) }
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
        waitingJob?.cancel(); waitingJob = null
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
            sessionJob?.cancel(); waitingJob?.cancel()
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
            state.map { it.user?.id to (it.route in listOf(Route.Home, Route.Detail, Route.Created)) }
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
                    else old.copy(lessons = rows, students = roster,
                        selected = rows.find { it.id == old.selected?.id } ?: old.selected, error = null)
                }
            }
        } finally { refreshLock.unlock() }
    }

    fun reload() = work { refresh() }
    fun dismissError() { mutable.update { it.copy(error = null) } }
    fun logout() = work {
        api.logout()
        sessionVersion++
        sessionJob?.cancel(); waitingJob?.cancel(); postMeetingJob?.cancel()
        mutable.value = AppUiState(loading = false, busy = true)
    }
    fun home() {
        cancelWork(); waitingJob?.cancel()
        mutable.update { it.copy(route = Route.Home, admission = null, error = null) }
        reload()
    }
    fun open(lesson: Lesson, route: Route = Route.Detail) = work {
        // Leaving the waiting screen must stop its polling/admission flow before opening prejoin.
        waitingJob?.cancel(); waitingJob = null
        val current = api.lesson(lesson.id)
        mutable.update { it.copy(selected = current, route = route, admission = null) }
    }
    fun form(edit: Boolean = false) {
        cancelWork(); waitingJob?.cancel()
        mutable.update { it.copy(route = Route.Form, selected = if (edit) it.selected else null, admission = null, error = null) }
    }
    fun detail() {
        cancelWork(); waitingJob?.cancel()
        mutable.update { it.copy(route = Route.Detail, admission = null, error = null) }
    }
    fun devices(camera: Boolean, microphone: Boolean) { mutable.update { it.copy(camera = camera, microphone = microphone) } }
    fun joinCode(value: String) = work {
        val code = parseJoinCode(value, api.origin)
        val lesson = api.byCode(code)
        mutable.update { it.copy(selected = lesson, route = Route.Prejoin, admission = null) }
    }
    fun save(input: LessonInput) = work {
        val existing = state.value.selected
        val lesson = api.saveLesson(input, existing?.id)
        mutable.update { it.copy(selected = lesson, route = if (existing == null) Route.Created else Route.Detail) }
        refresh()
    }
    fun cancel() = work {
        state.value.selected?.let { lesson ->
            val cancelled = api.cancel(lesson.id)
            mutable.update { it.copy(selected = cancelled, route = Route.Detail) }
            refresh()
        }
    }
    fun join() = work {
        val lesson = state.value.selected ?: return@work
        accept(api.join(lesson.id))
    }
    private fun accept(result: JoinResult) {
        mutable.update { it.copy(selected = result.lesson, admission = result,
            route = if (result.waiting) Route.Waiting else Route.Meeting, error = null) }
        if (result.waiting) waitForTeacher(result.lesson.id)
    }
    private fun waitForTeacher(id: String) {
        waitingJob?.cancel()
        val userId = state.value.user?.id ?: return
        val version = sessionVersion
        waitingJob = scope.launch {
            val realtime = api.realtime(this, id)
            val admissionLock = kotlinx.coroutines.sync.Mutex()
            fun stillWaiting() = version == sessionVersion && state.value.user?.id == userId &&
                state.value.route == Route.Waiting && state.value.selected?.id == id
            suspend fun consider(lesson: Lesson) {
                admissionLock.lock()
                try {
                    if (!stillWaiting()) return
                    mutable.update { it.copy(selected = lesson, error = null) }
                    if (lesson.status in listOf("ENDED", "CANCELLED")) {
                        mutable.update { it.copy(route = Route.Ended, admission = null) }
                    } else if (lesson.status == "LIVE") {
                        // Socket broadcasts and fallback polls share one admission gate.
                        val result = api.join(id)
                        currentCoroutineContext().ensureActive()
                        if (stillWaiting()) mutable.update { it.copy(selected = result.lesson, admission = result,
                            route = if (result.waiting) Route.Waiting else Route.Meeting, error = null) }
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
            try {
                while (isActive && stillWaiting()) {
                    try { consider(api.lesson(id)) }
                    catch (e: CancellationException) { throw e }
                    catch (e: ApiError) {
                        if (e.status == 401) { handleFailure(e); return@launch }
                        mutable.update { it.copy(error = e.message) }
                        if (e.status in listOf(403, 404)) {
                            mutable.update { it.copy(route = Route.Ended, admission = null) }; return@launch
                        }
                    } catch (e: Throwable) { handleFailure(e) }
                    if (stillWaiting()) delay(3_000)
                }
            } finally { updates.cancel(); realtime.close() }
        }
    }
    fun meetingExit(ended: Boolean) {
        val before = state.value
        if (before.user == null || before.route != Route.Meeting) return
        val id = before.selected?.id
        val version = sessionVersion
        mutable.update { it.copy(route = Route.Ended, admission = null) }
        postMeetingJob?.cancel()
        postMeetingJob = scope.launch {
            try {
                if (id != null) {
                    val lesson = api.lesson(id)
                    mutable.update { old ->
                        if (version == sessionVersion && old.user?.id == before.user.id && old.selected?.id == id && !closed) old.copy(selected = lesson) else old
                    }
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
