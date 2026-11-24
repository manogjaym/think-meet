@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.interop.UIKitView
import androidx.compose.ui.window.ComposeUIViewController
import com.woongjin.thinkmeet.App
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.ThinkMeetApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSFileManager
import platform.Foundation.NSData
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSUUID
import platform.UIKit.UIApplication
import platform.UIKit.UIApplicationDidEnterBackgroundNotification
import platform.UIKit.UIApplicationState.UIApplicationStateBackground
import platform.UIKit.UIApplicationWillEnterForegroundNotification
import platform.UIKit.UIView
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.writeFully
import platform.posix.fopen
import platform.posix.fread
import platform.posix.ferror
import platform.posix.fclose

/** Swift owns AVFoundation/LiveKit and Keychain; Kotlin owns application state and all screens. */
interface IosNativeBridge {
    fun listen(listener: (MediaState) -> Unit)
    fun connect(url: String, token: String, camera: Boolean, microphone: Boolean, completion: (String?) -> Unit)
    fun action(name: String, enabled: Boolean, completion: (String?) -> Unit)
    fun videoView(identity: String, screen: Boolean): UIView
    fun previewView(enabled: Boolean): UIView
    fun updatePreview(view: UIView, enabled: Boolean)
    fun checkPreviewMicrophone(id: String, onLevel: (Float) -> Unit, onError: (PreviewDevice) -> Unit)
    fun stopPreviewMicrophone(id: String)
    fun playPreviewTone(id: String, completion: (String?) -> Unit)
    fun stopPreviewTone(id: String)
    fun listenPictureInPicture(listener: (PictureInPictureState) -> Unit)
    fun updatePictureInPicture(enabled: Boolean, target: PipVideoTarget?)
    fun enterPictureInPicture(completion: (String?) -> Unit)
    fun closePictureInPicture()
    /** Draws the teacher's mirroring pointer (0..1 of the shared screen) inside the PiP window. */
    fun showAssistancePointer(x: Double, y: Double)
    fun clearAssistancePointer()
    fun materialView(): UIView
    fun updateMaterial(view: UIView, url: String, cookie: String, type: String, page: Int, playing: Boolean, position: Double, updatedAt: String, onAspectRatio: (Float) -> Unit)
    fun disposeMaterial(view: UIView)
    fun read(key: String, fallback: String): String
    fun write(key: String, value: String)
    fun worksheetCameraView(onReady: (String?) -> Unit): UIView
    fun captureWorksheetPhoto(view: UIView, completion: (NSData?, String?) -> Unit)
    fun disposeWorksheetCamera(view: UIView)
    fun pickNoteImage(completion: (NSData?, String?) -> Unit)
    fun isNoteFrameReady(view: UIView, page: Int): Boolean
    fun readNoteFrame(view: UIView, page: Int): NSData?
    fun pickFile(completion: (String?, String?, String?, Long) -> Unit)
    fun share(url: String)
    fun copy(text: String)
    /** ReplayKit in-app capture of this app's screen; sound comes from LiveKit taps in Swift. */
    fun recordingAvailable(): Boolean
    fun startRecording(path: String, completion: (String?) -> Unit)
    /** Completion receives a `{size,durationMs,width,height}` JSON string or an error message. */
    fun stopRecording(completion: (String?, String?) -> Unit)
    fun playRecording(url: String, cookie: String, onClose: () -> Unit)
}
object IosPlatform {
    var bridge: IosNativeBridge? = null
    internal var mediaOwner: Any? = null
    internal var pictureInPictureOwner: Any? = null
}
private fun native() = checkNotNull(IosPlatform.bridge) { "NativeBridge must be installed before MainViewController" }
fun MainViewController() = ComposeUIViewController { App() }
actual fun platformName() = "iOS"
actual fun clientPlatformId() = "ios"
actual fun createHttpClient() = HttpClient(Darwin) { configureThinkMeet() }
actual fun readPreference(key: String, fallback: String) = native().read(key, fallback)
actual fun writePreference(key: String, value: String) = native().write(key, value)
actual fun shareLink(url: String) = native().share(url)
actual fun copyText(text: String) = native().copy(text)
@Composable actual fun BackHandler(enabled: Boolean, onBack: () -> Unit) = Unit

