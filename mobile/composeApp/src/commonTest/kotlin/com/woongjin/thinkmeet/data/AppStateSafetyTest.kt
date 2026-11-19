package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.ui.AppState
import com.woongjin.thinkmeet.ui.Route
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AppStateSafetyTest {
    private val teacher = User("teacher", "teacher1", "선생님", "teacher")
    private val lesson = Lesson("lesson", "수업", teacher = teacher, startsAt = "2027-01-01T07:00:00Z", status = "SCHEDULED", code = "abc")
    private val jsonHeaders = headersOf("Content-Type", "application/json")

    @Test
    fun rapidJoinTapsIssueExactlyOneAdmissionRequest() = runTest {
        var joins = 0
        val releaseJoin = CompletableDeferred<Unit>()
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
            val body = when (request.url.encodedPath) {
                "/api/v1/auth/me" -> ThinkMeetJson.encodeToString(teacher)
                "/api/v1/lessons" -> ThinkMeetJson.encodeToString(listOf(lesson))
                "/api/v1/students" -> "[]"
                "/api/v1/lessons/lesson" -> ThinkMeetJson.encodeToString(lesson)
                "/api/v1/lessons/lesson/join" -> {
                    joins++
                    releaseJoin.await()
                    ThinkMeetJson.encodeToString(JoinResult(false, lesson, "admission", "wss://example.test/livekit"))
                }
                else -> error("Unexpected request: ${request.url.encodedPath}")
            }
            respond(body, headers = jsonHeaders)
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            controller.prejoin(lesson)
            runCurrent()
            repeat(100) { controller.join() }
            runCurrent()
            assertEquals(1, joins)
            releaseJoin.complete(Unit)
            runCurrent()
            val meeting = assertIs<Route.Meeting>(controller.state.value.route)
            assertEquals(lesson, meeting.lesson)
            assertEquals("admission", meeting.admission.token)
        } finally { controller.close(); client.close() }
    }

    @Test
    fun returningToPrejoinCancelsInflightWaitingPollBeforeItCanAdmit() = runTest {
        val student = User("student", "student1", "학생", "student")
        val scheduled = lesson.copy(students = listOf(student))
        val live = scheduled.copy(status = "LIVE")
        var lessonRequests = 0
        var joins = 0
        val pollStarted = CompletableDeferred<Unit>()
        val releasePoll = CompletableDeferred<Unit>()
        val prejoinStarted = CompletableDeferred<Unit>()
        val releasePrejoin = CompletableDeferred<Unit>()
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
                val body = when (request.url.encodedPath) {
                    "/api/v1/auth/me" -> ThinkMeetJson.encodeToString(student)
                    "/api/v1/lessons" -> ThinkMeetJson.encodeToString(listOf(scheduled))
                    "/api/v1/lessons/lesson" -> ThinkMeetJson.encodeToString(when (++lessonRequests) {
                        1 -> scheduled
                        2 -> {
                            pollStarted.complete(Unit)
                            // A transport may finish delivering its response after cancellation.
                            withContext(NonCancellable) { releasePoll.await() }
                            live
                        }
                        3 -> {
                            prejoinStarted.complete(Unit)
                            releasePrejoin.await()
                            scheduled
                        }
                        else -> error("Unexpected lesson poll after leaving the waiting room")
                    })
                    "/api/v1/lessons/lesson/join" -> {
                        joins++
                        ThinkMeetJson.encodeToString(if (joins == 1) JoinResult(true, scheduled)
                            else JoinResult(false, live, "unexpected-admission", "wss://example.test/livekit"))
                    }
                    else -> error("Unexpected request: ${request.url.encodedPath}")
                }
                respond(body, headers = jsonHeaders)
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            controller.prejoin(scheduled)
            runCurrent()
            controller.join()
            runCurrent()
            assertEquals(Route.Waiting(scheduled), controller.state.value.route)
            assertTrue(pollStarted.isCompleted)

            controller.prejoin(scheduled)
            runCurrent()
            assertTrue(prejoinStarted.isCompleted)
            assertEquals(Route.Waiting(scheduled), controller.state.value.route)
            // Keep open() pending so its route change cannot hide a stale automatic join.
            releasePoll.complete(Unit)
            runCurrent()
            assertEquals(1, joins)
            assertEquals(Route.Waiting(scheduled), controller.state.value.route)

            releasePrejoin.complete(Unit)
            runCurrent()
            advanceTimeBy(3_001)
            runCurrent()
            assertEquals(Route.Prejoin(scheduled), controller.state.value.route)
            assertEquals(1, joins)
            assertEquals(3, lessonRequests)
        } finally {
            releasePoll.complete(Unit)
            releasePrejoin.complete(Unit)
            controller.close(); client.close()
        }
    }

    @Test
    fun joinLinkLeadsThroughPrejoinWaitingMeetingAndEnded() = runTest {
        val student = User("student", "student1", "학생", "student")
        val scheduled = lesson.copy(students = listOf(student))
        val live = scheduled.copy(status = "LIVE")
        val ended = live.copy(status = "ENDED")
        val other = scheduled.copy(id = "other-lesson", code = "other")
        var current = scheduled
        var joins = 0
        val secondLinkStarted = CompletableDeferred<Unit>()
        val releaseSecondLink = CompletableDeferred<Unit>()
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
                val body = when (request.url.encodedPath) {
                    "/api/v1/auth/me" -> ThinkMeetJson.encodeToString(student)
                    "/api/v1/lessons" -> ThinkMeetJson.encodeToString(listOf(scheduled))
                    "/api/v1/join/abc" -> ThinkMeetJson.encodeToString(scheduled)
                    "/api/v1/join/other" -> {
                        secondLinkStarted.complete(Unit)
                        releaseSecondLink.await()
                        ThinkMeetJson.encodeToString(other)
                    }
                    "/api/v1/lessons/lesson" -> ThinkMeetJson.encodeToString(current)
                    "/api/v1/lessons/lesson/join" -> {
                        joins++
                        val result = if (current.status == "LIVE") JoinResult(false, current, "live-admission", "wss://example.test/livekit")
                            else JoinResult(true, current)
                        ThinkMeetJson.encodeToString(result)
                    }
                    else -> error("Unexpected request: ${request.url.encodedPath}")
                }
                respond(body, headers = jsonHeaders)
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            controller.joinCode("https://example.test/join/abc?source=invite")
            runCurrent()
            assertEquals(Route.Prejoin(scheduled), controller.state.value.route)
            controller.devices(camera = false, microphone = true)
            controller.join()
            runCurrent()
            assertEquals(Route.Waiting(scheduled), controller.state.value.route)
            assertEquals(1, joins)

            // The new link must not replace a meeting that opens while its lookup is pending.
            controller.joinCode("other")
            runCurrent()
            assertTrue(secondLinkStarted.isCompleted)
            current = live
            advanceTimeBy(3_001)
            runCurrent()
            val meeting = assertIs<Route.Meeting>(controller.state.value.route)
            assertEquals(live, meeting.lesson)
            assertEquals("live-admission", meeting.admission.token)
            assertEquals("wss://example.test/livekit", meeting.admission.livekitUrl)
            assertFalse(controller.state.value.camera)
            assertTrue(controller.state.value.microphone)
            assertEquals(2, joins)
            releaseSecondLink.complete(Unit)
            runCurrent()
            assertEquals(meeting, controller.state.value.route)

            current = ended
            controller.meetingExit(ended = true)
            runCurrent()
            assertEquals(Route.Ended(ended), controller.state.value.route)
            controller.home()
            runCurrent()
            assertEquals(Route.Home, controller.state.value.route)
        } finally {
            releaseSecondLink.complete(Unit)
            controller.close(); client.close()
        }
    }

    @Test
    fun delayedExitSummaryCannotOverwriteAdmissionOnReentry() = runTest {
        val live = lesson.copy(status = "LIVE")
        val rejoined = live.copy(title = "새 입장의 수업 정보")
        val stale = live.copy(title = "이전 퇴장의 수업 정보")
        var lessonRequests = 0
        var joins = 0
        val summaryStarted = CompletableDeferred<Unit>()
        val releaseSummary = CompletableDeferred<Unit>()
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
                val body = when (request.url.encodedPath) {
                    "/api/v1/auth/me" -> ThinkMeetJson.encodeToString(teacher)
                    "/api/v1/lessons" -> ThinkMeetJson.encodeToString(listOf(live))
                    "/api/v1/students" -> "[]"
                    "/api/v1/lessons/lesson" -> ThinkMeetJson.encodeToString(when (++lessonRequests) {
                        1, 3 -> live
                        2 -> {
                            summaryStarted.complete(Unit)
                            releaseSummary.await()
                            stale
                        }
                        else -> error("Unexpected lesson refresh")
                    })
                    "/api/v1/lessons/lesson/join" -> {
                        val result = if (++joins == 1) JoinResult(false, live, "first", "wss://example.test/livekit")
                            else JoinResult(false, rejoined, "second", "wss://example.test/livekit")
                        ThinkMeetJson.encodeToString(result)
                    }
                    else -> error("Unexpected request: ${request.url.encodedPath}")
                }
                respond(body, headers = jsonHeaders)
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            controller.prejoin(live)
            runCurrent()
            controller.join()
            runCurrent()
            assertEquals("first", assertIs<Route.Meeting>(controller.state.value.route).admission.token)

            controller.meetingExit(ended = false)
            runCurrent()
            assertTrue(summaryStarted.isCompleted)
            val ended = assertIs<Route.Ended>(controller.state.value.route)
            controller.prejoin(ended.lesson)
            runCurrent()
            assertEquals(Route.Prejoin(live), controller.state.value.route)
            controller.join()
            runCurrent()
            releaseSummary.complete(Unit)
            runCurrent()
            val meeting = assertIs<Route.Meeting>(controller.state.value.route)
            assertEquals(rejoined, meeting.lesson)
            assertEquals("second", meeting.admission.token)
            assertEquals(2, joins)
        } finally {
            releaseSummary.complete(Unit)
            controller.close(); client.close()
        }
    }

    @Test
    fun newAndEditFormsSaveToTheirOwnDestination() = runTest {
        val created = lesson.copy(id = "new-lesson")
        val edited = created.copy(title = "수정한 수업")
        var saved: Lesson? = null
        val mutations = mutableListOf<Pair<HttpMethod, String>>()
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
                val path = request.url.encodedPath
                val body = when {
                    path == "/api/v1/auth/me" -> ThinkMeetJson.encodeToString(teacher)
                    path == "/api/v1/students" -> "[]"
                    path == "/api/v1/lessons" && request.method == HttpMethod.Get ->
                        ThinkMeetJson.encodeToString(listOfNotNull(saved))
                    path == "/api/v1/lessons" && request.method == HttpMethod.Post -> {
                        mutations += request.method to path
                        saved = created
                        ThinkMeetJson.encodeToString(created)
                    }
                    path == "/api/v1/lessons/new-lesson" && request.method == HttpMethod.Patch -> {
                        mutations += request.method to path
                        saved = edited
                        ThinkMeetJson.encodeToString(edited)
                    }
                    path == "/api/v1/lessons/new-lesson" && request.method == HttpMethod.Get ->
                        ThinkMeetJson.encodeToString(saved)
                    else -> error("Unexpected request: ${request.method} $path")
                }
                respond(body, headers = jsonHeaders)
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            controller.form()
            assertEquals(Route.Create, controller.state.value.route)
            val input = LessonInput(title = created.title, startsAt = created.startsAt, endsAt = null)
            controller.save(input)
            runCurrent()
            assertEquals(Route.Created(created), controller.state.value.route)
            controller.open(created)
            runCurrent()
            val detail = assertIs<Route.Detail>(controller.state.value.route)
            controller.edit(detail.lesson)
            assertEquals(Route.Edit(created), controller.state.value.route)
            controller.detail()
            assertEquals(Route.Detail(created), controller.state.value.route)
            controller.edit(detail.lesson)
            controller.save(input.copy(title = edited.title))
            runCurrent()
            assertEquals(Route.Detail(edited), controller.state.value.route)
            assertEquals(listOf(HttpMethod.Post to "/api/v1/lessons", HttpMethod.Patch to "/api/v1/lessons/new-lesson"), mutations)
        } finally { controller.close(); client.close() }
    }

    @Test
    fun startup401IsQuietAndExpiredAuthenticatedSessionClearsPrivateState() = runTest {
        var authenticated = false
        var expired = false
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
            when {
                request.url.encodedPath == "/api/v1/auth/me" && !authenticated ->
                    respond("{\"code\":\"UNAUTHENTICATED\",\"message\":\"로그인이 필요합니다.\"}", HttpStatusCode.Unauthorized, jsonHeaders)
                request.url.encodedPath == "/api/v1/auth/login" -> {
                    authenticated = true
                    respond(ThinkMeetJson.encodeToString(teacher), headers = jsonHeaders)
                }
                expired -> respond("{\"code\":\"UNAUTHENTICATED\",\"message\":\"로그인이 만료되었습니다.\"}", HttpStatusCode.Unauthorized, jsonHeaders)
                request.url.encodedPath == "/api/v1/lessons" -> respond(ThinkMeetJson.encodeToString(listOf(lesson)), headers = jsonHeaders)
                request.url.encodedPath == "/api/v1/students" -> respond("[]", headers = jsonHeaders)
                else -> error("Unexpected request: ${request.url.encodedPath}")
            }
            }
        })
        val client = HttpClient(engine) { install(HttpTimeout) }
        val controller = AppState(ThinkMeetApi(client, "https://example.test"), backgroundScope)
        try {
            runCurrent()
            assertNull(controller.state.value.user)
            assertNull(controller.state.value.error)
            assertFalse(controller.state.value.loading)
            controller.login("teacher1", "mock-password")
            runCurrent()
            assertEquals(teacher.id, controller.state.value.user?.id)
            assertEquals(1, controller.state.value.lessons.size)
            expired = true
            controller.reload()
            runCurrent()
            assertNull(controller.state.value.user)
            assertEquals(Route.Home, controller.state.value.route)
            assertEquals(emptyList(), controller.state.value.lessons)
            assertEquals(emptyList(), controller.state.value.students)
            assertFalse(controller.state.value.busy)
        } finally { controller.close(); client.close() }
    }
}
