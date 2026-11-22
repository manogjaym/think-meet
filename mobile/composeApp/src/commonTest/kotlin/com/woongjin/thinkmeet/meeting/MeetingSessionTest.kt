package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.AssistancePointer
import com.woongjin.thinkmeet.data.JoinResult
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.RealtimeError
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.MediaFailure
import com.woongjin.thinkmeet.platform.MediaState
import com.woongjin.thinkmeet.platform.PictureInPictureController
import com.woongjin.thinkmeet.platform.PictureInPictureState
import com.woongjin.thinkmeet.platform.PipVideoTarget
import com.woongjin.thinkmeet.platform.RemoteAssistanceController
import com.woongjin.thinkmeet.platform.RemoteAssistanceState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class MeetingSessionTest {
    @Test
    fun serverEndThenPipDismissalReleasesEachResourceOnce() = runTest {
        val fixture = Fixture(testScheduler)
        runCurrent()
        fixture.link.endLesson()
        runCurrent()
        assertEquals(1, fixture.media.disconnects)
        assertTrue(fixture.session.state.value.busy)

        fixture.pip.dismiss()
        runCurrent()
        assertTrue(fixture.exits.isEmpty(), "Navigation waits for the media release")
        fixture.media.disconnected.complete(Unit)
        runCurrent()
        fixture.session.close()
        runCurrent()

        assertEquals(emptyList(), fixture.link.exitRequests)
        assertEquals(listOf(true), fixture.exits)
        fixture.assertCleanedOnce()
    }

    @Test
    fun pipDismissalThenServerEndCancelsTheWaitingLeaveAndCleansUpOnce() = runTest {
        val fixture = Fixture(testScheduler)
        runCurrent()
        fixture.pip.dismiss()
        runCurrent()

        assertEquals(listOf(false), fixture.link.exitRequests, "Closing PiP leaves only this participant")
        assertEquals(1, fixture.media.disconnects, "Local media stops without waiting for the leave response")
        assertFalse(fixture.link.exitResponse.isCompleted)

        fixture.link.endLesson()
        runCurrent()
        assertTrue(fixture.link.requestFinished.isCompleted, "Server end should cancel the pending leave request")
        fixture.media.disconnected.complete(Unit)
        runCurrent()
        fixture.session.close()
        runCurrent()

        assertEquals(listOf(false), fixture.link.exitRequests)
        assertEquals(listOf(true), fixture.exits)
        fixture.assertCleanedOnce()
    }

    @Test
    fun disposalBeforePipObserverRunsStillLeavesPersonallyAndCleansUpOnce() = runTest {
        val fixture = Fixture(testScheduler)
        runCurrent()
        fixture.pip.dismiss()
        fixture.session.close()
        fixture.session.close()
        fixture.link.exitResponse.complete(Unit)
        fixture.media.disconnected.complete(Unit)
        runCurrent()

        assertEquals(listOf(false), fixture.link.exitRequests)
        assertTrue(fixture.exits.isEmpty(), "A disposed screen has already navigated away")
        fixture.assertCleanedOnce()
    }

    @Test
    fun failedManualEndLeavesMediaConnectedAndAllowsRetry() = runTest {
        val fixture = Fixture(testScheduler)
        runCurrent()
        assertEquals(listOf("realtime.start", "snapshot", "media.connect", "server.connected"), fixture.connectionEvents)
        fixture.link.exitResponse.completeExceptionally(IllegalStateException("응답 실패"))
        fixture.session.leave(endForAll = true)
        runCurrent()

        assertEquals(listOf("응답 실패"), fixture.errors)
        assertFalse(fixture.session.state.value.busy)
        assertEquals(0, fixture.media.disconnects)
        assertEquals(0, fixture.link.closes)

        fixture.link.exitResponse = CompletableDeferred(Unit)
        fixture.media.disconnected.complete(Unit)
        fixture.session.leave(endForAll = true)
        runCurrent()
        fixture.session.close()
        runCurrent()

        assertEquals(listOf(true, true), fixture.link.exitRequests)
        assertEquals(listOf(true), fixture.exits)
        assertEquals(1, fixture.media.disconnects)
        assertEquals(1, fixture.link.closes)
        assertEquals(1, fixture.pip.closes)
    }

    @Test
    fun onlyExactAccessCodesEndTheMeeting() = runTest {
        for (code in listOf("STALE_SHARE", "NOTE_SHARE_CHANGED", "RATE_LIMIT", "kicked")) {
            val fixture = Fixture(testScheduler)
            runCurrent()
            fixture.link.roomErrors.emit(RealtimeError(code, "non-fatal"))
            runCurrent()
            assertEquals(null, fixture.session.state.value.fatalError, code)
            fixture.session.close(); runCurrent()
        }
        for (code in listOf("KICKED", "ACCOUNT", "FORBIDDEN", "UNAUTHENTICATED", "SESSION_REPLACED")) {
            val fixture = Fixture(testScheduler)
            runCurrent()
            fixture.link.roomErrors.emit(RealtimeError(code, "access ended"))
            runCurrent()
            assertEquals("access ended", fixture.session.state.value.fatalError, code)
            fixture.session.close(); runCurrent()
        }
    }

    @Test
    fun typedOrLegacyMediaFailuresEndTheMeetingButPlainMessagesAreOnlyReported() = runTest {
        val plain = Fixture(testScheduler)
        runCurrent()
        plain.media.state.value = plain.media.state.value.copy(error = "카메라를 시작하지 못했어요: replaced lens")
        runCurrent()
        assertEquals(null, plain.session.state.value.fatalError)
        assertEquals(listOf("카메라를 시작하지 못했어요: replaced lens"), plain.errors)
        plain.session.close(); runCurrent()
        for (state in listOf(MediaState(failure = MediaFailure.Removed, error = "선생님이 참여를 종료했어요."), MediaState(error = "REPLACED: 다른 기기에서 수업에 입장했어요."), MediaState(error = "KICKED: 선생님이 참여를 종료했어요."))) {
            val fixture = Fixture(testScheduler)
            runCurrent()
            fixture.media.state.value = state
            runCurrent()
            assertTrue(fixture.session.state.value.fatalError != null, state.toString())
            fixture.session.close(); runCurrent()
        }
    }

    private class Fixture(scheduler: TestCoroutineScheduler) {
        val connectionEvents = mutableListOf<String>()
        val link = FakeLink(connectionEvents)
        val media = FakeMedia(connectionEvents)
        val pip = FakePip()
        val remote = FakeRemote()
        val exits = mutableListOf<Boolean>()
        val errors = mutableListOf<String>()
        val session = MeetingSession(link, media, pip, remote, { exits += it }, { errors += it }, StandardTestDispatcher(scheduler))

        init { session.start(JoinResult(false, lesson, "token", "wss://media.test"), camera = true, microphone = false) }

        fun assertCleanedOnce() {
            assertEquals(1, remote.clears)
            assertEquals(1, remote.stops)
            assertEquals(1, pip.closes)
            assertEquals(1, link.closes)
            assertEquals(1, media.disconnects)
            assertTrue(errors.isEmpty())
        }
    }

    private class FakeLink(private val connectionEvents: MutableList<String>) : MeetingSessionTransport {
        override val snapshot = MutableStateFlow<MeetingSnapshot?>(MeetingSnapshot(lesson.id, lesson, serverTime = startsAt))
        override val connected = MutableStateFlow(true)
        override val roomErrors = MutableSharedFlow<RealtimeError>()
        val exitRequests = mutableListOf<Boolean>()
        var exitResponse = CompletableDeferred<Unit>()
        val requestFinished = CompletableDeferred<Unit>()
        var closes = 0

        fun endLesson() { snapshot.value = snapshot.value!!.copy(lesson = lesson.copy(status = "ENDED"), seq = 1) }
        override fun start() { connectionEvents += "realtime.start" }
        override suspend fun refreshSnapshot() { connectionEvents += "snapshot" }
        override suspend fun confirmConnection() { connectionEvents += "server.connected" }
        override suspend fun requestExit(endForAll: Boolean) {
            exitRequests += endForAll
            try { exitResponse.await() } finally { requestFinished.complete(Unit) }
        }
        override fun close() { closes++ }
    }

    private class FakeMedia(private val connectionEvents: MutableList<String>) : MediaController {
        override val state = MutableStateFlow(MediaState())
        val disconnected = CompletableDeferred<Unit>()
        var disconnects = 0
        override suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean) {
            connectionEvents += "media.connect"
            state.value = state.value.copy(connected = true)
        }
        override suspend fun disconnect() {
            disconnects++
            disconnected.await()
            state.value = state.value.copy(connected = false)
        }
        override suspend fun setCamera(enabled: Boolean) = Unit
        override suspend fun setMicrophone(enabled: Boolean) = Unit
        override suspend fun flipCamera() = Unit
        override suspend fun setScreenShare(enabled: Boolean) = Unit
        override suspend fun setSpeaker(enabled: Boolean) = Unit
    }

    private class FakePip : PictureInPictureController {
        override val state = MutableStateFlow(PictureInPictureState(active = true))
        var closes = 0
        fun dismiss() { state.value = state.value.copy(active = false, closedByUser = true) }
        override fun update(enabled: Boolean, target: PipVideoTarget?) = Unit
        override suspend fun enter() = Unit
        override fun close() { closes++ }
    }

    private class FakeRemote : RemoteAssistanceController {
        override val state = MutableStateFlow(RemoteAssistanceState())
        var clears = 0
        var stops = 0
        override suspend fun ensureOverlayPermission() = Unit
        override suspend fun startScreenShare(): Nothing = error("Unexpected capture start")
        override fun showPointer(pointer: AssistancePointer) = Unit
        override fun clearPointer() { clears++ }
        override suspend fun stopScreenShare() { stops++ }
        override fun close() = Unit
    }

    private companion object {
        const val startsAt = "2026-11-19T07:00:00Z"
        val lesson = Lesson("lesson", "수업", teacher = User("teacher", "teacher", "선생님", "teacher"), startsAt = startsAt, status = "LIVE", code = "lesson")
    }
}