private class IosMediaController : MediaController, PreviewAudio, LessonRecorder {
    private val mutable = MutableStateFlow(MediaState())
    private var disconnection: Deferred<Unit>? = null
    override val state: StateFlow<MediaState> = mutable
    private val recordingState = MutableStateFlow(RecordingState())
    override val recording: StateFlow<RecordingState> = recordingState
    private var recordingDone: ((RecordedFile?) -> Unit)? = null
    private var recordingName: String? = null

    override suspend fun startRecording(onFinished: (RecordedFile?) -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
        check(recordingDone == null && disconnection == null) { "화면 녹화를 시작할 수 없어요." }
        val name = "lesson-${NSUUID().UUIDString}.mp4"
        val startedAt = kotlin.time.Clock.System.now().toEpochMilliseconds()
        native().startRecording(recordingPath(name)) { error ->
            if (error == null) {
                recordingName = name
                recordingDone = onFinished
                recordingState.value = RecordingState(active = true, startedAtMillis = startedAt)
                // A meeting that closed while iOS showed its consent alert still finalizes the file.
                if (disconnection != null || !continuation.isActive) stopRecording()
                if (continuation.isActive) continuation.resume(Unit)
            } else if (continuation.isActive) continuation.resumeWithException(IllegalStateException(error))
        }
    }
    /** In-app ReplayKit capture is not ended by a broadcast screen share, so there is nothing to resume. */
    override suspend fun resumeRecording() = Unit
    override fun stopRecording() {
        val done = recordingDone ?: return
        val name = recordingName ?: return
        val startedAt = recordingState.value.startedAtMillis
        recordingDone = null; recordingName = null
        recordingState.value = RecordingState()
        native().stopRecording { result, _ ->
            val file = result?.let { json -> runCatching {
                val values = kotlinx.serialization.json.Json.parseToJsonElement(json) as kotlinx.serialization.json.JsonObject
                fun number(key: String) = (values[key] as kotlinx.serialization.json.JsonPrimitive).content.toLong()
                RecordedFile(name, number("size"), number("durationMs"), number("width").toInt(), number("height").toInt(), startedAt)
            }.getOrNull() }
            if (file == null) deleteRecordingFile(name)
            done(file)
        }
    }
    init { native().listen { mutable.value = it } }
    private suspend fun perform(name: String, enabled: Boolean = false) = suspendCancellableCoroutine<Unit> { continuation ->
        native().action(name, enabled) { error ->
            if (continuation.isActive) if (error == null) continuation.resume(Unit) else continuation.resumeWithException(IllegalStateException(error))
        }
    }
    override suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean) = suspendCancellableCoroutine<Unit> { continuation ->
        native().connect(url, token, camera, microphone) { error ->
            if (continuation.isActive) if (error == null) continuation.resume(Unit) else continuation.resumeWithException(IllegalStateException(error))
        }
        continuation.invokeOnCancellation { if (IosPlatform.mediaOwner === this) disconnectNative() }
    }
    override suspend fun disconnect() { disconnectNative().await() }

    fun disconnectNative(): Deferred<Unit> = disconnection ?: CompletableDeferred<Unit>().also { done ->
        disconnection = done
        stopRecording()
        // A disposed controller must never disconnect the next meeting's native room.
        if (IosPlatform.mediaOwner !== this) done.complete(Unit)
        else native().action("disconnect", false) { error ->
            if (error == null) done.complete(Unit)
            else done.completeExceptionally(IllegalStateException(error))
        }
    }
    override suspend fun setCamera(enabled: Boolean) = perform("camera", enabled)
    override suspend fun setMicrophone(enabled: Boolean) = perform("microphone", enabled)
    override suspend fun flipCamera() = perform("flip")
    override suspend fun setScreenShare(enabled: Boolean) = perform("screen", enabled)
    override suspend fun setSpeaker(enabled: Boolean) = perform("speaker", enabled)
    override suspend fun checkPreviewMicrophone(onLevel: (Float) -> Unit) = suspendCancellableCoroutine<Unit> { continuation ->
        val id = NSUUID().UUIDString
        native().checkPreviewMicrophone(id, { if (continuation.isActive) onLevel(it) }) { status ->
            if (continuation.isActive) continuation.resumeWithException(PreviewDeviceException(status))
        }
        continuation.invokeOnCancellation { native().stopPreviewMicrophone(id) }
    }
    override suspend fun playPreviewTone() = suspendCancellableCoroutine<Unit> { continuation ->
        val id = NSUUID().UUIDString
        native().playPreviewTone(id) { error ->
            if (continuation.isActive) if (error == null) continuation.resume(Unit)
            else continuation.resumeWithException(IllegalStateException(error))
        }
        continuation.invokeOnCancellation { native().stopPreviewTone(id) }
    }
}
@Composable actual fun rememberMediaController(): MediaController {
    val media = remember { IosMediaController().also { IosPlatform.mediaOwner = it } }
    DisposableEffect(media) { onDispose {
        // Prejoin is disposed in the same composition that creates the meeting controller.
        // Its cleanup must not tear down that controller's newly connecting native room.
        if (IosPlatform.mediaOwner === media) {
            media.disconnectNative()
            IosPlatform.mediaOwner = null
        }
    } }
    return media
}
@Composable actual fun VideoSurface(controller: MediaController, identity: String, screen: Boolean, modifier: Modifier, noteFrame: NoteFrameSource?) {
    val state by controller.state.collectAsState()
    key(identity, screen, state.participants.firstOrNull { it.identity == identity }?.let { if (screen) it.screen else it.camera }) {
        var view by remember { mutableStateOf<UIView?>(null) }
        IosNoteFrame(noteFrame, view, page = 1)
        UIKitView(factory = { native().videoView(identity, screen).also { if (noteFrame != null) view = it } }, modifier = modifier, interactive = false)
    }
}
@Composable actual fun CameraPreview(controller: MediaController, enabled: Boolean, modifier: Modifier) {
    UIKitView(factory = { native().previewView(enabled) }, modifier = modifier, update = { native().updatePreview(it, enabled) }, onRelease = { native().updatePreview(it, false) }, interactive = false)
}
@Composable actual fun rememberFilePicker(onResult: (PickedFile?) -> Unit): () -> Unit {
    val latest by rememberUpdatedState(onResult)
    return remember { { native().pickFile { name, path, mime, size ->
        val file = if (name != null && path != null && mime != null) {
            PickedFile(name, size, mime, openChannel = { fileChannel(path) }, release = { NSFileManager.defaultManager.removeItemAtPath(path, null) })
        } else null
        latest(file)
    } } }
}

