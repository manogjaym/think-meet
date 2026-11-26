package com.woongjin.thinkmeet.platform

import android.Manifest
import android.app.Activity
import android.content.Context
import android.graphics.SurfaceTexture
import androidx.compose.ui.graphics.asImageBitmap
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import io.livekit.android.AudioOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.audio.MixerAudioBufferCallback
import io.livekit.android.audio.ScreenAudioCapturer
import io.livekit.android.events.DisconnectReason
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import io.livekit.android.util.LoggingLevel
import livekit.org.webrtc.VideoFrame
import livekit.org.webrtc.VideoSink
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.math.sqrt
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

internal class AndroidMediaController(private val context: Context) : MediaController, PreviewAudio, LessonRecorder {
    private val mutable = MutableStateFlow(MediaState())
    override val state: StateFlow<MediaState> = mutable
    private val recorder = AndroidLessonRecorder(context)
    override val recording: StateFlow<RecordingState> = recorder.state
    internal val room = run {
        // Verified SDK APIs: avoid per-packet WebRTC INFO logging during long classes.
        LiveKit.loggingLevel = LoggingLevel.WARN
        LiveKit.enableWebRTCLogging = false
        // The playout tap only copies samples while a screen recording is active.
        val audio = AudioOptions(javaAudioDeviceModuleCustomizer = { builder -> builder.setPlaybackSamplesReadyCallback(recorder::onPlayback) })
        LiveKit.create(context, options = RoomOptions(adaptiveStream = true, dynacast = true), overrides = LiveKitOverrides(audioOptions = audio))
    }
    internal var preview by mutableStateOf<LocalVideoTrack?>(null)
    private var previewSink: VideoSink? = null
    private val permissionLock = Mutex()
    private val cameraManager = context.getSystemService(CameraManager::class.java)
    private fun cameraPositions(): Set<CameraPosition> = cameraManager.cameraIdList.mapNotNull { id ->
        when (cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)) {
            CameraCharacteristics.LENS_FACING_FRONT -> CameraPosition.FRONT
            CameraCharacteristics.LENS_FACING_BACK -> CameraPosition.BACK
            else -> null
        }
    }.toSet()
    private fun cameraPosition() = if (readPreference("devices.cameraFacing", "front") == "back") CameraPosition.BACK else CameraPosition.FRONT
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var disconnected = false
    private var microphoneDesired = false
    private var screenAudioActive = false
    private var screenAudioCapturer: ScreenAudioCapturer? = null
    private var screenAudioTrack: LocalAudioTrack? = null
    private var restoreMicrophoneAfterReconnect = false
    private var captureGeneration = 0L
    private var screenCaptureId = 0L
    private var regularScreenTrack: LocalVideoTrack? = null
    private val videoRenderers = mutableMapOf<Pair<String, Boolean>, MutableSet<TextureViewRenderer>>()
    /** Screen ratio from rendered frames; Android screen capture announces its track as 0x0. */
    private val renderedScreenAspect = ConcurrentHashMap<String, Float>()
    var permissionRequest: ((Array<String>, CompletableDeferred<Map<String, Boolean>>) -> Unit)? = null
    var screenRequest: ((Boolean, CompletableDeferred<Intent?>) -> Unit)? = null
    init {
        scope.launch {
            room.events.collect { event ->
                if (event is RoomEvent.Disconnected) {
                    endRegularCapture()
                    restoreMicrophoneAfterReconnect = false
                    disposeScreenAudio()
                    val failure = when (event.reason) {
                        DisconnectReason.DUPLICATE_IDENTITY -> MediaFailure.Replaced
                        DisconnectReason.PARTICIPANT_REMOVED -> MediaFailure.Removed
                        else -> null
                    }
                    val message = when (failure) {
                        MediaFailure.Replaced -> "다른 기기에서 수업에 입장했어요."
                        MediaFailure.Removed -> "선생님이 참여를 종료했어요."
                        null -> event.error?.message
                    }
                    mutable.value = mutable.value.copy(error = message, failure = failure)
                }
                if (event is RoomEvent.Reconnected && restoreMicrophoneAfterReconnect) {
                    restoreMicrophoneAfterReconnect = false
                    if (!screenAudioActive) runCatching { room.localParticipant.setMicrophoneEnabled(microphoneDesired) }
                }
                refresh()
            }
        }
    }
    private suspend fun allowed(permission: String): Boolean = permissionLock.withLock {
        if (context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) return@withLock true
        val deferred = CompletableDeferred<Map<String, Boolean>>()
        permissionRequest?.invoke(arrayOf(permission), deferred) ?: return@withLock false
        deferred.await()[permission] == true
    }
    internal fun refresh() {
        recorder.attachMicrophone(room.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack)
        val people = listOf(room.localParticipant) + room.remoteParticipants.values
        fun Participant.enabled(source: Track.Source) = getTrackPublication(source)?.let { !it.muted && it.track != null } ?: false
        mutable.value = mutable.value.copy(
            connected = room.state == Room.State.CONNECTED,
            reconnecting = room.state == Room.State.RECONNECTING,
            participants = people.mapNotNull { p -> p.identity?.value?.let { id ->
                val screenPublication = p.getTrackPublication(Track.Source.SCREEN_SHARE)
                // A new share must measure its own frames instead of reusing an earlier orientation.
                if (screenPublication == null) renderedScreenAspect.remove(id)
                val announced = screenPublication?.dimensions?.takeIf { it.width > 0 && it.height > 0 }?.let { it.width.toFloat() / it.height }
                MediaParticipant(id, p.name.orEmpty(), p.enabled(Track.Source.CAMERA), if (p === room.localParticipant) microphoneDesired else p.enabled(Track.Source.MICROPHONE),
                    p.enabled(Track.Source.SCREEN_SHARE), p.isSpeaking, p === room.localParticipant,
                    screenPublication?.let { renderedScreenAspect[id] } ?: announced ?: 16f / 9f)
            } },
            camera = room.localParticipant.enabled(Track.Source.CAMERA),
            microphone = microphoneDesired,
            screenSharing = room.localParticipant.enabled(Track.Source.SCREEN_SHARE),
            screenCaptureId = screenCaptureId,
        )
    }
    override suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean) {
        stopPreview()
        val requested = buildList { if (camera) add(Manifest.permission.CAMERA); if (microphone) add(Manifest.permission.RECORD_AUDIO) }
            .filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (requested.isNotEmpty()) {
            val deferred = CompletableDeferred<Map<String, Boolean>>()
            permissionRequest?.invoke(requested.toTypedArray(), deferred)
            if (permissionRequest != null) deferred.await()
        }
        currentCoroutineContext().ensureActive()
        check(!disconnected) { "수업 연결이 종료되었어요." }
        mutable.value = mutable.value.copy(error = null, failure = null)
        microphoneDesired = false
        room.connect(url, token)
        room.localParticipant.videoTrackCaptureDefaults = room.localParticipant.videoTrackCaptureDefaults.copy(position = cameraPosition())
        // Media access denied still permits listening and participating through chat.
        runCatching { if (camera && context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) room.localParticipant.setCameraEnabled(true) }
            .onFailure { mutable.value = mutable.value.copy(error = "카메라를 시작하지 못했어요: ${it.message}") }
        runCatching { if (microphone && context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { room.localParticipant.setMicrophoneEnabled(true); microphoneDesired = true } }
            .onFailure { mutable.value = mutable.value.copy(error = "마이크를 시작하지 못했어요: ${it.message}") }
        refresh()
    }
    override suspend fun disconnect() = disconnectNow()

    /** Also used by Activity dismissal, where capture must stop synchronously. */
    internal fun disconnectNow() {
        if (disconnected) return
        disconnected = true
        recorder.stop()
        try {
            stopPreview()
            endRegularCapture()
            room.disconnect()
        } finally {
            disposeScreenAudio()
            microphoneDesired = false
            refresh()
        }
    }
    override suspend fun setCamera(enabled: Boolean) {
        if (enabled && !allowed(Manifest.permission.CAMERA)) error("설정에서 카메라 권한을 허용해 주세요.")
        room.localParticipant.setCameraEnabled(enabled); refresh()
    }
    override suspend fun setMicrophone(enabled: Boolean) {
        if (enabled && !allowed(Manifest.permission.RECORD_AUDIO)) error("설정에서 마이크 권한을 허용해 주세요.")
        if (screenAudioActive) {
            // The publication transports shared sound too; mute only the physical microphone.
            (room.lkObjects.audioDeviceModule as? JavaAudioDeviceModule)?.setAudioRecordEnabled(enabled)
        } else {
            (room.lkObjects.audioDeviceModule as? JavaAudioDeviceModule)?.setAudioRecordEnabled(enabled)
            room.localParticipant.setMicrophoneEnabled(enabled)
        }
        microphoneDesired = enabled
        refresh()
    }
    override suspend fun flipCamera() {
        val published = room.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack
        if (published != null) {
            published.switchCamera()
        } else if (preview != null && state.value.canFlipPreview) {
            val current = preview?.options?.position ?: cameraPosition()
            val next = if (current == CameraPosition.FRONT) CameraPosition.BACK else CameraPosition.FRONT
            stopPreview()
            startPreview(next)
        }
    }
    override suspend fun setScreenShare(enabled: Boolean) {
        if (enabled) startScreenShare(fullDisplay = false) else stopRegularScreenShare()
        refresh()
    }

    internal suspend fun setScreenShareFullDisplay(): LocalVideoTrack {
        check(!state.value.screenSharing) { "기존 화면 공유를 중지한 뒤 원격 화면 안내를 시작해 주세요." }
        val track = startScreenShare(fullDisplay = true)
        refresh()
        return track
    }

    private suspend fun startScreenShare(fullDisplay: Boolean): LocalVideoTrack {
        val attempt = ++captureGeneration
        val deferred = CompletableDeferred<Intent?>()
        screenRequest?.invoke(fullDisplay, deferred) ?: error("화면 공유를 시작할 수 없어요.")
        val data = deferred.await() ?: error("화면 공유가 취소되었어요.")
        currentCoroutineContext().ensureActive()
        if (disconnected || attempt != captureGeneration) throw CancellationException("Screen capture was cancelled")
        check(room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE) == null && regularScreenTrack == null) {
            "기존 화면 공유를 중지한 뒤 원격 화면 안내를 시작해 주세요."
        }
        room.localParticipant.setScreenShareEnabled(true, ScreenCaptureParams(data, onStop = { scope.launch {
            if (attempt == captureGeneration) {
                if (fullDisplay) { stopScreenAudio(); refresh() }
                else stopRegularScreenShare()
            }
        } }))
        val track = room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track as? LocalVideoTrack
            ?: error("전체 화면 공유 연결을 확인하지 못했어요.")
        if (!fullDisplay) {
            if (attempt != captureGeneration || disconnected) {
                track.stopCapture()
                room.localParticipant.setScreenShareEnabled(false)
                throw CancellationException("Screen capture was cancelled")
            }
            regularScreenTrack = track
            screenCaptureId = attempt
            refresh()
        }
        try { startScreenAudio(track, attempt) }
        catch (error: Throwable) {
            // Sound permission setup can be cancelled after this video publication has succeeded.
            if (fullDisplay) {
                stopRemoteAssistanceCaptureNow(track)
                withContext(NonCancellable) { runCatching { stopRemoteAssistanceScreenShare(track) } }
            }
            throw error
        }
        return track
    }

    private fun endRegularCapture(): LocalVideoTrack? {
        captureGeneration++
        val track = regularScreenTrack
        regularScreenTrack = null
        screenCaptureId = 0
        track?.stopCapture()
        return track
    }

    private suspend fun stopRegularScreenShare() {
        val track = endRegularCapture()
        refresh()
        if (track == null) return
        try { stopScreenAudio() }
        finally {
            if (room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track === track)
                room.localParticipant.setScreenShareEnabled(false)
            refresh()
        }
    }

    /** Remove the capture immediately even when a stopped Activity cannot await normal cleanup. */
    internal fun stopRemoteAssistanceCaptureNow(ownedTrack: LocalVideoTrack) {
        val current = room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track
        if (current === ownedTrack) runCatching { ownedTrack.stopCapture() }
    }

    internal suspend fun stopRemoteAssistanceScreenShare(ownedTrack: LocalVideoTrack) {
        if (room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track !== ownedTrack) return
        stopScreenAudio()
        // The previous capture can terminate while its sound cleanup suspends.
        if (room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track === ownedTrack)
            room.localParticipant.setScreenShareEnabled(false)
        refresh()
    }

    private suspend fun startScreenAudio(video: LocalVideoTrack, attempt: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            mutable.value = mutable.value.copy(error = "이 기기에서는 화면만 공유돼요. 화면 소리 공유는 Android 10 이상에서 지원합니다.")
            return
        }
        if (!allowed(Manifest.permission.RECORD_AUDIO)) {
            mutable.value = mutable.value.copy(error = "화면은 공유되고 있어요. 화면 소리도 전달하려면 마이크 권한을 허용해 주세요.")
            return
        }
        if (attempt != captureGeneration || room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track !== video) return
        try {
            val module = room.lkObjects.audioDeviceModule as? JavaAudioDeviceModule
                ?: error("이 기기의 오디오 장치는 화면 소리 공유를 지원하지 않습니다.")
            AndroidScreenAudioService.start(context)
            screenAudioActive = true
            // Disable physical recording before publishing if the user muted their microphone.
            module.setAudioRecordEnabled(microphoneDesired)
            room.localParticipant.setMicrophoneEnabled(true)
            if (attempt != captureGeneration || room.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track !== video) {
                stopScreenAudio()
                return
            }
            val audio = room.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.track as? LocalAudioTrack
                ?: error("화면 소리 전송을 준비하지 못했어요.")
            val capturer = ScreenAudioCapturer.createFromScreenShareTrack(video)
                ?: error("화면 소리를 캡처하지 못했어요.")
            screenAudioTrack = audio
            screenAudioCapturer = capturer
            val missed = AtomicInteger()
            val reported = AtomicBoolean()
            audio.setAudioBufferCallback(object : MixerAudioBufferCallback() {
                override fun onBufferRequest(originalBuffer: ByteBuffer, audioFormat: Int, channelCount: Int,
                    sampleRate: Int, bytesRead: Int, captureTimeNs: Long): MixerAudioBufferCallback.BufferResponse? {
                    val response = capturer.onBufferRequest(originalBuffer, audioFormat, channelCount, sampleRate, bytesRead, captureTimeNs)
                    if (response != null) missed.set(0)
                    else if (missed.incrementAndGet() >= 50 && reported.compareAndSet(false, true)) scope.launch {
                        if (screenAudioCapturer === capturer) {
                            stopScreenAudio()
                            mutable.value = mutable.value.copy(error = "기기 또는 앱의 보호 정책으로 재생 소리를 가져오지 못했어요. 화면 공유는 계속됩니다.")
                            refresh()
                        }
                    }
                    return response
                }
            })
            mutable.value = mutable.value.copy(error = "화면과 허용된 재생 소리를 공유하고 있어요. 보호된 콘텐츠의 소리는 제외돼요.")
        } catch (error: CancellationException) {
            withContext(NonCancellable) { stopScreenAudio() }
            throw error
        } catch (_: Exception) {
            stopScreenAudio()
            mutable.value = mutable.value.copy(error = "화면 소리를 시작하지 못했어요. 화면 공유는 계속됩니다. 기기의 오디오 권한을 확인해 주세요.")
        }
    }

    private suspend fun stopScreenAudio() {
        if (!screenAudioActive && screenAudioCapturer == null) { AndroidScreenAudioService.stop(context); return }
        // Stop the publication before restoring the recorder, so a muted mic never leaks audio.
        try {
            if (!microphoneDesired && room.state == Room.State.CONNECTED) room.localParticipant.setMicrophoneEnabled(false)
        } finally {
            if (room.state == Room.State.RECONNECTING) restoreMicrophoneAfterReconnect = true
            disposeScreenAudio(recordingEnabled = microphoneDesired)
        }
        if (microphoneDesired && room.state == Room.State.CONNECTED) room.localParticipant.setMicrophoneEnabled(true)
    }

    private fun disposeScreenAudio(recordingEnabled: Boolean = true) {
        screenAudioTrack?.setAudioBufferCallback(null)
        screenAudioTrack = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) screenAudioCapturer?.releaseAudioResources()
        screenAudioCapturer = null
        screenAudioActive = false
        (room.lkObjects.audioDeviceModule as? JavaAudioDeviceModule)?.setAudioRecordEnabled(recordingEnabled)
        AndroidScreenAudioService.stop(context)
    }
    private suspend fun recordingConsent(): Intent {
        val deferred = CompletableDeferred<Intent?>()
        screenRequest?.invoke(false, deferred) ?: error("화면 녹화를 시작할 수 없어요.")
        return deferred.await() ?: error("화면 녹화를 허용하지 않아 녹화 없이 수업을 진행해요.")
    }
    override suspend fun startRecording(onFinished: (RecordedFile?) -> Unit) {
        check(!disconnected) { "수업 연결이 종료되었어요." }
        val consent = recordingConsent()
        check(!disconnected) { "수업 연결이 종료되었어요." }
        recorder.start(consent, onFinished)
        refresh()
    }
    override suspend fun resumeRecording() {
        check(!state.value.screenSharing) { "화면 공유를 끝낸 뒤 녹화를 이어갈 수 있어요." }
        recorder.resume(recordingConsent())
    }
    override suspend fun splitRecording(onFinished: (RecordedFile?) -> Unit) = recorder.split(onFinished)
    override fun stopRecording() = recorder.stop()

    @Suppress("DEPRECATION")
    override suspend fun setSpeaker(enabled: Boolean) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.isSpeakerphoneOn = enabled
        mutable.value = mutable.value.copy(speaker = enabled)
    }
    internal suspend fun startPreview(position: CameraPosition = cameraPosition()) {
        if (preview != null || state.value.connected) return
        mutable.value = mutable.value.copy(previewCamera = PreviewDevice.Checking, canFlipPreview = false, error = null)
        try {
            val positions = cameraPositions()
            if (cameraManager.cameraIdList.isEmpty()) throw PreviewDeviceException(PreviewDevice.Unavailable)
            if (!allowed(Manifest.permission.CAMERA)) throw PreviewDeviceException(PreviewDevice.Permission)
            currentCoroutineContext().ensureActive()
            val selected = position.takeIf(positions::contains) ?: positions.firstOrNull()
            val options = room.localParticipant.videoTrackCaptureDefaults.copy(position = selected)
            val track = room.localParticipant.createVideoTrack(options = options)
            preview = track
            val firstFrame = AtomicBoolean()
            val sink = VideoSink {
                if (firstFrame.compareAndSet(false, true)) scope.launch {
                    if (preview === track) {
                        mutable.value = mutable.value.copy(previewCamera = PreviewDevice.Connected, canFlipPreview = positions.size > 1)
                        selected?.let { writePreference("devices.cameraFacing", if (it == CameraPosition.BACK) "back" else "front") }
                    }
                }
            }
            previewSink = sink
            track.addRenderer(sink)
            track.startCapture()
            scope.launch {
                delay(4_000)
                if (preview === track && !firstFrame.get()) {
                    stopPreview()
                    mutable.value = mutable.value.copy(previewCamera = PreviewDevice.Failed)
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            stopPreview()
            mutable.value = mutable.value.copy(previewCamera = (error as? PreviewDeviceException)?.status ?: PreviewDevice.Failed)
        }
    }
    internal fun stopPreview() {
        val track = preview ?: return
        preview = null
        previewSink?.let(track::removeRenderer)
        previewSink = null
        track.stopCapture()
        track.dispose()
    }
    @Suppress("MissingPermission")
    override suspend fun checkPreviewMicrophone(onLevel: (Float) -> Unit) {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE))
            throw PreviewDeviceException(PreviewDevice.Unavailable)
        if (!allowed(Manifest.permission.RECORD_AUDIO)) throw PreviewDeviceException(PreviewDevice.Permission)
        withContext(Dispatchers.IO) {
            val rate = 16_000
            val minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            check(minimum > 0)
            val samples = ShortArray(rate / 20)
            val record = AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, samples.size * 4))
            try {
                check(record.state == AudioRecord.STATE_INITIALIZED)
                record.startRecording()
                check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING)
                withContext(Dispatchers.Main) { onLevel(0f) }
                while (isActive) {
                    val count = record.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                    check(count >= 0)
                    if (count > 0) {
                        val sum = (0 until count).sumOf { index ->
                            val sample = samples[index] / 32768.0
                            sample * sample
                        }
                        val level = (sqrt(sum / count).toFloat() * 3.5f).coerceIn(0f, 1f)
                        withContext(Dispatchers.Main) { onLevel(level) }
                    }
                    delay(50)
                }
            } finally {
                try { if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) record.stop() }
                finally { record.release() }
            }
        }
    }
    override suspend fun playPreviewTone() {
        val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 35)
        try {
            check(tone.startTone(ToneGenerator.TONE_DTMF_5, 650))
            delay(650)
        } finally {
            tone.stopTone()
            tone.release()
        }
    }
    internal fun release() { disconnectNow(); videoRenderers.clear(); room.release(); scope.cancel() }
    /** Called from the WebRTC render thread; republishes state only when the ratio changes. */
    internal fun reportScreenFrame(identity: String, width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val ratio = width.toFloat() / height
        val previous = renderedScreenAspect.put(identity, ratio)
        if (previous == null || kotlin.math.abs(previous / ratio - 1f) > .001f) scope.launch { refresh() }
    }
    internal fun registerVideoRenderer(identity: String, screen: Boolean, renderer: TextureViewRenderer) {
        videoRenderers.getOrPut(identity to screen) { mutableSetOf() }.add(renderer)
    }
    internal fun unregisterVideoRenderer(identity: String, screen: Boolean, renderer: TextureViewRenderer) {
        val key = identity to screen
        videoRenderers[key]?.let { renderers -> if (renderers.remove(renderer) && renderers.isEmpty()) videoRenderers.remove(key) }
    }
    internal fun videoBounds(identity: String, screen: Boolean): Rect? = videoRenderers[identity to screen]
        ?.mapNotNull { renderer -> Rect().takeIf { renderer.isAttachedToWindow && renderer.getGlobalVisibleRect(it) && !it.isEmpty } }
        ?.maxByOrNull { it.width().toLong() * it.height() }
    internal fun track(identity: String, screen: Boolean): VideoTrack? {
        val participant = (listOf(room.localParticipant) + room.remoteParticipants.values).firstOrNull { it.identity?.value == identity }
        return participant?.getTrackPublication(if (screen) Track.Source.SCREEN_SHARE else Track.Source.CAMERA)?.track as? VideoTrack
    }
}

