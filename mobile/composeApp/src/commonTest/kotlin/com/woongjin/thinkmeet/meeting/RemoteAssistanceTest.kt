package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.RemoteStroke
import kotlin.test.*

class RemoteAssistanceTest {
    private val teacher = User("teacher", "teacher", "선생님", "teacher")
    private val student = User("student", "student", "학생", "student")
    private val geometry = AssistanceGeometry(1080, 2400, 0, 3)
    private val lesson = Lesson("lesson", "수업", teacher = teacher, startsAt = "2026-11-17T00:00:00Z", status = "LIVE", code = "fixture")
    private val session = AssistanceSession("session", teacher.id, student.id, "active", null, "share", geometry)
    private val snapshot = MeetingSnapshot(lesson.id, lesson, share = Share("share", "screen", student.id, updatedAt = lesson.startsAt, assistanceId = session.id), serverTime = lesson.startsAt, assistance = session)
    private val pulse = AssistancePointer(lesson.id, session.id, "share", geometry.version, .25, .75, teacher.id)

    @Test fun dragPointerPacesLikeWebAndDropsOutsidePositions() {
        val pacer = AssistancePointerPacer()
        assertTrue(pacer.admit(1_000))
        assertFalse(pacer.admit(1_049))
        assertTrue(pacer.admit(1_050))
        assertTrue(pacer.admit(1_050 + AssistancePointerHeartbeatMs))
        assertEquals(.25 to .75, assistancePointerPosition(25f, 150f, 100, 200))
        assertNull(assistancePointerPosition(-1f, 10f, 100, 200))
        assertNull(assistancePointerPosition(10f, 201f, 100, 200))
        assertNull(assistancePointerPosition(10f, 10f, 0, 200))
    }

    @Test fun onlyTheApprovedCurrentStudentScreenCanDisplayAPulse() {
        assertTrue(acceptsAssistancePointer(pulse, snapshot, student.id, geometry))
        for (invalid in listOf(pulse.copy(authorId = "other"), pulse.copy(authorId = null), pulse.copy(sessionId = "old"),
            pulse.copy(shareId = "other"), pulse.copy(lessonId = "other"), pulse.copy(x = Double.NaN), pulse.copy(y = 1.01))) {
            assertFalse(acceptsAssistancePointer(invalid, snapshot, student.id, geometry))
        }
        assertFalse(acceptsAssistancePointer(pulse, snapshot, "another-student", geometry))
        assertFalse(acceptsAssistancePointer(pulse, snapshot.copy(assistance = session.copy(status = "approved")), student.id, geometry))
        assertFalse(acceptsAssistancePointer(pulse, snapshot.copy(share = snapshot.share!!.copy(assistanceId = null)), student.id, geometry))
        assertFalse(acceptsAssistancePointer(pulse, snapshot.copy(lesson = lesson.copy(status = "ENDED")), student.id, geometry))
    }

    @Test fun rotationAndUnsettledGeometryRejectOldCoordinatesEvenWithTheSameAspect() {
        assertFalse(acceptsAssistancePointer(pulse, snapshot, student.id, null))
        val rotated = geometry.copy(rotation = 180, version = 4)
        assertFalse(acceptsAssistancePointer(pulse, snapshot, student.id, rotated))
        val next = snapshot.copy(assistance = session.copy(geometry = rotated))
        assertFalse(acceptsAssistancePointer(pulse, next, student.id, rotated))
        assertTrue(acceptsAssistancePointer(pulse.copy(geometryVersion = 4), next, student.id, rotated))
    }

    @Test fun teacherCoordinatesWaitForTheActualPortraitOrLandscapeVideo() {
        assertTrue(assistanceAspectMatches(geometry, 1080f / 2400))
        assertFalse(assistanceAspectMatches(geometry, 16f / 9))
        assertFalse(assistanceAspectMatches(geometry, null))
        assertFalse(assistanceAspectMatches(geometry, Float.NaN))
        assertTrue(assistanceAspectMatches(geometry.copy(width = 2400, height = 1080, rotation = 90, version = 4), 2400f / 1080))
    }

