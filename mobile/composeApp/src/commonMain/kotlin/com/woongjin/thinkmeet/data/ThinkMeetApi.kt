package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.platform.clientPlatformId
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.timeout
import io.ktor.client.plugins.cookies.cookies
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.ChannelProvider
import io.ktor.client.request.forms.formData
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.contentType
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.encodedPath
import io.ktor.http.encodeURLPathPart
import io.ktor.http.encodeURLQueryComponent
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val HttpOperationsById = ContractProtocol.HttpOperations.associateBy { it.id }
private val PathParameter = Regex("\\{([^}]+)\\}")

/** Uses the same authenticated HTTPS API as the web app; no duplicate backend. */
class ThinkMeetApi(internal val client: HttpClient, origin: String) {
    private val expiredEvents = MutableSharedFlow<String>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val authExpired = expiredEvents.asSharedFlow()
    private val platform = clientPlatformId()
    private val capabilityState = MutableStateFlow(FeatureCapabilities.baseline(platform))
    val capabilities = capabilityState.asStateFlow()
    private val capabilityLock = Mutex()

    fun supportsFeature(feature: String): Boolean = capabilityState.value.supports(feature)

    internal fun requireFeature(feature: String?) {
        if (feature != null && !supportsFeature(feature))
            throw ApiException(0, "FEATURE_UNAVAILABLE", "이 앱에서 사용할 수 없는 기능이에요.")
    }

    internal fun requireEvent(event: String, type: String? = null) {
        if (!ContractProtocol.isKnownEvent(event, type))
            throw ApiException(0, "UNSUPPORTED_EVENT", "이 앱에서 사용할 수 없는 실시간 요청이에요.")
        requireFeature(ContractProtocol.featureForEvent(event, type))
    }

    /** Optional negotiation never blocks baseline auth/classroom behavior on an older server. */
    suspend fun refreshCapabilities(): FeatureCapabilities = capabilityLock.withLock {
        if (capabilityState.value.expired()) capabilityState.value = capabilityState.value.unavailable(platform)
        val value = try {
            val response: CapabilitiesResponse = json("capabilities")
            require(response.contractRevision > 0) { "Invalid capability revision" }
            FeatureCapabilities.fromServer(response, platform, capabilityState.value.baselineDenials())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            if (error.status == 404) FeatureCapabilities.baseline(platform) else capabilityState.value.unavailable(platform)
        } catch (_: Exception) {
            capabilityState.value.unavailable(platform)
        }
        capabilityState.value = value
        value
    }
    val origin: String = URLBuilder(origin.trim()).apply {
        require(protocol == URLProtocol.HTTPS || protocol == URLProtocol.HTTP) { "HTTP 또는 HTTPS 서버 주소를 입력해 주세요." }
        require(host.isNotBlank() && user == null && password == null) { "서버 주소를 확인해 주세요." }
        encodedPath = ""
        parameters.clear()
        fragment = ""
    }.buildString().trimEnd('/')

    private fun operation(id: String): ContractHttpOperation = HttpOperationsById[id]
        ?: throw ApiException(0, "UNSUPPORTED_OPERATION", "이 앱에서 사용할 수 없는 요청이에요.")

    private fun apiPath(id: String, parameters: Map<String, String> = emptyMap()): String =
        PathParameter.replace(operation(id).path.removePrefix(ContractProtocol.ApiBasePath)) { match ->
            val value = parameters[match.groupValues[1]]
                ?: throw ApiException(0, "INVALID_PARAMETERS", "요청 정보를 확인해 주세요.")
            value.encodeURLPathPart()
        }

    private suspend fun operationResponse(id: String, parameters: Map<String, String> = emptyMap(), body: Any? = null): HttpResponse =
        response(apiPath(id, parameters), HttpMethod.parse(operation(id).method), body)

