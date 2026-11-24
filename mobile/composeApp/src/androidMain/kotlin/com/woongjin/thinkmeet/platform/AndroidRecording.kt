package com.woongjin.thinkmeet.platform

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.view.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import io.livekit.android.room.track.LocalAudioTrack
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import livekit.org.webrtc.AudioTrackSink
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

private fun recordingDirectory(): File = File(AndroidPlatform.context.filesDir, "recordings").apply { mkdirs() }
private fun recordingFile(name: String): File {
    require(name.matches(Regex("[A-Za-z0-9_.-]{1,120}")) && !name.startsWith(".")) { "Invalid recording name" }
    return File(recordingDirectory(), name)
}

actual fun lessonRecordingSupported(): Boolean = true
internal actual fun recordingFileSize(name: String): Long = recordingFile(name).takeIf { it.isFile }?.length() ?: -1
internal actual suspend fun readRecordingChunk(name: String, offset: Long, length: Int): ByteArray = withContext(Dispatchers.IO) {
    RandomAccessFile(recordingFile(name), "r").use { file ->
        file.seek(offset)
        ByteArray(length).also { file.readFully(it) }
    }
}
internal actual fun deleteRecordingFile(name: String) { recordingFile(name).delete() }

@Composable internal actual fun RecordingPlayerDialog(url: String, cookie: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val player = remember(url, cookie) {
        val http = DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Cookie" to cookie))
        ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build().apply {
            setMediaItem(MediaItem.fromUri(url)); prepare(); playWhenReady = true
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    Dialog(onClose, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Palette.MeetingCanvas)) {
            AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = true; setShowNextButton(false); setShowPreviousButton(false) } },
                modifier = Modifier.fillMaxSize().safeDrawingPadding())
            IconButton(onClose, Modifier.align(Alignment.TopEnd).safeDrawingPadding().padding(Space.S8).size(Space.S48)) {
                DesignIcon("close", Modifier.size(Space.S24), Palette.White, "닫기")
            }
        }
    }
}

/** Keeps screen capture allowed while recording (required for MediaProjection since Android 10/14). */
internal class AndroidRecordingService : Service() {
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "수업 화면 녹화", NotificationManager.IMPORTANCE_LOW),
        )
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle("수업 화면 녹화 중")
                .setContentText("수업이 끝나면 녹화 영상을 서버에 올려요.")
                .setOngoing(true)
                .setSilent(true)
                .build()
            ServiceCompat.startForeground(this, NOTIFICATION, notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
            ready?.complete(Unit)
        } catch (error: Exception) {
            ready?.completeExceptionally(error)
            stopSelf()
        }
        return START_NOT_STICKY
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "thinkmeet-recording"
        private const val NOTIFICATION = 7282
        private var ready: CompletableDeferred<Unit>? = null

        /** Called after consent and before getMediaProjection, as Android 14 requires. */
        suspend fun start(context: Context) {
            val started = CompletableDeferred<Unit>()
            ready = started
            try {
                ContextCompat.startForegroundService(context, Intent(context, AndroidRecordingService::class.java))
                withTimeout(5_000) { started.await() }
            } finally { if (ready === started) ready = null }
        }
        fun stop(context: Context) { context.stopService(Intent(context, AndroidRecordingService::class.java)) }
    }
}

/** Mono 48 kHz PCM from one source, bounded so a stalled consumer never grows memory. */
private class PcmRing(capacity: Int) {
    private val data = ShortArray(capacity)
    private var start = 0
    private var size = 0
    private var phase = 0.0

    /** Appends 16-bit PCM, mixing channels down and resampling linearly when needed. */
    @Synchronized fun write(pcm: ByteBuffer, channels: Int, rate: Int, frames: Int) {
        if (channels <= 0 || rate <= 0 || frames <= 0) return
        val source = pcm.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        source.position(0)
        fun sample(frame: Int): Int {
            var sum = 0
            for (channel in 0 until channels) sum += source.getShort((frame * channels + channel) * 2).toInt()
            return sum / channels
        }
        val available = minOf(frames, source.limit() / (2 * channels))
        if (available <= 0) return
        if (rate == RecordingProfile.AudioSampleRate) {
            for (frame in 0 until available) push(sample(frame).toShort())
            return
        }
        val step = rate.toDouble() / RecordingProfile.AudioSampleRate
        var position = phase
        while (position < available - 1) {
            val index = position.toInt()
            val fraction = position - index
            push((sample(index) * (1 - fraction) + sample(index + 1) * fraction).toInt().toShort())
            position += step
        }
        phase = position - available + 1
        if (phase < 0) phase = 0.0
    }

