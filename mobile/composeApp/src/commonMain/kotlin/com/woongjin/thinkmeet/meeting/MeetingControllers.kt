package com.woongjin.thinkmeet.meeting

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.woongjin.thinkmeet.data.ChatMessage
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.data.EmptyPayload
import com.woongjin.thinkmeet.data.LessonModeSetPayload
import com.woongjin.thinkmeet.data.MeetingRealtime
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.NoteDraft
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Server side of lesson-mode changes; a seam so the mode rules are unit-testable. */
internal interface LessonModeTransport {
    suspend fun start(): MeetingSnapshot
    suspend fun setMode(change: LessonModeSetPayload): MeetingSnapshot
}

internal class RealtimeLessonModeTransport(private val realtime: MeetingRealtime) : LessonModeTransport {
    override suspend fun start() = realtime.send(ContractProtocol.Commands.LessonStart, EmptyPayload())
    override suspend fun setMode(change: LessonModeSetPayload) = realtime.send(ContractProtocol.Commands.LessonModeSet, change)
}

/**
 * Teacher lesson-mode rules (preparing → classroom/mirroring). One request at a time; a change that
 * would end an active share or assistance request needs confirmation first.
 * [open] runs after the server reports the requested mode (opens capture or the student picker).
 */
@Stable
internal class LessonModeController(
    private val transport: LessonModeTransport,
    private val scope: CoroutineScope,
    private val report: (Throwable) -> Unit,
    private val open: (mode: String) -> Unit,
) {
    var confirm by mutableStateOf<LessonModeSetPayload?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    fun select(mode: String, phase: String?, ready: Boolean, shareId: String?, assistanceId: String?) {
        if (!ready || busy) return
        when {
            phase == mode -> open(mode)
            phase == "preparing" -> update(mode, null, ready)
            phase == "classroom" || phase == "mirroring" -> {
                val change = LessonModeSetPayload(mode, phase, shareId, assistanceId)
                if (change.expectedShareId != null || change.expectedAssistanceId != null) confirm = change
                else update(mode, change, ready)
            }
        }
    }

    fun confirmChange(ready: Boolean) {
        val change = confirm ?: return
        confirm = null
        update(change.mode, change, ready)
    }

    fun dismiss() { confirm = null }

    private fun update(mode: String, change: LessonModeSetPayload?, ready: Boolean) {
        if (!ready || busy) return
        busy = true
        scope.launch {
            try {
                var updated = if (change == null) transport.start() else transport.setMode(change)
                // Starting straight into mirroring is two steps: start (classroom), then switch.
                if (change == null && mode == "mirroring" && updated.instruction?.phase == "classroom") {
                    updated = transport.setMode(LessonModeSetPayload(mode, "classroom", null, null))
                }
                if (updated.instruction?.phase == mode) open(mode)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                report(error)
            } finally { busy = false }
        }
    }
}

/** Unread chat count and the latest incoming message toast, ignoring history present on first load. */
@Stable
internal class ChatUnreadTracker(private val userId: String) {
    private var known: Set<String>? = null
    var unread by mutableIntStateOf(0)
        private set
    var notification by mutableStateOf<ChatMessage?>(null)
        private set

    fun update(messages: List<ChatMessage>?, chatOpen: Boolean) {
        val seen = known
        if (chatOpen) { unread = 0; notification = null }
        else if (seen != null) {
            val incoming = messages.orEmpty().filter { it.id !in seen && it.userId != userId }
            if (incoming.isNotEmpty()) { unread += incoming.size; notification = incoming.last() }
        }
        if (messages != null) known = seen.orEmpty() + messages.map { it.id }
    }

    fun dismiss(id: String? = notification?.id) { if (notification?.id == id) notification = null }
}

internal data class CapturePreview(val shareId: String, val page: Int, val draft: NoteDraft)

/** Saving a captured shared-screen image to class notes, bound to the current admission. */
@Stable
internal class NoteCaptureController(private val api: ThinkMeetApi, private val lessonId: String, private val scope: CoroutineScope) {
    var preview by mutableStateOf<CapturePreview?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    fun capture(shareId: String, page: Int, bytes: ByteArray) { error = null; preview = CapturePreview(shareId, page, NoteDraft(bytes)) }
    fun close() { preview = null }

    fun save(admissionId: String, onSaved: () -> Unit) {
        val current = preview ?: return
        if (busy) return
        busy = true; error = null
        scope.launch {
            try {
                api.saveNoteCapture(lessonId, current.draft.bytes, current.draft.requestId, current.shareId, current.page, admissionId)
                preview = null; onSaved()
            } catch (failure: Throwable) {
                if (failure is CancellationException) throw failure
                error = failure.message ?: "화면을 저장하지 못했어요."
            } finally { busy = false }
        }
    }
}
