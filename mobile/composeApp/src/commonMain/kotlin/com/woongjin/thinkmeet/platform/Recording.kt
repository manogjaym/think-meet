package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.StateFlow

/** Encoder targets shared by Android and iOS: small files that keep slide text readable. */
object RecordingProfile {
    /** Longest edge of the encoded video; the shorter edge is scaled to keep the screen aspect ratio. */
    const val MaxLongEdge = 1280
    const val MaxShortEdge = 720
    const val FrameRate = 15
    const val VideoBitrate = 700_000
    const val AudioSampleRate = 48_000
    const val AudioBitrate = 64_000
    const val KeyFrameSeconds = 4

    /** Multiples of 16 (accepted by every hardware H.264 encoder) that fit both edge limits, keeping the aspect ratio. */
    fun videoSize(width: Int, height: Int): Pair<Int, Int> {
        require(width > 0 && height > 0)
        val landscape = width >= height
        val long = if (landscape) width else height
        val short = if (landscape) height else width
        val scale = minOf(1.0, MaxLongEdge.toDouble() / long, MaxShortEdge.toDouble() / short)
        fun even(value: Double) = (value.toInt() / 16 * 16).coerceAtLeast(16)
        val scaledLong = even(long * scale)
        val scaledShort = even(short * scale)
        return if (landscape) scaledLong to scaledShort else scaledShort to scaledLong
    }
}

/** A finished MP4 in the app's private recordings folder; [name] is resolved against that folder on every launch. */
data class RecordedFile(
    val name: String,
    val size: Long,
    val durationMs: Long,
    val width: Int,
    val height: Int,
    val startedAtMillis: Long,
)

data class RecordingState(
    val active: Boolean = false,
    val startedAtMillis: Long = 0,
    /** The OS ended screen capture (for example a new screen share); audio continues until it is allowed again. */
    val interrupted: Boolean = false,
)

/** Implemented by platform media controllers that can record the teacher's own screen. */
interface LessonRecorder {
    val recording: StateFlow<RecordingState>
    /** Asks for the OS screen-recording consent and starts writing; throws when declined or unavailable. */
    suspend fun startRecording(onFinished: (RecordedFile?) -> Unit)
    /** Asks for consent again after [RecordingState.interrupted] and continues the same file. */
    suspend fun resumeRecording()
    /** Finalizes the file in the background; the start callback receives it. Safe to call repeatedly. */
    fun stopRecording()
}

/** Whether this device can record the app screen at all (OS version, ReplayKit availability). */
expect fun lessonRecordingSupported(): Boolean

/** Size of a stored recording, or -1 when it no longer exists. */
internal expect fun recordingFileSize(name: String): Long
internal expect suspend fun readRecordingChunk(name: String, offset: Long, length: Int): ByteArray
internal expect fun deleteRecordingFile(name: String)

/** Full-screen native player with controls; [cookie] authenticates the private content URL. */
@Composable internal expect fun RecordingPlayerDialog(url: String, cookie: String, onClose: () -> Unit)