    private fun push(value: Short) {
        if (size == data.size) { start = (start + 1) % data.size; size-- }
        data[(start + size) % data.size] = value
        size++
    }

    /** Adds up to [count] samples into [target] and keeps at most [maxLatency] buffered afterwards. */
    @Synchronized fun mixInto(target: IntArray, count: Int, maxLatency: Int) {
        val taken = minOf(count, size)
        for (index in 0 until taken) target[index] += data[(start + index) % data.size].toInt()
        start = (start + taken) % data.size
        size -= taken
        if (size > maxLatency) { val drop = size - maxLatency; start = (start + drop) % data.size; size -= drop }
    }

    @Synchronized fun clear() { start = 0; size = 0; phase = 0.0 }
}

/**
 * Records this device's screen with the lesson's mixed sound into one small MP4.
 * Video comes from MediaProjection straight into a hardware H.264 encoder surface; sound is the
 * LiveKit playout (other participants) plus the teacher's own microphone, mixed to mono AAC.
 */
internal class AndroidLessonRecorder(private val context: Context) {
    private val mutable = MutableStateFlow(RecordingState())
    val state: StateFlow<RecordingState> = mutable
    @Volatile private var session: Session? = null
    private var micTrack: LocalAudioTrack? = null
    private val main = Handler(Looper.getMainLooper())

    private val micSink = AudioTrackSink { buffer, bits, rate, channels, frames, _ ->
        if (bits == 16) session?.mic?.write(buffer, channels, rate, frames)
    }

    /** From the audio device module's playout thread: everything the teacher hears. */
    fun onPlayback(samples: JavaAudioDeviceModule.AudioSamples) {
        val current = session ?: return
        if (samples.audioFormat != AudioFormat.ENCODING_PCM_16BIT) return
        val bytes = samples.data
        current.playback.write(ByteBuffer.wrap(bytes), samples.channelCount, samples.sampleRate, bytes.size / (2 * samples.channelCount.coerceAtLeast(1)))
    }

    /** Follows the published microphone track, which LiveKit may replace while reconnecting. */
    fun attachMicrophone(track: LocalAudioTrack?) {
        if (track === micTrack) return
        micTrack?.let { runCatching { it.removeSink(micSink) } }
        micTrack = track
        if (session != null) track?.let { runCatching { it.addSink(micSink) } }
    }

    suspend fun start(consent: Intent, onFinished: (RecordedFile?) -> Unit) {
        check(session == null) { "이미 화면을 녹화하고 있어요." }
        AndroidRecordingService.start(context)
        val created = try {
            withContext(Dispatchers.Default) { Session(context, consent, onFinished) }
        } catch (error: Exception) {
            AndroidRecordingService.stop(context)
            throw IllegalStateException("화면 녹화를 시작하지 못했어요. ${error.message.orEmpty()}".trim(), error)
        }
        session = created
        micTrack?.let { runCatching { it.addSink(micSink) } }
        mutable.value = RecordingState(active = true, startedAtMillis = created.startedAtMillis)
        created.begin()
    }

    suspend fun resume(consent: Intent) {
        val current = session ?: error("녹화가 이미 끝났어요.")
        AndroidRecordingService.start(context)
        withContext(Dispatchers.Default) { current.attachProjection(consent) }
        mutable.value = mutable.value.copy(interrupted = false)
    }

    fun stop() {
        val current = session ?: return
        session = null
        micTrack?.let { runCatching { it.removeSink(micSink) } }
        mutable.value = RecordingState()
        current.finish { file ->
            AndroidRecordingService.stop(context)
            main.post { current.onFinished(file) }
        }
    }

    private fun interrupted(from: Session) = main.post {
        if (session === from) mutable.value = mutable.value.copy(interrupted = true)
    }