    internal suspend fun response(path: String, method: HttpMethod = HttpMethod.Get, body: Any? = null): HttpResponse {
        val route = path.substringBefore('?')
        if (!ContractProtocol.isKnownHttpOperation(method.value, route))
            throw ApiException(0, "UNSUPPORTED_OPERATION", "이 앱에서 사용할 수 없는 요청이에요.")
        requireFeature(ContractProtocol.featureForHttp(method.value, route))
        val response = try {
            client.request("$origin${ContractProtocol.ApiBasePath}$path") {
                this.method = method
                header(HttpHeaders.Origin, origin)
                header(ContractProtocol.PlatformHeader, platform)
                header(ContractProtocol.RevisionHeader, ContractProtocol.Revision.toString())
                if (body is String) contentType(ContentType.Application.Json)
                if (body != null) setBody(body)
                timeout { requestTimeoutMillis = if (body is MultiPartFormDataContent || body is ByteArrayContent) 300_000 else 30_000 }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw ApiException(0, "NETWORK_ERROR", "서버에 연결하지 못했어요. 네트워크와 서버 주소를 확인해 주세요.")
        }
        currentCoroutineContext().ensureActive()
        if (response.status.value !in 200..299) {
            val error = try { ThinkMeetJson.parseToJsonElement(response.bodyAsText()) as? JsonObject }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
            val code = (error?.get("code") as? JsonPrimitive)?.contentOrNull ?: "HTTP_${response.status.value}"
            val message = when (val value = error?.get("message")) {
                is JsonArray -> value.joinToString(" ") { it.jsonPrimitive.content }
                is JsonPrimitive -> value.contentOrNull
                else -> null
            } ?: "요청을 처리하지 못했어요. 다시 시도해 주세요."
            // Startup me401 and wrong passwords are expected unauthenticated states.
            if (response.status.value == 401 && route !in listOf(apiPath("authMe"), apiPath("authLogin"))) reportAuthExpired(message)
            throw ApiException(response.status.value, code, message)
        }
        return response
    }

    private suspend inline fun <reified T> json(id: String, parameters: Map<String, String> = emptyMap(), body: String? = null): T =
        ThinkMeetJson.decodeFromString(operationResponse(id, parameters, body).bodyAsText())

    suspend fun me(): User = json("authMe")
    suspend fun login(username: String, password: String): User =
        json("authLogin", body = ThinkMeetJson.encodeToString(LoginInput(username.trim(), password)))
    suspend fun logout() { operationResponse("authLogout") }
    suspend fun lessons(): List<Lesson> = json("listLessons")
    suspend fun students(): List<User> = json("listStudents")
    suspend fun studentAttendance(studentId: String, month: String): StudentAttendanceMonth {
        val path = apiPath("listStudentAttendance", mapOf("studentId" to studentId))
        return ThinkMeetJson.decodeFromString(response("$path?month=${month.encodeURLQueryComponent()}").bodyAsText())
    }
    suspend fun saveStudentAttendance(studentId: String, lessonId: String, input: StudentAttendanceInput): StudentAttendanceMonth = json(
        "saveStudentAttendance", mapOf("studentId" to studentId, "lessonId" to lessonId), ThinkMeetJson.encodeToString(input),
    )
    suspend fun subjects(): List<TeacherSubject> = json("listTeacherSubjects")
    suspend fun lesson(id: String): Lesson = json("getLesson", mapOf("id" to id))
    suspend fun resolve(code: String): Lesson = json("resolveLesson", mapOf("code" to code.trim()))
    suspend fun byCode(code: String): Lesson = resolve(code)
    suspend fun saveLesson(input: LessonInput, id: String? = null, clearSubject: Boolean = false): Lesson {
        val payload = ThinkMeetJson.encodeToJsonElement(input).jsonObject
        val body = if (input.subjectId != null || clearSubject) {
            requireFeature(ContractProtocol.FeatureIds.ClassroomSubjects)
            payload
        } else {
            // A missing subjectId preserves an existing subject; null clears it.
            JsonObject(payload - "subjectId")
        }
        return json(
            if (id == null) "createLesson" else "updateLesson",
            id?.let { mapOf("id" to it) } ?: emptyMap(),
            body.toString(),
        )
    }
    suspend fun cancel(id: String): Lesson = json("cancelLesson", mapOf("id" to id))
    suspend fun join(id: String): JoinResult = json("joinLesson", mapOf("id" to id))
    suspend fun prejoinStatus(id: String): PrejoinStatus = json("getPrejoinStatus", mapOf("id" to id))
    suspend fun setPrejoinWait(id: String, clientId: String, active: Boolean) {
        operationResponse(if (active) "renewPrejoinWait" else "clearPrejoinWait", mapOf("id" to id, "clientId" to clientId))
    }
    suspend fun connected(id: String): Lesson = json("connectedLesson", mapOf("id" to id))
    suspend fun leave(id: String) { operationResponse("leaveLesson", mapOf("id" to id)) }
    suspend fun end(id: String): Lesson = json("endLesson", mapOf("id" to id))
    suspend fun kick(id: String, userId: String) {
        operationResponse("kickParticipant", mapOf("id" to id), ThinkMeetJson.encodeToString(KickInput(userId)))
    }
    suspend fun invite(id: String, studentIds: List<String>): Lesson = json(
        "inviteStudents", mapOf("id" to id), ThinkMeetJson.encodeToString(InviteInput(studentIds.distinct())),
    )
    suspend fun snapshot(id: String): MeetingSnapshot = json("getSnapshot", mapOf("id" to id))
    /** With [lessonId], the server lists that lesson's subject materials plus unclassified ones. */
    suspend fun materials(lessonId: String? = null): List<Material> =
        ThinkMeetJson.decodeFromString(response(materialsPath("listMaterials", lessonId)).bodyAsText())

    private fun materialsPath(id: String, lessonId: String?): String =
        apiPath(id) + (lessonId?.let { "?lessonId=${it.encodeURLQueryComponent()}" } ?: "")

    suspend fun upload(name: String, bytes: ByteArray, contentType: String): Material =
        upload(name, bytes.size.toLong(), contentType) { ByteReadChannel(bytes) }

    /**
     * Streams files from their platform handle instead of retaining a 500MiB video in memory.
     * With [lessonId], the server stores the upload under that lesson's subject.
     */
    suspend fun upload(name: String, size: Long, contentType: String, lessonId: String? = null, openChannel: () -> ByteReadChannel): Material {
        val isPdf = name.endsWith(".pdf", ignoreCase = true)
        val isVideo = name.endsWith(".mp4", ignoreCase = true)
        if (!isPdf && !isVideo) throw ApiException(400, "UNSUPPORTED_FILE", "PDF 또는 MP4 파일을 선택해 주세요.")
        val maximum = (if (isPdf) 50L else 500L) * 1024 * 1024
        if (size < 0) throw ApiException(400, "INVALID_FILE", "파일 크기를 확인할 수 없어요.")
        if (size > maximum) throw ApiException(413, "FILE_TOO_LARGE", if (isPdf) "PDF는 50MiB까지 업로드할 수 있어요." else "MP4는 500MiB까지 업로드할 수 있어요.")
        val safeName = name.replace(Regex("[\\r\\n\\\"\\\\/]"), "_").take(240)
        val body = MultiPartFormDataContent(formData {
            append("file", ChannelProvider(size, openChannel), Headers.build {
                append(HttpHeaders.ContentType, contentType)
                append(HttpHeaders.ContentDisposition, "filename=\"$safeName\"")
            })
        })
        return ThinkMeetJson.decodeFromString(response(materialsPath("uploadMaterial", lessonId), HttpMethod.parse(operation("uploadMaterial").method), body).bodyAsText())
    }

    suspend fun deleteMaterial(id: String) { operationResponse("deleteMaterial", mapOf("id" to id)) }

    fun materialContentUrl(id: String, lessonId: String? = null): String = URLBuilder("$origin${ContractProtocol.ApiBasePath}${apiPath("getMaterialContent", mapOf("id" to id))}").apply {
        if (lessonId != null) parameters.append("lessonId", lessonId)
    }.buildString()

    suspend fun downloadMaterial(id: String, lessonId: String? = null): ByteArray {
        val path = materialContentUrl(id, lessonId).removePrefix("$origin${ContractProtocol.ApiBasePath}")
        return response(path).body()
    }

    suspend fun noteTarget(): ClassNoteTarget = json("getClassNoteTarget")
    suspend fun noteWorksheets(month: String? = null, lessonId: String? = null): List<ClassNoteWorksheet> {
        val query = month?.let { "month=${it.encodeURLQueryComponent()}" } ?: "lessonId=${checkNotNull(lessonId).encodeURLQueryComponent()}"
        return ThinkMeetJson.decodeFromString(response("${apiPath("listClassNoteWorksheets")}?$query").bodyAsText())
    }
    suspend fun noteCaptures(): List<ClassNoteCapture> = json("listClassNoteCaptures")
    suspend fun noteImage(id: String): ByteArray = operationResponse("getClassNoteImage", mapOf("id" to id)).body()

    suspend fun submitNoteWorksheet(id: String, image: ByteArray, requestId: String): ClassNoteImage =
        uploadNote("submitClassNoteWorksheet", id, image, requestId)
    suspend fun submitNoteCorrection(id: String, image: ByteArray, requestId: String): ClassNoteImage =
        uploadNote("submitClassNoteCorrection", id, image, requestId)
    suspend fun saveNoteCapture(id: String, image: ByteArray, requestId: String, shareId: String, page: Int, admissionId: String): ClassNoteImage =
        uploadNote("saveClassNoteCapture", id, image, requestId, mapOf("shareId" to shareId, "page" to page.toString(), "admissionId" to admissionId))

    private suspend fun uploadNote(operation: String, id: String, image: ByteArray, requestId: String, fields: Map<String, String> = emptyMap()): ClassNoteImage {
        val png = image.firstOrNull() == 0x89.toByte()
        val body = MultiPartFormDataContent(formData {
            append("requestId", requestId)
            fields.forEach { (key, value) -> append(key, value) }
            append("file", image, Headers.build {
                append(HttpHeaders.ContentType, if (png) "image/png" else "image/jpeg")
                append(HttpHeaders.ContentDisposition, if (png) "filename=\"image.png\"" else "filename=\"image.jpg\"")
            })
        })
        return ThinkMeetJson.decodeFromString(operationResponse(operation, mapOf("id" to id), body).bodyAsText())
    }

    suspend fun createRecording(lessonId: String, input: LessonRecordingInput): LessonRecording =
        json("createLessonRecording", mapOf("id" to lessonId), ThinkMeetJson.encodeToString(input))
    /** One lesson's recordings, or every unexpired recording of this teacher when [lessonId] is null. */
    suspend fun recordings(lessonId: String? = null): List<LessonRecording> =
        ThinkMeetJson.decodeFromString(response(apiPath("listLessonRecordings") + (lessonId?.let { "?lessonId=${it.encodeURLQueryComponent()}" } ?: "")).bodyAsText())
    /** Sends one fixed-size chunk; the server answers with the stored progress. */
    suspend fun uploadRecordingChunk(id: String, offset: Long, bytes: ByteArray): LessonRecording {
        val path = apiPath("uploadLessonRecordingChunk", mapOf("id" to id))
        val body = ByteArrayContent(bytes, ContentType.Application.OctetStream)
        return ThinkMeetJson.decodeFromString(response("$path?offset=$offset", HttpMethod.Put, body).bodyAsText())
    }
    /** Native players send the session cookie themselves; capability headers are optional for media reads. */
    fun recordingContentUrl(id: String): String = URLBuilder("$origin${ContractProtocol.ApiBasePath}${apiPath("getLessonRecordingContent", mapOf("id" to id))}").apply {
        parameters.append("platform", platform)
        parameters.append("contractRevision", ContractProtocol.Revision.toString())
    }.buildString()

    fun joinLink(lesson: Lesson): String = "$origin/join/${lesson.code.encodeURLPathPart()}"
    /** Also used by native PDF/video renderers, which do not share Ktor's cookie jar. */
    suspend fun cookieHeader(): String = client.cookies(origin).joinToString("; ") { "${it.name}=${it.value}" }
    internal fun reportAuthExpired(message: String) { expiredEvents.tryEmit(message) }
    fun realtime(scope: CoroutineScope, lessonId: String? = null): MeetingRealtime = MeetingRealtime(this, scope, lessonId).also { it.start() }
}
