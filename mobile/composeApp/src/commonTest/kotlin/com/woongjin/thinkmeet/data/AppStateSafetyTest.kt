package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.ui.AppState
import com.woongjin.thinkmeet.ui.Route
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
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
            controller.open(lesson, Route.Prejoin)
            runCurrent()
            repeat(100) { controller.join() }
            runCurrent()
            assertEquals(1, joins)
            releaseJoin.complete(Unit)
            runCurrent()
            assertEquals(Route.Meeting, controller.state.value.route)
            assertEquals("admission", controller.state.value.admission?.token)
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
            controller.open(scheduled, Route.Prejoin)
            runCurrent()
            controller.join()
            runCurrent()
            assertEquals(Route.Waiting, controller.state.value.route)
            assertTrue(pollStarted.isCompleted)

            controller.open(scheduled, Route.Prejoin)
            runCurrent()
            assertTrue(prejoinStarted.isCompleted)
            assertEquals(Route.Waiting, controller.state.value.route)
            // Keep open() pending so its route change cannot hide a stale automatic join.
            releasePoll.complete(Unit)
            runCurrent()
            assertEquals(1, joins)
            assertEquals(Route.Waiting, controller.state.value.route)
            assertNull(controller.state.value.admission?.token)

            releasePrejoin.complete(Unit)
            runCurrent()
            advanceTimeBy(3_001)
            runCurrent()
            assertEquals(Route.Prejoin, controller.state.value.route)
            assertNull(controller.state.value.admission)
            assertEquals(1, joins)
            assertEquals(3, lessonRequests)
        } finally {
            releasePoll.complete(Unit)
            releasePrejoin.complete(Unit)
            controller.close(); client.close()
        }
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
            assertNull(controller.state.value.selected)
            assertNull(controller.state.value.admission)
            assertEquals(emptyList(), controller.state.value.lessons)
            assertEquals(emptyList(), controller.state.value.students)
            assertFalse(controller.state.value.busy)
        } finally { controller.close(); client.close() }
    }
}
