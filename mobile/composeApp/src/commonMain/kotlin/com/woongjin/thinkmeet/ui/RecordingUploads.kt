package com.woongjin.thinkmeet.ui

import com.woongjin.thinkmeet.data.ApiError
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.data.LessonRecording
import com.woongjin.thinkmeet.data.LessonRecordingInput
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.data.ThinkMeetJson
import com.woongjin.thinkmeet.platform.RecordedFile
import com.woongjin.thinkmeet.platform.deleteRecordingFile
import com.woongjin.thinkmeet.platform.readPreference
import com.woongjin.thinkmeet.platform.readRecordingChunk
import com.woongjin.thinkmeet.platform.recordingFileSize
import com.woongjin.thinkmeet.platform.writePreference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlin.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** A finished local recording waiting for upload. Stored on the device only, never sent as-is. */
@Serializable
internal data class PendingRecording(
    val requestId: String,
    val userId: String,
    val lessonId: String,
    val file: String,
    val size: Long,
    val durationMs: Long,
    val width: Int,
    val height: Int,
    val startedAt: String,
    val recordingId: String? = null,
)

/** What the end screen and lesson detail show for a recording still on this device. */
data class RecordingUpload(
    val requestId: String,
    val lessonId: String,
    val uploadedBytes: Long,
    val size: Long,
    val error: String? = null,
    val finished: Boolean = false,
) {
    val percent: Int get() = if (size <= 0) 0 else (uploadedBytes * 100 / size).toInt().coerceIn(0, 100)
}

/** File and storage access, replaceable in tests. */
internal interface RecordingUploadStore {
    fun load(): String
    fun save(value: String)
    fun size(file: String): Long
    suspend fun read(file: String, offset: Long, length: Int): ByteArray
    fun delete(file: String)
}

internal object DeviceRecordingUploadStore : RecordingUploadStore {
    private const val Key = "recordings.pending"
    override fun load() = readPreference(Key, "[]")
    override fun save(value: String) = writePreference(Key, value)
    override fun size(file: String) = recordingFileSize(file)
    override suspend fun read(file: String, offset: Long, length: Int) = readRecordingChunk(file, offset, length)
    override fun delete(file: String) = deleteRecordingFile(file)
}

/**
 * Uploads finished lesson recordings one at a time in the server's chunk size. Progress lives on the
 * server, so a restarted app resumes with the same request ID instead of starting over.
 */
