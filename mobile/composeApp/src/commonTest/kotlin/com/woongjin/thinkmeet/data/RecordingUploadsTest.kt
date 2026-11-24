package com.woongjin.thinkmeet.data

import com.woongjin.thinkmeet.platform.RecordedFile
import com.woongjin.thinkmeet.platform.RecordingProfile
import com.woongjin.thinkmeet.ui.RecordingUploadStore
import com.woongjin.thinkmeet.ui.RecordingUploads
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpTimeout
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class RecordingUploadsTest {
    private val json = headersOf("Content-Type", "application/json")

    private class MemoryStore(var files: MutableMap<String, ByteArray>) : RecordingUploadStore {
        var saved = "[]"
        override fun load() = saved
        override fun save(value: String) { saved = value }
        override fun size(file: String) = files[file]?.size?.toLong() ?: -1
        override suspend fun read(file: String, offset: Long, length: Int) = files.getValue(file).copyOfRange(offset.toInt(), offset.toInt() + length)
        override fun delete(file: String) { files.remove(file) }
    }

    private fun recording(uploaded: Long, size: Long, chunk: Int) = LessonRecording(
        "rec", "lesson", "수업", if (uploaded == size) "ready" else "uploading", size, uploaded, chunk, 60_000, 720, 1280,
        "2026-11-24T01:00:00Z", "2026-11-24T02:00:00Z", "2026-12-24T02:00:00Z",
    )

    @Test
    fun uploadsInServerChunksResumesAfterAnOffsetConflictAndDeletesTheLocalFile() = runTest {
        val size = 10L
        val chunk = 4
        var stored = 0L
        val offsets = mutableListOf<Long>()
        var conflicted = false
        val engine = MockEngine(MockEngineConfig().apply {
            dispatcher = StandardTestDispatcher(testScheduler)
            addHandler { request ->
                when {
                    request.url.encodedPath == "/api/v1/capabilities" ->
                        respond(ThinkMeetJson.encodeToString(CapabilitiesResponse(ContractProtocol.Revision, mapOf(ContractProtocol.FeatureIds.ClassroomRecording to true))), headers = json)
                    request.url.encodedPath == "/api/v1/lessons/lesson/recordings" && request.method == HttpMethod.Post ->
                        respond(ThinkMeetJson.encodeToString(recording(stored, size, chunk)), HttpStatusCode.Created, json)
                    request.url.encodedPath == "/api/v1/recordings/rec/content" && request.method == HttpMethod.Put -> {
                        val offset = request.url.parameters["offset"]!!.toLong()
                        offsets += offset
                        // Simulates a lost response: the server stored chunk 2 but the app did not hear back.
                        if (offset == 4L && !conflicted) {
                            conflicted = true
                            stored = 8
                            respond("""{"code":"RECORDING_OFFSET","message":"offset"}""", HttpStatusCode.Conflict, json)
                        } else {
                            val length = (request.body as OutgoingContent.ByteArrayContent).bytes().size
                            assertEquals(minOf(chunk.toLong(), size - offset), length.toLong())
                            stored = offset + length
                            respond(ThinkMeetJson.encodeToString(recording(stored, size, chunk)), headers = json)
                        }
                    }
                    else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
                }
            }
        })
        val api = ThinkMeetApi(HttpClient(engine) { install(HttpTimeout) }, "https://example.test")
        api.refreshCapabilities()
        val store = MemoryStore(mutableMapOf("lesson-a.mp4" to ByteArray(size.toInt()) { it.toByte() }))
        val uploads = RecordingUploads(api, backgroundScope, store, retryDelayMillis = 1_000)
        uploads.attach("teacher")
        uploads.enqueue("teacher", "lesson", RecordedFile("lesson-a.mp4", size, 60_000, 720, 1280, 1_764_000_000_000))
        runCurrent()

        assertEquals(listOf(0L, 4L, 8L), offsets)
        assertTrue(store.files.isEmpty(), "uploaded file is removed from the device")
        assertEquals("[]", store.saved)
        assertTrue(uploads.uploads.value.single().finished)
        assertEquals(100, uploads.uploads.value.single().percent)
    }

    @Test
    fun videoSizeKeepsAspectRatioWithinTheLimits() {
        assertEquals(576 to 1280, RecordingProfile.videoSize(1080, 2400))
        assertEquals(1152 to 720, RecordingProfile.videoSize(2560, 1600))
        assertEquals(640 to 480, RecordingProfile.videoSize(640, 480))
    }
}
