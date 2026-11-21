// Generated from contracts/ and features/catalog.json. Do not edit.
package com.woongjin.thinkmeet.data

data class ContractHttpOperation(val id: String, val method: String, val path: String, val feature: String?)
data class ContractFeature(val id: String, val stage: String, val requiresRevision: Int, val defaultEnabled: Boolean, val platforms: Set<String>)

object ContractProtocol {
    const val Revision = 10
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
    }
    object FeatureIds {
        const val ClassroomCore = "classroom.core"
        const val MeetingPip = "meeting.pip"
        const val MeetingRemoteAssistance = "meeting.remote-assistance"
        const val ClassroomLessonModes = "classroom.lesson-modes"
    }
    val HttpOperations = listOf(
        ContractHttpOperation("health", "GET", "/api/v1/health", null),
        ContractHttpOperation("capabilities", "GET", "/api/v1/capabilities", null),
        ContractHttpOperation("authMe", "GET", "/api/v1/auth/me", null),
        ContractHttpOperation("authLogin", "POST", "/api/v1/auth/login", null),
        ContractHttpOperation("authLogout", "POST", "/api/v1/auth/logout", null),
        ContractHttpOperation("listStudents", "GET", "/api/v1/students", "classroom.core"),
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
    )
    val Features = listOf(
        ContractFeature("classroom.core", "baseline", 0, true, setOf("web", "android", "ios")),
        ContractFeature("meeting.pip", "baseline", 0, true, setOf("android", "ios")),
        ContractFeature("meeting.remote-assistance", "in-progress", 4, true, setOf("web", "android", "ios")),
        ContractFeature("classroom.lesson-modes", "in-progress", 10, true, setOf("web", "android", "ios")),
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
