// Generated from contracts/openapi.json. Do not edit.
@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
package com.woongjin.thinkmeet.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.json.JsonObject

typealias Role = String

typealias LessonAccessMode = String

@Serializable
data class User(
    val id: String,
    val username: String,
    val name: String,
    val role: Role,
) {
    val isTeacher: Boolean get() = role == "teacher"
}

@Serializable
data class LessonParticipant(
    val userId: String,
    val joinedAt: String,
)

@Serializable
data class Attendance(
    val userId: String,
    val joinedAt: String,
    val leftAt: String? = null,
)

@Serializable
data class TeacherSubject(
    val id: String,
    val name: String,
)

@Serializable
data class Lesson(
    val id: String,
    val title: String,
    val description: String = "",
    val accessMode: LessonAccessMode = "INVITE_ONLY",
    val teacher: User,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val subject: TeacherSubject? = null,
    val students: List<User> = emptyList(),
    val startsAt: String,
    val endsAt: String? = null,
    val status: String,
    val code: String,
    val startedAt: String? = null,
    val endedAt: String? = null,
    val participants: List<LessonParticipant> = emptyList(),
    val attendance: List<Attendance> = emptyList(),
) {
    val canJoin: Boolean get() = status == "SCHEDULED" || status == "LIVE"
    val isOpen: Boolean get() = accessMode == "OPEN"
    fun isOwner(user: User): Boolean = teacher.id == user.id
}

@Serializable
data class LessonInput(
    val title: String,
    val subjectId: String? = null,
    val description: String = "",
    val startsAt: String,
    val endsAt: String?,
    val accessMode: LessonAccessMode = "INVITE_ONLY",
    val studentIds: List<String> = emptyList(),
)

@Serializable
data class JoinResult(
    val waiting: Boolean,
    val lesson: Lesson,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val token: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val livekitUrl: String? = null,
)

@Serializable
data class Material(
    val id: String,
    val name: String,
    val type: String,
    val size: Long,
    val duration: Double? = null,
    val pages: Int? = null,
    val createdAt: String,
)

@Serializable
data class Share(
    val id: String,
    val type: String,
    val ownerId: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val materialId: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val material: Material? = null,
    val page: Int = 1,
    val playing: Boolean = false,
    val position: Double = 0.0,
    val updatedAt: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val assistanceId: String? = null,
)

@Serializable
data class Point(
    val x: Double,
    val y: Double,
)

@Serializable
data class Stroke(
    val id: String,
    val authorId: String,
    val shareId: String,
    val page: Int,
    val tool: String,
    val color: String,
    val points: List<Point>,
    val deleted: Boolean = false,
)

@Serializable
data class PreviewStroke(
    val shareId: String,
    val page: Int,
    val tool: String,
    val color: String,
    val points: List<Point>,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val authorId: String? = null,
)

@Serializable
data class StrokePreview(
    val lessonId: String,
    val shareId: String,
    val page: Int,
    val tool: String,
    val color: String,
    val points: List<Point>,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val authorId: String? = null,
)

@Serializable
data class MeetingParticipant(
    val user: User,
    val online: Boolean = false,
    val raised: Boolean = false,
)

@Serializable
data class ChatMessage(
    val id: String,
    val clientId: String,
    val userId: String,
    val userName: String,
    val text: String,
    val createdAt: String,
)

@Serializable
data class MeetingSnapshot(
    val lessonId: String,
    val lesson: Lesson,
    val participants: List<MeetingParticipant> = emptyList(),
    val messages: List<ChatMessage> = emptyList(),
    val share: Share? = null,
    val strokes: List<Stroke> = emptyList(),
    val seq: Long = 0L,
    val serverTime: String,
    val assistance: AssistanceSession? = null,
)

@Serializable
data class RealtimeError(
    val code: String = "CONNECTION",
    val message: String = "연결을 확인해 주세요.",
)

@Serializable
data class ErrorResponse(
    val code: String,
    val message: String,
)