private fun fileChannel(path: String): ByteReadChannel {
    val channel = ByteChannel(autoFlush = true)
    CoroutineScope(Dispatchers.Default).launch {
        val source = fopen(path, "rb")
        if (source == null) { channel.cancel(IllegalStateException("자료를 열지 못했어요.")); return@launch }
        try {
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = buffer.usePinned { fread(it.addressOf(0), 1u, buffer.size.toULong(), source).toInt() }
                if (count == 0) { check(ferror(source) == 0) { "자료를 읽지 못했어요." }; break }
                channel.writeFully(buffer, 0, count)
            }
            channel.close()
        } catch (error: Throwable) { channel.cancel(error) } finally { fclose(source) }
    }
    return channel
}
@Composable actual fun MaterialSurface(api: ThinkMeetApi, share: Share, lessonId: String, modifier: Modifier, noteFrame: NoteFrameSource?, onAspectRatio: (Float) -> Unit) {
    val id = share.materialId ?: return
    var cookie by remember(id) { mutableStateOf("") }
    LaunchedEffect(id) { cookie = api.cookieHeader() }
    val aspect by rememberUpdatedState(onAspectRatio)
    key(id) {
        var material by remember { mutableStateOf<UIView?>(null) }
        IosNoteFrame(noteFrame, material, share.page)
        UIKitView(factory = { native().materialView().also { if (noteFrame != null) material = it } }, modifier = modifier, update = { view ->
            if (cookie.isNotEmpty()) native().updateMaterial(view, api.materialContentUrl(id, lessonId), cookie, share.type, share.page, share.playing, share.position, share.updatedAt, aspect)
        }, onRelease = { native().disposeMaterial(it) }, interactive = false)
    }
}


@Composable actual fun prejoinInForeground(): Boolean {
    var foreground by remember { mutableStateOf(UIApplication.sharedApplication.applicationState != UIApplicationStateBackground) }
    DisposableEffect(Unit) {
        val center = NSNotificationCenter.defaultCenter
        val queue = NSOperationQueue.mainQueue
        val background = center.addObserverForName(UIApplicationDidEnterBackgroundNotification, null, queue) { foreground = false }
        val resume = center.addObserverForName(UIApplicationWillEnterForegroundNotification, null, queue) { foreground = true }
        onDispose { center.removeObserver(background); center.removeObserver(resume) }
    }
    return foreground
}
