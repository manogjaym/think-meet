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
data class Lesson(
    val id: String,
    val title: String,
    val description: String = "",
    val accessMode: LessonAccessMode = "INVITE_ONLY",
    val teacher: User,
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