@Composable actual fun rememberMediaController(): MediaController {
    val context = LocalContext.current
    val controller = remember { AndroidMediaController(context.applicationContext) }
    var permissions by remember { mutableStateOf<CompletableDeferred<Map<String, Boolean>>?>(null) }
    var screen by remember { mutableStateOf<CompletableDeferred<Intent?>?>(null) }
    var permissionPip by remember { mutableStateOf<AndroidPictureInPictureController?>(null) }
    var screenPip by remember { mutableStateOf<AndroidPictureInPictureController?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permissionPip?.endTransientInteraction(); permissionPip = null
        permissions?.complete(it); permissions = null
    }
    val screenLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        screenPip?.endTransientInteraction(); screenPip = null
        screen?.complete(if (result.resultCode == Activity.RESULT_OK) result.data else null); screen = null
    }
    SideEffect {
        controller.permissionRequest = { requests, deferred ->
            permissions?.cancel(); permissionPip?.endTransientInteraction()
            permissions = deferred
            permissionPip = context.findMainActivity()?.pictureInPictureController
            permissionPip?.beginTransientInteraction()
            try { permissionLauncher.launch(requests) }
            catch (error: RuntimeException) { permissionPip?.endTransientInteraction(); permissionPip = null; deferred.completeExceptionally(error) }
        }
        controller.screenRequest = { fullDisplay, deferred -> screen?.cancel(); screen = deferred
            screenPip?.endTransientInteraction()
            screenPip = context.findMainActivity()?.pictureInPictureController
            screenPip?.beginTransientInteraction()
            val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            try {
                val intent = if (fullDisplay && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                    manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                else manager.createScreenCaptureIntent()
                screenLauncher.launch(intent)
            }
            catch (error: RuntimeException) { screenPip?.endTransientInteraction(); screenPip = null; deferred.completeExceptionally(error) }
        }
    }
    DisposableEffect(controller) { onDispose {
        permissionPip?.endTransientInteraction(); screenPip?.endTransientInteraction()
        permissions?.cancel(); screen?.cancel(); controller.release()
    } }
    return controller
}