    private inner class Session(context: Context, consent: Intent, val onFinished: (RecordedFile?) -> Unit) {
        val startedAtMillis = System.currentTimeMillis()
        private val startNs = System.nanoTime()
        val playback = PcmRing(RecordingProfile.AudioSampleRate)
        val mic = PcmRing(RecordingProfile.AudioSampleRate)
        private val name = "lesson-${UUID.randomUUID()}.mp4"
        private val file = recordingFile(name)
        private val thread = HandlerThread("ThinkMeetRecorder").apply { start() }
        private val handler = Handler(thread.looper)
        private val projections = context.getSystemService(MediaProjectionManager::class.java)
        private val density: Int
        val width: Int
        val height: Int
        private val video: MediaCodec
        private val audio: MediaCodec
        private val surface: Surface
        private val muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        private var videoTrack = -1
        private var audioTrack = -1
        private var muxing = false
        private val pendingAudio = ArrayDeque<Pair<ByteArray, MediaCodec.BufferInfo>>()
        private var projection: MediaProjection? = null
        private var display: VirtualDisplay? = null
        private var audioFrames = 0L
        private var lastVideoUs = -1L
        private var lastAudioUs = -1L
        private var videoDone = false
        private var audioDone = false
        private var finishing = false

        init {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(metrics)
            density = metrics.densityDpi
            val (w, h) = RecordingProfile.videoSize(metrics.widthPixels, metrics.heightPixels)
            width = w; height = h
            try {
                video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC).apply {
                    configure(MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
                        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                        setInteger(MediaFormat.KEY_BIT_RATE, RecordingProfile.VideoBitrate)
                        setInteger(MediaFormat.KEY_FRAME_RATE, RecordingProfile.FrameRate)
                        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, RecordingProfile.KeyFrameSeconds)
                        // A still slide produces no new frames; repeat it so players keep a steady timeline.
                        setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER, RecordingProfile.FrameRate.toFloat())
                    }, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                }
                surface = video.createInputSurface()
                audio = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
                    configure(MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RecordingProfile.AudioSampleRate, 1).apply {
                        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                        setInteger(MediaFormat.KEY_BIT_RATE, RecordingProfile.AudioBitrate)
                        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, AacFrame * 2 * 4)
                    }, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                }
                video.start(); audio.start()
                attachProjection(consent)
            } catch (error: Exception) {
                releaseAll()
                file.delete()
                throw error
            }
        }

        /** Each consent yields one projection and one virtual display (Android 14 forbids reuse). */
        fun attachProjection(consent: Intent) {
            val next = projections.getMediaProjection(Activity.RESULT_OK, consent) ?: error("화면 녹화 권한을 받지 못했어요.")
            next.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() { handler.post { if (projection === next) detachProjection(); interrupted(this@Session) } }
            }, handler)
            val previous = projection
            projection = next
            display?.release()
            display = next.createVirtualDisplay("ThinkMeetRecording", width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, handler)
            previous?.stop()
        }

        private fun detachProjection() {
            display?.release(); display = null
            projection = null
        }

        fun begin() = handler.post(::tick)

        private fun tick() {
            if (finishing) return
            feedAudio(final = false)
            drain(video, isVideo = true, endOfStream = false)
            drain(audio, isVideo = false, endOfStream = false)
            handler.postDelayed(::tick, 10)
        }

        /** Encodes mixed blocks up to "now minus a small jitter allowance" so both sources have arrived. */
        private fun feedAudio(final: Boolean) {
            val nowFrames = (System.nanoTime() - startNs) * RecordingProfile.AudioSampleRate / 1_000_000_000L
            val target = if (final) nowFrames else nowFrames - JitterFrames
            while (audioFrames + AacFrame <= target) {
                val index = audio.dequeueInputBuffer(0)
                if (index < 0) return
                val mixed = IntArray(AacFrame)
                playback.mixInto(mixed, AacFrame, MaxBufferedFrames)
                mic.mixInto(mixed, AacFrame, MaxBufferedFrames)
                val buffer = audio.getInputBuffer(index)!!.apply { clear(); order(ByteOrder.LITTLE_ENDIAN) }
                for (value in mixed) buffer.putShort(value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
                audio.queueInputBuffer(index, 0, AacFrame * 2, audioFrames * 1_000_000L / RecordingProfile.AudioSampleRate, 0)
                audioFrames += AacFrame
            }
        }

        private fun drain(codec: MediaCodec, isVideo: Boolean, endOfStream: Boolean) {
            val info = MediaCodec.BufferInfo()
            while (true) {
                val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
                when {
                    index == MediaCodec.INFO_TRY_AGAIN_LATER -> return
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (isVideo) videoTrack = muxer.addTrack(codec.outputFormat) else audioTrack = muxer.addTrack(codec.outputFormat)
                        if (!muxing && videoTrack >= 0 && audioTrack >= 0) {
                            muxer.start(); muxing = true
                            while (pendingAudio.isNotEmpty()) pendingAudio.removeFirst().let { (bytes, meta) -> muxer.writeSampleData(audioTrack, ByteBuffer.wrap(bytes), meta) }
                        }
                    }
                    index >= 0 -> {
                        val data = codec.getOutputBuffer(index)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0) write(isVideo, data, info)
                        codec.releaseOutputBuffer(index, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            if (isVideo) videoDone = true else audioDone = true
                            return
                        }
                    }
                }
            }
        }

        private fun write(isVideo: Boolean, data: ByteBuffer, info: MediaCodec.BufferInfo) {
            val meta = MediaCodec.BufferInfo()
            if (isVideo) {
                // Surface frames use the monotonic clock; express them relative to the recording start.
                val us = info.presentationTimeUs - startNs / 1000
                if (us < 0 || us <= lastVideoUs || !muxing) return
                lastVideoUs = us
                meta.set(0, info.size, us, info.flags)
                data.position(info.offset); data.limit(info.offset + info.size)
                muxer.writeSampleData(videoTrack, data, meta)
            } else {
                if (info.presentationTimeUs <= lastAudioUs) return
                lastAudioUs = info.presentationTimeUs
                meta.set(0, info.size, info.presentationTimeUs, info.flags)
                data.position(info.offset); data.limit(info.offset + info.size)
                if (muxing) muxer.writeSampleData(audioTrack, data, meta)
                else {
                    if (pendingAudio.size >= 3000) pendingAudio.removeFirst()
                    pendingAudio.addLast(ByteArray(info.size).also { data.get(it) } to meta)
                }
            }
        }

        fun finish(done: (RecordedFile?) -> Unit) = handler.post {
            finishing = true
            handler.removeCallbacksAndMessages(null)
            var result: RecordedFile? = null
            try {
                projection?.stop(); detachProjection()
                feedAudio(final = true)
                runCatching { video.signalEndOfInputStream() }
                val index = audio.dequeueInputBuffer(100_000)
                if (index >= 0) audio.queueInputBuffer(index, 0, 0, audioFrames * 1_000_000L / RecordingProfile.AudioSampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                else audioDone = true
                val deadline = System.nanoTime() + 3_000_000_000L
                while ((!videoDone || !audioDone) && System.nanoTime() < deadline) {
                    if (!videoDone) drain(video, isVideo = true, endOfStream = true)
                    if (!audioDone) drain(audio, isVideo = false, endOfStream = true)
                }
                if (muxing && lastVideoUs >= 0) {
                    muxer.stop()
                    result = RecordedFile(name, file.length(), maxOf(lastVideoUs, lastAudioUs) / 1000, width, height, startedAtMillis)
                }
            } catch (_: Exception) {
                result = null
            } finally {
                releaseAll()
                if (result == null || result.size <= 0) { file.delete(); result = null }
                thread.quitSafely()
                done(result)
            }
        }

        private fun releaseAll() {
            runCatching { display?.release() }
            runCatching { projection?.stop() }
            runCatching { video.stop() }; runCatching { video.release() }
            runCatching { audio.stop() }; runCatching { audio.release() }
            runCatching { surface.release() }
            runCatching { muxer.release() }
            playback.clear(); mic.clear()
        }
    }

    private companion object {
        const val AacFrame = 1024
        /** 120 ms for both audio sources to arrive before a block is mixed. */
        const val JitterFrames = 48_000L * 120 / 1000
        /** Keep at most 300 ms buffered per source, dropping the oldest when a source runs ahead. */
        const val MaxBufferedFrames = 48_000 * 300 / 1000
    }
}