class RecordingUploads internal constructor(
    private val api: ThinkMeetApi,
    private val scope: CoroutineScope,
    private val store: RecordingUploadStore,
    private val retryDelayMillis: Long = 30_000,
) {
    constructor(api: ThinkMeetApi, scope: CoroutineScope) : this(api, scope, DeviceRecordingUploadStore)

    private val serializer = ListSerializer(PendingRecording.serializer())
    private val mutable = MutableStateFlow<List<RecordingUpload>>(emptyList())
    val uploads: StateFlow<List<RecordingUpload>> = mutable.asStateFlow()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var userId: String? = null
    private var worker: Job? = null

    private fun pending(): List<PendingRecording> =
        try { ThinkMeetJson.decodeFromString(serializer, store.load()) } catch (_: Exception) { emptyList() }

    private fun persist(items: List<PendingRecording>) = store.save(ThinkMeetJson.encodeToString(serializer, items))

    private fun replace(item: PendingRecording) = persist(pending().map { if (it.requestId == item.requestId) item else it })

    private fun publish(requestId: String, change: (RecordingUpload?) -> RecordingUpload?) = mutable.update { list ->
        val current = list.firstOrNull { it.requestId == requestId }
        val next = change(current)
        when {
            next == null -> list.filterNot { it.requestId == requestId }
            current == null -> list + next
            else -> list.map { if (it.requestId == requestId) next else it }
        }
    }

    /** Starts uploading the signed-in teacher's recordings; null stops and hides them (logout). */
    fun attach(user: String?) {
        if (user == userId) { wake.trySend(Unit); return }
        worker?.cancel(); worker = null
        userId = user
        mutable.value = emptyList()
        if (user == null) return
        pending().filter { it.userId == user }.forEach { item ->
            publish(item.requestId) { RecordingUpload(item.requestId, item.lessonId, 0, item.size) }
        }
        worker = scope.launch { run(user) }
    }

    @OptIn(ExperimentalUuidApi::class)
    fun enqueue(user: String, lessonId: String, file: RecordedFile) {
        val item = PendingRecording(
            requestId = Uuid.random().toString(), userId = user, lessonId = lessonId, file = file.name, size = file.size,
            durationMs = file.durationMs, width = file.width, height = file.height,
            startedAt = Instant.fromEpochMilliseconds(file.startedAtMillis).toString(),
        )
        persist(pending() + item)
        if (user == userId) {
            publish(item.requestId) { RecordingUpload(item.requestId, lessonId, 0, item.size) }
            wake.trySend(Unit)
        }
    }

    /** Retries failed uploads now instead of waiting for the next automatic attempt. */
    fun retry() {
        mutable.update { list -> list.map { if (it.finished) it else it.copy(error = null) } }
        wake.trySend(Unit)
    }

    /** Hides a completed or abandoned row after the user has seen it. */
    fun dismiss(requestId: String) = publish(requestId) { if (it?.finished == true) null else it }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private suspend fun run(user: String) {
        var failures = 0
        while (scope.isActive) {
            val item = pending().firstOrNull { it.userId == user }
            if (item == null) { wake.receive(); continue }
            val retryLater = try {
                upload(item)
                failures = 0
                false
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                val message = error.message ?: "녹화 영상을 올리지 못했어요."
                if (error is ApiError && error.isPermanent()) {
                    abandon(item, message)
                    false
                } else {
                    publish(item.requestId) { it?.copy(error = message) }
                    true
                }
            }
            if (retryLater) {
                failures++
                val wait = (retryDelayMillis * (1L shl (failures - 1).coerceAtMost(4))).coerceAtMost(300_000)
                select<Unit> {
                    wake.onReceive { }
                    onTimeout(wait) { }
                }
            }
        }
    }

    private fun ApiError.isPermanent() = status in listOf(400, 403, 404, 409, 413) &&
        code != ContractProtocol.ErrorCodes.RecordingOffset

    private fun abandon(item: PendingRecording, message: String) {
        persist(pending().filterNot { it.requestId == item.requestId })
        store.delete(item.file)
        publish(item.requestId) { RecordingUpload(item.requestId, item.lessonId, 0, item.size, message, finished = true) }
    }

    private suspend fun upload(initial: PendingRecording) {
        if (store.size(initial.file) != initial.size) {
            abandon(initial, "기기에서 녹화 파일을 찾을 수 없어요.")
            return
        }
        var item = initial
        var recording = start(item)
        if (item.recordingId != recording.id) { item = item.copy(recordingId = recording.id); replace(item) }
        while (recording.status != "ready") {
            val offset = recording.uploadedBytes
            publish(item.requestId) { it?.copy(uploadedBytes = offset, size = recording.size, error = null) }
            val length = minOf(recording.chunkSize.toLong(), recording.size - offset).toInt()
            val bytes = store.read(item.file, offset, length)
            check(bytes.size == length) { "녹화 파일을 읽지 못했어요." }
            recording = try {
                api.uploadRecordingChunk(recording.id, offset, bytes)
            } catch (error: ApiError) {
                // Another attempt already stored more; continue from the server's offset.
                if (error.code != ContractProtocol.ErrorCodes.RecordingOffset) throw error
                start(item)
            }
        }
        persist(pending().filterNot { it.requestId == item.requestId })
        store.delete(item.file)
        publish(item.requestId) { RecordingUpload(item.requestId, item.lessonId, item.size, item.size, finished = true) }
    }

    /** Creating with the same request ID is idempotent and returns the stored progress. */
    private suspend fun start(item: PendingRecording): LessonRecording = api.createRecording(
        item.lessonId,
        LessonRecordingInput(item.requestId, item.size, item.durationMs, item.width, item.height, item.startedAt),
    )
}