private open class MeasuredTextureView(context: Context) : TextureViewRenderer(context) {
    @Volatile var onFrameSize: ((Int, Int) -> Unit)? = null
    override fun onFrame(frame: VideoFrame) {
        onFrameSize?.invoke(frame.rotatedWidth, frame.rotatedHeight)
        super.onFrame(frame)
    }
}

private class NoteTextureView(context: Context) : MeasuredTextureView(context) {
    var onFrameReady: ((Boolean) -> Unit)? = null
    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
        super.onSurfaceTextureUpdated(surface)
        onFrameReady?.invoke(true)
    }
    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        onFrameReady?.invoke(false)
        return super.onSurfaceTextureDestroyed(surface)
    }
}

@Composable private fun TrackSurface(controller: AndroidMediaController, track: VideoTrack?, mirror: Boolean, modifier: Modifier, identity: String? = null, screen: Boolean = false, noteFrame: NoteFrameSource? = null) {
    val context = LocalContext.current
    val renderer = remember(controller, noteFrame) {
        (if (noteFrame != null) NoteTextureView(context) else MeasuredTextureView(context)).also { controller.room.initVideoRenderer(it); it.setMirror(mirror) }
    }
    DisposableEffect(controller, renderer, identity, screen) {
        renderer.onFrameSize = if (screen && identity != null) ({ width, height -> controller.reportScreenFrame(identity, width, height) }) else null
        onDispose { renderer.onFrameSize = null }
    }
    if (renderer is NoteTextureView) {
        var frameReady by remember(track, renderer) { mutableStateOf(false) }
        DisposableEffect(track, renderer) {
            renderer.onFrameReady = if (track != null) ({ ready -> frameReady = ready }) else null
            onDispose { renderer.onFrameReady = null }
        }
        BindNoteFrame(noteFrame, frameReady) {
            if (!renderer.isAvailable || renderer.width <= 0 || renderer.height <= 0) null else {
                val scale = minOf(1f, NoteImageEdge.toFloat() / maxOf(renderer.width, renderer.height))
                renderer.getBitmap((renderer.width * scale).toInt().coerceAtLeast(1), (renderer.height * scale).toInt().coerceAtLeast(1))?.asImageBitmap()
            }
        }
    }
    DisposableEffect(track, renderer) { track?.addRenderer(renderer); onDispose { track?.removeRenderer(renderer) } }
    DisposableEffect(controller, renderer, identity, screen) {
        if (identity != null) controller.registerVideoRenderer(identity, screen, renderer)
        onDispose { if (identity != null) controller.unregisterVideoRenderer(identity, screen, renderer) }
    }
    DisposableEffect(renderer) { onDispose { renderer.release() } }
    AndroidView(factory = { renderer }, modifier = modifier.onGloballyPositioned {
        context.findMainActivity()?.pictureInPictureController?.onMediaChanged()
    }, update = { it.setMirror(mirror) })
}
@Composable actual fun VideoSurface(controller: MediaController, identity: String, screen: Boolean, modifier: Modifier, noteFrame: NoteFrameSource?) {
    val media = controller as AndroidMediaController
    val state by media.state.collectAsState()
    TrackSurface(media, media.track(identity, screen), state.participants.any { it.identity == identity && it.local } && !screen, modifier, identity, screen, noteFrame)
}
@Composable actual fun CameraPreview(controller: MediaController, enabled: Boolean, modifier: Modifier) {
    val media = controller as AndroidMediaController
    LaunchedEffect(enabled) { if (enabled) media.startPreview() else media.stopPreview() }
    DisposableEffect(media) { onDispose { media.stopPreview() } }
    TrackSurface(media, media.preview, true, modifier)
}


@Composable actual fun prejoinInForeground(): Boolean {
    val lifecycle = LocalContext.current.findMainActivity()?.lifecycle ?: return true
    var started by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ ->
            started = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return started
}
