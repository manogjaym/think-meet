package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.AssistanceSession
import com.woongjin.thinkmeet.data.ChatMessage
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.LessonInstruction
import com.woongjin.thinkmeet.data.LessonModeSetPayload
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.User
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class MeetingControllersTest {
    private class FakeModes : LessonModeTransport {
        val calls = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        var phase = "preparing"
        override suspend fun start(): MeetingSnapshot { calls += "start"; gate?.await(); phase = "classroom"; return snapshot(phase) }
        override suspend fun setMode(change: LessonModeSetPayload): MeetingSnapshot { calls += "set:${change.expectedMode}->${change.mode}"; phase = change.mode; return snapshot(phase) }
    }

    @Test
    fun startingStraightIntoMirroringStartsThenSwitchesAndOpensOnce() = runTest {
        val transport = FakeModes(); val opened = mutableListOf<String>()
        val modes = LessonModeController(transport, backgroundScope, { throw it }) { opened += it }
        modes.select("mirroring", phase = "preparing", ready = true, shareId = null, assistanceId = null)
        runCurrent()
        assertEquals(listOf("start", "set:classroom->mirroring"), transport.calls)
        assertEquals(listOf("mirroring"), opened)
        assertFalse(modes.busy)
    }

    @Test
    fun aChangeThatEndsSharingNeedsConfirmationAndOnlyOneRequestRunsAtATime() = runTest {
        val transport = FakeModes(); val opened = mutableListOf<String>()
        val modes = LessonModeController(transport, backgroundScope, { throw it }) { opened += it }
        modes.select("mirroring", phase = "classroom", ready = true, shareId = "share", assistanceId = null)
        runCurrent()
        assertTrue(transport.calls.isEmpty())
        assertEquals(LessonModeSetPayload("mirroring", "classroom", "share", null), modes.confirm)
        modes.confirmChange(ready = true)
        runCurrent()
        assertNull(modes.confirm)
        assertEquals(listOf("set:classroom->mirroring"), transport.calls)

        val slow = FakeModes().apply { gate = CompletableDeferred() }
        val busy = LessonModeController(slow, backgroundScope, { throw it }) {}
        busy.select("classroom", phase = "preparing", ready = true, shareId = null, assistanceId = null)
        busy.select("classroom", phase = "preparing", ready = true, shareId = null, assistanceId = null)
        runCurrent()
        assertTrue(busy.busy)
        assertEquals(listOf("start"), slow.calls)
        slow.gate!!.complete(Unit); runCurrent()
        assertFalse(busy.busy)
        busy.select("mirroring", phase = "preparing", ready = false, shareId = null, assistanceId = null)
        runCurrent()
        assertEquals(listOf("start"), slow.calls, "not connected: nothing is sent")
    }

    @Test
    fun unreadCountIgnoresInitialHistoryOwnMessagesAndResetsWhenChatOpens() {
        val chat = ChatUnreadTracker("me")
        chat.update(listOf(message("1", "other")), chatOpen = false)
        assertEquals(0, chat.unread, "history present on load is not unread")
        chat.update(listOf(message("1", "other"), message("2", "me"), message("3", "other")), chatOpen = false)
        assertEquals(1, chat.unread)
        assertEquals("3", chat.notification?.id)
        chat.dismiss("other-id")
        assertEquals("3", chat.notification?.id, "an expired timer for an older toast keeps the newer one")
        chat.update(listOf(message("1", "other"), message("3", "other")), chatOpen = true)
        assertEquals(0, chat.unread)
        assertNull(chat.notification)
    }

    @Test
    fun theMaterialsCardEntersClassroomAndOpensTheTextbookInsteadOfScreenSharing() = runTest {
        val transport = FakeModes().apply { phase = "mirroring" }; val opened = mutableListOf<String>(); var materials = 0
        val modes = LessonModeController(transport, backgroundScope, { throw it }, openMaterials = { materials++ }) { opened += it }
        modes.select("classroom", phase = "mirroring", ready = true, shareId = null, assistanceId = null, materials = true)
        runCurrent()
        assertEquals(listOf("set:mirroring->classroom"), transport.calls)
        assertEquals(1, materials)
        assertTrue(opened.isEmpty())

        modes.select("classroom", phase = "mirroring", ready = true, shareId = null, assistanceId = "assist", materials = true)
        assertEquals(LessonModeSetPayload("classroom", "mirroring", null, "assist"), modes.confirm)
        modes.confirmChange(ready = true)
        runCurrent()
        assertEquals(2, materials)
        modes.select("classroom", phase = "classroom", ready = true, shareId = "share", assistanceId = null, materials = true)
        assertEquals(3, materials)
        assertTrue(opened.isEmpty())
    }

    @Test
    fun aModeIsHighlightedOnlyAfterItsShareOrRequestExists() {
        val screen = Share("share", "screen", "teacher", updatedAt = "2026-11-19T07:00:00Z")
        val studentScreen = screen.copy(id = "assist-share", ownerId = "student", assistanceId = "assist")
        val request = AssistanceSession("assist", "teacher", "student", "pending", null)
        assertNull(activeLessonMode("classroom", null, null))
        assertNull(activeLessonMode("mirroring", null, null))
        assertNull(activeLessonMode("preparing", screen, request))
        assertEquals("classroom", activeLessonMode("classroom", screen, null))
        assertEquals("mirroring", activeLessonMode("mirroring", null, request))
        assertEquals("mirroring", activeLessonMode("mirroring", studentScreen, null))
    }

    private companion object {
        val lesson = Lesson("lesson", "수업", teacher = User("teacher", "teacher", "선생님", "teacher"), startsAt = "2026-11-19T07:00:00Z", status = "LIVE", code = "lesson")
        fun snapshot(phase: String) = MeetingSnapshot(lesson.id, lesson, serverTime = "2026-11-19T07:00:00Z", instruction = LessonInstruction(phase, null))
        fun message(id: String, userId: String) = ChatMessage(id = id, clientId = id, userId = userId, userName = userId, text = "hi", createdAt = "2026-11-19T07:00:00Z")
    }
}