@Serializable
data class LoginInput(
    val username: String,
    val password: String,
)

@Serializable
data class KickInput(
    val userId: String,
)

@Serializable
data class InviteInput(
    val studentIds: List<String>,
)

@Serializable
data class SubscribeInput(
    val lessonId: String,
)

@Serializable
data class CommandEnvelope(
    val lessonId: String,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val requestId: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val expectedShareId: String? = null,
)

@Serializable
data class SuccessAck(
    val ok: Boolean = true,
    val snapshot: MeetingSnapshot,
)

@Serializable
data class ErrorAck(
    val ok: Boolean = false,
    val error: RealtimeError,
)

typealias CommandAck = JsonObject

@Serializable
data class CapabilitiesResponse(
    val contractRevision: Int,
    val features: Map<String, Boolean>,
)

@Serializable
data class ChatSendPayload(
    val text: String,
    val clientId: String,
)

@Serializable
data class HandSetPayload(
    val raised: Boolean,
)

@Serializable
data class ShareStartPayload(
    val type: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val materialId: String? = null,
)

@Serializable
class EmptyPayload

@Serializable
data class MediaUpdatePayload(
    val playing: Boolean,
    val position: Double,
)

@Serializable
data class DocumentPagePayload(
    val page: Int,
)

@Serializable
data class StrokeAddPayload(
    val id: String,
    val shareId: String,
    val page: Int,
    val tool: String,
    val color: String,
    val points: List<Point>,
)

@Serializable
data class StrokeErasePayload(
    val ids: List<String>,
)

@Serializable
data class AssistanceGeometry(
    val width: Int,
    val height: Int,
    val rotation: Int,
    val version: Int,
)

@Serializable
data class AssistanceSession(
    val id: String,
    val teacherId: String,
    val studentId: String,
    val status: String,
    val expiresAt: String?,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val shareId: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val geometry: AssistanceGeometry? = null,
)

@Serializable
data class AssistancePointer(
    val lessonId: String,
    val sessionId: String,
    val shareId: String,
    val geometryVersion: Int,
    val x: Double,
    val y: Double,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val authorId: String? = null,
)

@Serializable
data class AssistanceRequestPayload(
    val studentId: String,
)

@Serializable
data class AssistanceRespondPayload(
    val sessionId: String,
    val approved: Boolean,
)

@Serializable
data class AssistanceStartPayload(
    val sessionId: String,
    val geometry: AssistanceGeometry,
)

@Serializable
data class AssistanceGeometryPayload(
    val sessionId: String,
    val geometry: AssistanceGeometry,
)

@Serializable
data class AssistanceStopPayload(
    val sessionId: String,
)

@Serializable
data class PrejoinStudent(
    val id: String,
    val name: String,
)

@Serializable
data class PrejoinStatus(
    val status: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val waitingStudents: List<PrejoinStudent>? = null,
)

typealias StudentAttendanceStatus = String

typealias StudentAttendanceReason = String

@Serializable
data class StudentAttendanceStudent(
    val id: String,
    val name: String,
)

@Serializable
data class StudentAttendanceSummary(
    val rate: Int?,
    val present: Int,
    val late: Int,
    val absent: Int,
)

@Serializable
data class StudentAttendanceRow(
    val lessonId: String,
    val lessonTitle: String,
    val startsAt: String,
    val firstJoinedAt: String?,
    val lastLeftAt: String?,
    val durationSeconds: Int,
    val status: StudentAttendanceStatus,
    val reason: StudentAttendanceReason?,
    val memo: String?,
)

@Serializable
data class StudentAttendanceMonth(
    val student: StudentAttendanceStudent,
    val month: String,
    val summary: StudentAttendanceSummary,
    val rows: List<StudentAttendanceRow>,
)

@Serializable
data class StudentAttendanceInput(
    val status: StudentAttendanceStatus,
    val reason: StudentAttendanceReason? = null,
    val memo: String? = null,
)
