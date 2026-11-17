package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.data.*
import kotlin.test.*

class RemoteAssistanceTest {
    private val teacher = User("teacher", "teacher", "선생님", "teacher")
    private val student = User("student", "student", "학생", "student")
    private val geometry = AssistanceGeometry(1080, 2400, 0, 3)
    private val lesson = Lesson("lesson", "수업", teacher = teacher, startsAt = "2026-11-17T00:00:00Z", status = "LIVE", code = "fixture")
    private val session = AssistanceSession("session", teacher.id, student.id, "active", null, "share", geometry)
    private val snapshot = MeetingSnapshot(lesson.id, lesson, share = Share("share", "screen", student.id, updatedAt = lesson.startsAt, assistanceId = session.id), serverTime = lesson.startsAt, assistance = session)
    private val pulse = AssistancePointer(lesson.id, session.id, "share", geometry.version, .25, .75, teacher.id)

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

    @Test fun stopRemainsAContractCleanupOperationAndPointerIsFeatureGated() {
        assertNull(ContractProtocol.featureForEvent(ContractProtocol.Events.Command, "assistance.stop"))
        assertEquals(ContractProtocol.FeatureIds.MeetingRemoteAssistance, ContractProtocol.featureForEvent(ContractProtocol.Events.AssistancePointer))
        assertEquals(ContractProtocol.FeatureIds.MeetingRemoteAssistance, ContractProtocol.featureForEvent(ContractProtocol.Events.Command, "assistance.start"))
    }
}
