// Generated from contracts/ and features/catalog.json. Do not edit.
package com.woongjin.thinkmeet.data

data class ContractHttpOperation(val id: String, val method: String, val path: String, val feature: String?)
class ContractCommand<P>(val type: String, val serializer: kotlinx.serialization.KSerializer<P>)
data class ContractFeature(val id: String, val stage: String, val requiresRevision: Int, val defaultEnabled: Boolean, val platforms: Set<String>)

object ContractProtocol {
    const val Revision = 14
    const val ApiBasePath = "/api/v1"
    const val SocketPath = "/socket.io"
    const val PlatformHeader = "X-ThinkMeet-Platform"
    const val RevisionHeader = "X-ThinkMeet-Contract-Revision"
    object Events {
        const val Subscribe = "subscribe"
        const val Command = "command"
        const val StrokePreview = "stroke.preview"
        const val Snapshot = "snapshot"
        const val LessonsChanged = "lessons:changed"
        const val RoomError = "room:error"
        const val SessionReplaced = "session:replaced"
        const val AssistancePointer = "assistance.pointer"
        const val ParticipantMedia = "participant.media"
    }
    object FeatureIds {
        const val ClassroomCore = "classroom.core"
        const val MeetingPip = "meeting.pip"
        const val MeetingRemoteAssistance = "meeting.remote-assistance"
        const val ClassroomSubjects = "classroom.subjects"
        const val ClassroomNotes = "classroom.notes"
        const val ClassroomAttendance = "classroom.attendance"
        const val ClassroomPrejoin = "classroom.prejoin"
        const val ClassroomLessonModes = "classroom.lesson-modes"
        const val ClassroomTextbookPicker = "classroom.textbook-picker"
        const val MeetingParticipantControls = "meeting.participant-controls"
        const val ClassroomRecording = "classroom.recording"
    }
    /** Server error codes from contracts/openapi.json ErrorCode; compare exact values, never substrings. */
    object ErrorCodes {
        const val Account = "ACCOUNT"
        const val AnnotationNotAllowed = "ANNOTATION_NOT_ALLOWED"
        const val AssistanceBusy = "ASSISTANCE_BUSY"
        const val AssistanceUnavailable = "ASSISTANCE_UNAVAILABLE"
        const val Cancelled = "CANCELLED"
        const val ClientUpdateRequired = "CLIENT_UPDATE_REQUIRED"
        const val Conflict = "CONFLICT"
        const val Connection = "CONNECTION"
        const val ConsentRequired = "CONSENT_REQUIRED"
        const val Ended = "ENDED"
        const val FeatureUnavailable = "FEATURE_UNAVAILABLE"
        const val FileTooLarge = "FILE_TOO_LARGE"
        const val Forbidden = "FORBIDDEN"
        const val Internal = "INTERNAL"
        const val Invalid = "INVALID"
        const val InvalidCredentials = "INVALID_CREDENTIALS"
        const val InvalidFile = "INVALID_FILE"
        const val InvalidMaterial = "INVALID_MATERIAL"
        const val InvalidSignature = "INVALID_SIGNATURE"
        const val Kicked = "KICKED"
        const val LessonModeChanged = "LESSON_MODE_CHANGED"
        const val LessonModeRequired = "LESSON_MODE_REQUIRED"
        const val LessonNotStarted = "LESSON_NOT_STARTED"
        const val Live = "LIVE"
        const val MaterialInUse = "MATERIAL_IN_USE"
        const val NoteShareChanged = "NOTE_SHARE_CHANGED"
        const val NoteTargetChanged = "NOTE_TARGET_CHANGED"
        const val NotConnected = "NOT_CONNECTED"
        const val NotFound = "NOT_FOUND"
        const val NotReady = "NOT_READY"
        const val NoShare = "NO_SHARE"
        const val ParticipantUnavailable = "PARTICIPANT_UNAVAILABLE"
        const val RateLimit = "RATE_LIMIT"
        const val RecordingOffset = "RECORDING_OFFSET"
        const val RequestFailed = "REQUEST_FAILED"
        const val ScreenNotPublished = "SCREEN_NOT_PUBLISHED"
        const val ShareBusy = "SHARE_BUSY"
        const val StaleAssistance = "STALE_ASSISTANCE"
        const val StaleGeometry = "STALE_GEOMETRY"
        const val StaleShare = "STALE_SHARE"
        const val Unauthenticated = "UNAUTHENTICATED"
        const val UnknownCommand = "UNKNOWN_COMMAND"
        const val UnsupportedCodec = "UNSUPPORTED_CODEC"
        const val UnsupportedFile = "UNSUPPORTED_FILE"
        const val UploadCancelled = "UPLOAD_CANCELLED"
        const val Validation = "VALIDATION"
        const val Waiting = "WAITING"
    }
    /** Socket commands with their generated payload serializers. */
    object Commands {
        val LessonStart = ContractCommand("lesson.start", EmptyPayload.serializer())
        val LessonModeSet = ContractCommand("lesson.mode.set", LessonModeSetPayload.serializer())
        val ChatSend = ContractCommand("chat.send", ChatSendPayload.serializer())
        val HandSet = ContractCommand("hand.set", HandSetPayload.serializer())
        val ShareStart = ContractCommand("share.start", ShareStartPayload.serializer())
        val ShareStop = ContractCommand("share.stop", EmptyPayload.serializer())
        val MediaUpdate = ContractCommand("media.update", MediaUpdatePayload.serializer())
        val DocumentPage = ContractCommand("document.page", DocumentPagePayload.serializer())
        val DocumentOpen = ContractCommand("document.open", DocumentOpenPayload.serializer())
        val StrokeAdd = ContractCommand("stroke.add", StrokeAddPayload.serializer())
        val StrokeErase = ContractCommand("stroke.erase", StrokeErasePayload.serializer())
        val AnnotationUndo = ContractCommand("annotation.undo", EmptyPayload.serializer())
        val AnnotationRedo = ContractCommand("annotation.redo", EmptyPayload.serializer())
        val AnnotationClear = ContractCommand("annotation.clear", EmptyPayload.serializer())
        val AssistanceRequest = ContractCommand("assistance.request", AssistanceRequestPayload.serializer())
        val AssistanceRespond = ContractCommand("assistance.respond", AssistanceRespondPayload.serializer())
        val AssistanceStart = ContractCommand("assistance.start", AssistanceStartPayload.serializer())
        val AssistanceGeometry = ContractCommand("assistance.geometry", AssistanceGeometryPayload.serializer())
        val AssistanceStop = ContractCommand("assistance.stop", AssistanceStopPayload.serializer())
        val ParticipantControl = ContractCommand("participant.control", ParticipantControlPayload.serializer())
    }
    val HttpOperations = listOf(
        ContractHttpOperation("health", "GET", "/api/v1/health", null),
        ContractHttpOperation("capabilities", "GET", "/api/v1/capabilities", null),
        ContractHttpOperation("authMe", "GET", "/api/v1/auth/me", null),
        ContractHttpOperation("authLogin", "POST", "/api/v1/auth/login", null),
        ContractHttpOperation("authLogout", "POST", "/api/v1/auth/logout", null),
        ContractHttpOperation("listStudents", "GET", "/api/v1/students", "classroom.core"),
        ContractHttpOperation("listStudentAttendance", "GET", "/api/v1/students/{studentId}/attendance", "classroom.attendance"),
        ContractHttpOperation("saveStudentAttendance", "PUT", "/api/v1/students/{studentId}/attendance/{lessonId}", "classroom.attendance"),
        ContractHttpOperation("listTeacherSubjects", "GET", "/api/v1/subjects", "classroom.subjects"),
        ContractHttpOperation("listLessons", "GET", "/api/v1/lessons", "classroom.core"),
        ContractHttpOperation("createLesson", "POST", "/api/v1/lessons", "classroom.core"),
        ContractHttpOperation("resolveLesson", "GET", "/api/v1/join/{code}", "classroom.core"),
        ContractHttpOperation("getLesson", "GET", "/api/v1/lessons/{id}", "classroom.core"),
        ContractHttpOperation("updateLesson", "PATCH", "/api/v1/lessons/{id}", "classroom.core"),
        ContractHttpOperation("cancelLesson", "POST", "/api/v1/lessons/{id}/cancel", "classroom.core"),
        ContractHttpOperation("connectedLesson", "POST", "/api/v1/lessons/{id}/connected", "classroom.core"),
        ContractHttpOperation("endLesson", "POST", "/api/v1/lessons/{id}/end", null),
        ContractHttpOperation("joinLesson", "POST", "/api/v1/lessons/{id}/join", "classroom.core"),
        ContractHttpOperation("leaveLesson", "POST", "/api/v1/lessons/{id}/leave", null),
        ContractHttpOperation("kickParticipant", "POST", "/api/v1/lessons/{id}/kick", "classroom.core"),
        ContractHttpOperation("inviteStudents", "POST", "/api/v1/lessons/{id}/invites", "classroom.core"),
        ContractHttpOperation("getSnapshot", "GET", "/api/v1/lessons/{id}/snapshot", "classroom.core"),
        ContractHttpOperation("listMaterials", "GET", "/api/v1/materials", "classroom.core"),
        ContractHttpOperation("uploadMaterial", "POST", "/api/v1/materials", "classroom.core"),
        ContractHttpOperation("deleteMaterial", "DELETE", "/api/v1/materials/{id}", "classroom.core"),
        ContractHttpOperation("getMaterialContent", "GET", "/api/v1/materials/{id}/content", "classroom.core"),
        ContractHttpOperation("livekitWebhook", "POST", "/api/v1/webhooks/livekit", null),
        ContractHttpOperation("getClassNoteTarget", "GET", "/api/v1/class-notes/target", "classroom.notes"),
        ContractHttpOperation("listClassNoteWorksheets", "GET", "/api/v1/class-notes/worksheets", "classroom.notes"),
        ContractHttpOperation("submitClassNoteWorksheet", "POST", "/api/v1/class-notes/lessons/{id}/worksheets", "classroom.notes"),
        ContractHttpOperation("submitClassNoteCorrection", "POST", "/api/v1/class-notes/worksheets/{id}/correction", "classroom.notes"),
        ContractHttpOperation("listClassNoteCaptures", "GET", "/api/v1/class-notes/captures", "classroom.notes"),
        ContractHttpOperation("saveClassNoteCapture", "POST", "/api/v1/class-notes/lessons/{id}/captures", "classroom.notes"),
        ContractHttpOperation("getClassNoteImage", "GET", "/api/v1/class-notes/images/{id}", "classroom.notes"),
        ContractHttpOperation("getPrejoinStatus", "GET", "/api/v1/lessons/{id}/prejoin", "classroom.prejoin"),
        ContractHttpOperation("renewPrejoinWait", "PUT", "/api/v1/lessons/{id}/waiting/{clientId}", "classroom.prejoin"),
        ContractHttpOperation("clearPrejoinWait", "DELETE", "/api/v1/lessons/{id}/waiting/{clientId}", "classroom.prejoin"),
        ContractHttpOperation("createLessonRecording", "POST", "/api/v1/lessons/{id}/recordings", "classroom.recording"),
        ContractHttpOperation("listLessonRecordings", "GET", "/api/v1/recordings", "classroom.recording"),
        ContractHttpOperation("uploadLessonRecordingChunk", "PUT", "/api/v1/recordings/{id}/content", "classroom.recording"),
        ContractHttpOperation("getLessonRecordingContent", "GET", "/api/v1/recordings/{id}/content", "classroom.recording"),
    )
    val Features = listOf(
        ContractFeature("classroom.core", "baseline", 0, true, setOf("web", "android", "ios")),
        ContractFeature("meeting.pip", "baseline", 0, true, setOf("android", "ios")),
        ContractFeature("meeting.remote-assistance", "in-progress", 4, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.subjects", "in-progress", 7, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.notes", "in-progress", 6, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.attendance", "in-progress", 8, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.prejoin", "in-progress", 9, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.lesson-modes", "in-progress", 10, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.textbook-picker", "ready", 11, true, setOf("web", "android", "ios")),
        ContractFeature("meeting.participant-controls", "in-progress", 13, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.recording", "in-progress", 14, true, setOf("web", "android", "ios")),
    )
    private val commandFeatures: Map<String, String?> = mapOf(
        "lesson.start" to "classroom.lesson-modes",
        "lesson.mode.set" to "classroom.lesson-modes",
        "chat.send" to "classroom.core",
        "hand.set" to "classroom.core",
        "share.start" to "classroom.core",
        "share.stop" to null,
        "media.update" to "classroom.core",
        "document.page" to "classroom.core",
        "document.open" to "classroom.textbook-picker",
        "stroke.add" to "classroom.core",
        "stroke.erase" to "classroom.core",
        "annotation.undo" to "classroom.core",
        "annotation.redo" to "classroom.core",
        "annotation.clear" to "classroom.core",
        "assistance.request" to "meeting.remote-assistance",
        "assistance.respond" to "meeting.remote-assistance",
        "assistance.start" to "meeting.remote-assistance",
        "assistance.geometry" to "meeting.remote-assistance",
        "assistance.stop" to null,
        "participant.control" to "meeting.participant-controls",
    )
    private val eventFeatures: Map<String, String?> = mapOf(
        "subscribe" to "classroom.core",
        "command" to null,
        "stroke.preview" to "classroom.core",
        "snapshot" to null,
        "lessons:changed" to null,
        "room:error" to null,
        "session:replaced" to null,
        "assistance.pointer" to "meeting.remote-assistance",
        "participant.media" to "meeting.participant-controls",
    )
    private fun operation(method: String, input: String): ContractHttpOperation? {
        val route = input.substringBefore('?').trimEnd('/')
        val absolute = if (route.startsWith("$ApiBasePath/")) route else ApiBasePath + "/" + route.trimStart('/')
        val parts = absolute.split('/')
        return HttpOperations.firstOrNull { op -> op.method == method.uppercase() && op.path.split('/').let { template ->
            template.size == parts.size && template.indices.all { index -> if (template[index].startsWith("{") || template[index].startsWith(":")) parts[index].isNotBlank() else template[index] == parts[index] }
        } }
    }
    fun featureForHttp(method: String, path: String): String? = operation(method, path)?.feature
    fun isKnownHttpOperation(method: String, path: String): Boolean = operation(method, path) != null
    fun featureForEvent(event: String, type: String? = null): String? = if (event == Events.Command) commandFeatures[type] else eventFeatures[event]
    fun isKnownEvent(event: String, type: String? = null): Boolean = if (event == Events.Command) commandFeatures.containsKey(type) else eventFeatures.containsKey(event)
    fun baselineFeatureIds(platform: String): Set<String> = Features.filter { it.stage == "baseline" && it.defaultEnabled && platform in it.platforms }.map { it.id }.toSet()
    fun isKnownFeature(id: String): Boolean = Features.any { it.id == id }
}