    @Test fun studentOverlayDrawsOnlyTheTeacherStrokesOfTheCurrentPageForAnnotationSessions() {
        val points = listOf(Point(.1, .2), Point(.3, .4))
        val page = Stroke("s1", teacher.id, "share", 1, "pen", "#ef6461", points)
        val strokes = listOf(page, page.copy(id = "old", page = 0), page.copy(id = "gone", deleted = true),
            page.copy(id = "other-student", authorId = "other"), page.copy(id = "other-share", shareId = "other"), page.copy(id = "mine", authorId = student.id, color = "#1f2937"))
        val annotated = snapshot.copy(assistance = session.copy(annotation = true), strokes = strokes)
        val preview = StrokePreview(lesson.id, "share", 1, "highlighter", "#4386d8", points, teacher.id)
        // The teacher's and the sharing student's own strokes; never another student's.
        assertEquals(listOf(RemoteStroke("pen", "#ef6461", points), RemoteStroke("pen", "#1f2937", points), RemoteStroke("highlighter", "#4386d8", points)),
            assistanceAnnotations(annotated, student.id, geometry, listOf(preview, preview.copy(authorId = "other"), preview.copy(points = emptyList()), preview.copy(page = 2))))
        // iOS and older Android apps (annotation false or missing), other students and unsettled layouts show nothing.
        assertEquals(emptyList(), assistanceAnnotations(annotated.copy(assistance = session.copy(annotation = false)), student.id, geometry, listOf(preview)))
        assertEquals(emptyList(), assistanceAnnotations(annotated.copy(assistance = session), student.id, geometry, listOf(preview)))
        assertEquals(emptyList(), assistanceAnnotations(annotated, "another-student", geometry, listOf(preview)))
        assertEquals(emptyList(), assistanceAnnotations(annotated, student.id, null, listOf(preview)))
        assertEquals(emptyList(), assistanceAnnotations(annotated, student.id, geometry.copy(rotation = 90, version = 4), listOf(preview)))
        assertEquals(emptyList(), assistanceAnnotations(annotated.copy(lesson = lesson.copy(status = "ENDED")), student.id, geometry, listOf(preview)))
    }

    @Test fun sharingStudentDrawsOnlyInLessonModesWhileTheTeacherAllowsIt() {
        val participants = listOf(MeetingParticipant(teacher, online = true), MeetingParticipant(student, online = true, annotationAllowed = true))
        val allowed = snapshot.copy(assistance = session.copy(annotation = true), participants = participants,
            instruction = LessonInstruction("mirroring", lesson.startsAt))
        assertTrue(studentAnnotationAllowed(allowed, student.id))
        assertFalse(studentAnnotationAllowed(allowed.copy(participants = participants.map { it.copy(annotationAllowed = false) }), student.id))
        assertFalse(studentAnnotationAllowed(allowed.copy(instruction = null), student.id))
        assertFalse(studentAnnotationAllowed(allowed.copy(assistance = session.copy(annotation = false)), student.id))
        assertFalse(studentAnnotationAllowed(allowed, "other"))
        // The eraser removes only the student's own strokes near the finger.
        val mine = Stroke("mine", student.id, "share", 1, "pen", "#1f2937", listOf(Point(.1, .5), Point(.9, .5)))
        val strokes = listOf(mine, mine.copy(id = "teacher", authorId = teacher.id), mine.copy(id = "far", points = listOf(Point(.1, .9), Point(.9, .9))))
        assertEquals(listOf("mine"), studentStrokesAt(allowed.copy(strokes = strokes), allowed.share!!, student.id, Point(.5, .505), geometry))
    }

    @Test fun stopRemainsAContractCleanupOperationAndPointerIsFeatureGated() {
        assertNull(ContractProtocol.featureForEvent(ContractProtocol.Events.Command, "assistance.stop"))
        assertEquals(ContractProtocol.FeatureIds.MeetingRemoteAssistance, ContractProtocol.featureForEvent(ContractProtocol.Events.AssistancePointer))
        assertEquals(ContractProtocol.FeatureIds.MeetingRemoteAssistance, ContractProtocol.featureForEvent(ContractProtocol.Events.Command, "assistance.start"))
    }
}
