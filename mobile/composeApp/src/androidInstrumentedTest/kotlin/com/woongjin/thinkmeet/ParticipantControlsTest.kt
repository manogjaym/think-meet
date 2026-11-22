package com.woongjin.thinkmeet

import android.graphics.Bitmap
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.LessonInstruction
import com.woongjin.thinkmeet.data.MeetingParticipant
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.ParticipantControlPayload
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.design.ThinkMeetTheme
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens
import com.woongjin.thinkmeet.meeting.LocalMeetingCompact
import com.woongjin.thinkmeet.meeting.LocalMeetingViewportWidth
import com.woongjin.thinkmeet.meeting.LocalParticipantControls
import com.woongjin.thinkmeet.meeting.MeetingStageTheme
import com.woongjin.thinkmeet.meeting.ParticipantControlState
import com.woongjin.thinkmeet.meeting.ParticipantGallery
import com.woongjin.thinkmeet.meeting.SharedParticipants
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.MediaParticipant
import com.woongjin.thinkmeet.platform.MediaState
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real meeting tiles and control rows with a fake media state; no account, server or LiveKit. */
@RunWith(AndroidJUnit4::class)
class ParticipantControlsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val teacher = User("controls-teacher", "teacher1", "윤지아 선생님", "teacher")
    private val student = User("controls-student", "student1", "김민준", "student")
    private val lesson = Lesson("controls-lesson", "참여자 제어 검증", teacher = teacher, students = listOf(student), startsAt = "2026-11-22T00:00:00Z", status = "LIVE", code = "CTRL")
    private val media = FakeMedia(MediaState(connected = true, participants = listOf(
        MediaParticipant(teacher.id, teacher.name, microphone = true, local = true),
        MediaParticipant(student.id, student.name, microphone = true),
    )))
    private val allowed = mutableStateOf(false)
    private val controls = mutableListOf<ParticipantControlPayload>()
    private val ownMicrophone = mutableListOf<Boolean>()

    private fun snapshot(share: Boolean) = MeetingSnapshot(lesson.id, lesson, LessonInstruction("classroom", "2026-11-22T00:00:00Z"), listOf(
        MeetingParticipant(teacher, online = true, annotationAllowed = true),
        MeetingParticipant(student, online = true, annotationAllowed = allowed.value),
    ), share = if (share) Share("controls-share", "screen", teacher.id, updatedAt = "2026-11-22T00:00:00Z") else null, serverTime = "2026-11-22T00:00:00Z")

    private fun render(viewer: User, stage: Boolean) {
        media.state.value = media.state.value.copy(participants = media.state.value.participants.map { it.copy(local = it.identity == viewer.id) })
        compose.activity.runOnUiThread {
            compose.activity.setContent {
                ThinkMeetTheme {
                    MeetingStageTheme {
                        BoxWithConstraints(Modifier.fillMaxSize().background(DesignTokens.Colors.MeetingCanvas).safeDrawingPadding().padding(DesignTokens.Spacing.S12)) {
                            val current = snapshot(stage)
                            val mediaState = media.state.collectAsState().value
                            val state = ParticipantControlState(viewer.id, teacher.id, lessonModes = true, current.participants,
                                control = { payload -> controls += payload; payload.annotation?.let { allowed.value = it }; payload.microphone?.let { media.set(student.id, microphone = it) } },
                                setMicrophone = { ownMicrophone += it; media.set(viewer.id, microphone = it) }, setCamera = {}, report = { throw it })
                            val compact = maxWidth <= DesignTokens.Layout.MeetingCompactBreakpoint
                            CompositionLocalProvider(LocalMeetingCompact provides compact, LocalMeetingViewportWidth provides maxWidth, LocalParticipantControls provides state) {
                                if (stage) Row(Modifier.fillMaxSize()) {
                                    Column(Modifier.weight(1f)) {}
                                    SharedParticipants(current, viewer, media, mediaState, Modifier.width(if (compact) 160.dp else 200.dp).fillMaxHeight(), horizontal = false)
                                } else ParticipantGallery(current, lesson, viewer, media, mediaState, grid = true, modifier = Modifier.fillMaxSize())
                            }
                        }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun teacherControlsStudentAndOwnDevices() {
        render(teacher, stage = false)
        val studentName = student.name
        compose.onNodeWithContentDescription("$studentName ${DesignContent.ParticipantControlsLabel}").assertIsDisplayed()
        compose.onNodeWithContentDescription("윤지아 ${DesignContent.ParticipantControlsLabel}").assertIsDisplayed()
        compose.onNodeWithContentDescription("$studentName ${DesignContent.ParticipantMicOff}").assertIsEnabled().performClick()
        compose.waitUntil(5_000) { controls.isNotEmpty() }
        compose.onNodeWithContentDescription("$studentName ${DesignContent.ParticipantAnnotation}").performClick()
        compose.waitUntil(5_000) { controls.size == 2 }
        compose.runOnIdle {
            assertEquals(listOf(ParticipantControlPayload(student.id, microphone = false), ParticipantControlPayload(student.id, annotation = true)), controls)
        }
        compose.onNodeWithContentDescription("윤지아 ${DesignContent.ParticipantMicOff}").performClick()
        compose.waitUntil(5_000) { ownMicrophone.isNotEmpty() }
        compose.runOnIdle { assertEquals(listOf(false), ownMicrophone); assertEquals(2, controls.size) }
        screenshot("teacher-gallery")
        render(teacher, stage = true)
        compose.onNodeWithContentDescription("$studentName ${DesignContent.ParticipantAnnotation}").assertIsDisplayed()
        screenshot("teacher-stage")
    }

    @Test
    fun studentSeesOnlyOwnControls() {
        render(student, stage = false)
        compose.onNodeWithContentDescription("${student.name} ${DesignContent.ParticipantControlsLabel}").assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithContentDescription("윤지아 ${DesignContent.ParticipantControlsLabel}").fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodesWithContentDescription("${student.name} ${DesignContent.ParticipantAnnotation}").fetchSemanticsNodes().size)
        screenshot("student-gallery")
    }

    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?: File(instrumentation.targetContext.getExternalFilesDir(null), "participant-controls").absolutePath).apply { mkdirs() }
        val output = File(directory, "$name.png")
        instrumentation.waitForIdleSync()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { output.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } } finally { bitmap.recycle() }
        instrumentation.sendStatus(0, Bundle().apply { putString("screenshot", output.absolutePath) })
    }
}

private class FakeMedia(initial: MediaState) : MediaController {
    override val state = MutableStateFlow(initial)
    fun set(identity: String, microphone: Boolean) {
        state.value = state.value.copy(participants = state.value.participants.map { if (it.identity == identity) it.copy(microphone = microphone) else it })
    }
    override suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean) {}
    override suspend fun disconnect() {}
    override suspend fun setCamera(enabled: Boolean) {}
    override suspend fun setMicrophone(enabled: Boolean) {}
    override suspend fun flipCamera() {}
    override suspend fun setScreenShare(enabled: Boolean) {}
    override suspend fun setSpeaker(enabled: Boolean) {}
}
