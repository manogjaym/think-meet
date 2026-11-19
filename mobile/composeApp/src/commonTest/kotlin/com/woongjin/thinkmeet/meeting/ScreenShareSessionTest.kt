package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.MediaState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class ScreenShareSessionTest {
    @Test
    fun stopFromEitherControlReleasesCaptureBeforeTheServerAcknowledges() = runTest {
        val fixture = Fixture(backgroundScope)
        fixture.start()
        runCurrent()
        fixture.link.stopAck = CompletableDeferred()

        fixture.session.stop(screen.id)
        fixture.session.stop(screen.id)
        runCurrent()

        assertEquals(1, fixture.media.stops)
        assertEquals(0L, fixture.media.state.value.screenCaptureId)
        assertEquals(listOf<String?>(screen.id), fixture.link.stops)
        assertEquals(screen, fixture.link.share)
        fixture.link.stopAck.complete(Unit)
        runCurrent()
        assertNull(fixture.link.share)
        fixture.assertNoErrors()
    }

    @Test
    fun osEndOfflineRetriesOnlyTheBoundShareAfterSubscription() = runTest {
        val fixture = Fixture(backgroundScope)
        fixture.start()
        runCurrent()
        fixture.link.subscribed.value = false
        runCurrent()
        fixture.media.endFromOs()
        runCurrent()
        assertEquals(0, fixture.media.stops, "OS already released the capture")
        assertEquals(emptyList(), fixture.link.stops)

        fixture.link.subscribed.value = true
        runCurrent()
        assertEquals(listOf<String?>(screen.id), fixture.link.stops)
        assertNull(fixture.link.share)
        fixture.assertNoErrors()
    }

    @Test
    fun mediaReconnectKeepsCaptureAndServerShareUntilTheServerClearsUnrecoveredVideo() = runTest {
        val fixture = Fixture(backgroundScope)
        fixture.start()
        runCurrent()
        val active = fixture.media.state.value
        fixture.media.state.value = active.copy(connected = false, reconnecting = true, screenSharing = false)
        runCurrent()
        fixture.media.state.value = active.copy(screenSharing = false)
        runCurrent()
        fixture.media.state.value = active
        runCurrent()
        assertEquals(screen, fixture.link.share)
        assertEquals(1, fixture.link.starts)
        assertEquals(0, fixture.media.stops)
        assertEquals(emptyList(), fixture.link.stops)

        fixture.media.state.value = active.copy(screenSharing = false)
        fixture.link.select(null)
        runCurrent()
        assertEquals(1, fixture.media.stops)
        assertEquals(emptyList(), fixture.link.stops)
        fixture.assertNoErrors()
    }

    @Test
    fun replacementStopsTheOldCaptureAndDoesNotReplayItsStop() = runTest {
        for (replacement in listOf(screen.copy(id = "new-screen"), screen.copy(id = "pdf", type = "document"))) {
            val fixture = Fixture(backgroundScope)
            fixture.start()
            runCurrent()
            fixture.link.subscribed.value = false
            runCurrent()
            if (replacement.type == "document") fixture.media.endFromOs()
            runCurrent()

            fixture.link.select(replacement)
            fixture.link.subscribed.value = true
            fixture.session.stop(screen.id)
            runCurrent()
            assertEquals(0L, fixture.media.state.value.screenCaptureId)
            assertEquals(if (replacement.type == "document") 0 else 1, fixture.media.stops)
            assertEquals(emptyList(), fixture.link.stops)
            assertEquals(replacement, fixture.link.share)
            fixture.assertNoErrors()
            fixture.session.close()
        }
    }

    @Test
    fun osEndBeforeStartAcknowledgementStopsTheAcknowledgedShare() = runTest {
        val fixture = Fixture(backgroundScope)
        fixture.link.startAck = CompletableDeferred()
        fixture.start()
        runCurrent()
        fixture.media.endFromOs()
        runCurrent()
        assertEquals(emptyList(), fixture.link.stops)

        fixture.link.startAck.complete(Unit)
        runCurrent()
        assertEquals(listOf<String?>(screen.id), fixture.link.stops)
        assertEquals(0, fixture.media.stops)
        assertNull(fixture.link.share)
        fixture.assertNoErrors()
    }

    @Test
    fun assistedPublicationDoesNotStartARegularShare() = runTest {
        val fixture = Fixture(backgroundScope)
        fixture.media.state.value = fixture.media.state.value.copy(screenSharing = true)
        fixture.link.select(screen.copy(assistanceId = "assistance"))
        runCurrent()
        assertEquals(0, fixture.link.starts)
        assertEquals(0, fixture.media.stops)
        fixture.assertNoErrors()
    }

    private class Fixture(scope: CoroutineScope) {
        val media = FakeMedia()
        val link = FakeLink()
        val errors = mutableListOf<Throwable>()
        val session = ScreenShareSession(media, link, "teacher", scope) { errors += it }
        init { session.observe() }
        fun start() { session.startCapture() }
        fun assertNoErrors() = assertEquals(emptyList(), errors)
    }

    private class FakeMedia : MediaController {
        override val state = MutableStateFlow(MediaState(connected = true))
        private var nextCapture = 0L
        var stops = 0
        fun endFromOs() { state.value = state.value.copy(screenCaptureId = 0, screenSharing = false) }
        override suspend fun setScreenShare(enabled: Boolean) {
            if (enabled) state.value = state.value.copy(screenCaptureId = ++nextCapture, screenSharing = true)
            else { stops++; endFromOs() }
        }
        override suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean) = Unit
        override suspend fun disconnect() = Unit
        override suspend fun setCamera(enabled: Boolean) = Unit
        override suspend fun setMicrophone(enabled: Boolean) = Unit
        override suspend fun flipCamera() = Unit
        override suspend fun setSpeaker(enabled: Boolean) = Unit
    }

    private class FakeLink : ScreenShareTransport {
        override val snapshot = MutableStateFlow<MeetingSnapshot?>(null)
        override val subscribed = MutableStateFlow(true)
        val share get() = snapshot.value?.share
        var starts = 0
        val stops = mutableListOf<String?>()
        var startAck = CompletableDeferred(Unit)
        var stopAck = CompletableDeferred(Unit)
        override fun guardedStop() = true
        fun select(share: Share?) { snapshot.value = MeetingSnapshot("lesson", lesson, share = share, serverTime = date) }
        override suspend fun startShare(): Share { starts++; select(screen); startAck.await(); return screen }
        override suspend fun stopShare(expectedShareId: String?) {
            stops += expectedShareId
            stopAck.await()
            if (share?.id == expectedShareId) select(null)
        }
    }

    private companion object {
        const val date = "2026-11-19T07:00:00Z"
        val lesson = Lesson("lesson", "수업", teacher = User("teacher", "teacher", "선생님", "teacher"), startsAt = date, status = "LIVE", code = "lesson")
        val screen = Share(id = "screen", type = "screen", ownerId = "teacher", page = 1, playing = false, position = 0.0, updatedAt = date)
    }
}
