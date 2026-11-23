package com.woongjin.thinkmeet.platform

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.input.InputManager
import android.media.projection.MediaProjection
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Display
import android.view.Gravity
import android.view.Surface
import android.view.View
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.doOnPreDraw
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import com.woongjin.thinkmeet.design.generated.DesignTokens
import io.livekit.android.room.track.LocalVideoTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.withContext
import livekit.org.webrtc.ScreenCapturerAndroid
import livekit.org.webrtc.VideoFrame
import livekit.org.webrtc.VideoSink
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

internal const val RemotePointerTtlMillis = 1_500L

/** Owns one approved student's full-display capture and a single non-interactive OS window. */
internal class AndroidRemoteAssistanceController(
    private val context: Context,
    private val media: AndroidMediaController?,
) : RemoteAssistanceController {
    private val mutable = MutableStateFlow(RemoteAssistanceState(supported = media != null, overlayAllowed = Settings.canDrawOverlays(context)))
    override val state = mutable.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private val windows = context.getSystemService(WindowManager::class.java)
    private val displays = context.getSystemService(DisplayManager::class.java)
    private var closed = false
    private var starting = false
    private var ownsCapture = false
    private var attemptGeneration = 0L
    private var ownedTrack: LocalVideoTrack? = null
    private var version = 0
    private var pendingGeometry: AssistanceGeometry? = null
    @Volatile private var expectingFrame = false
    private var screenTrack: LocalVideoTrack? = null
    private var projection: MediaProjection? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var resizeValidation: Runnable? = null
    private var resizePending = false
    private var marker: RemotePointerView? = null
    private var markerParams: WindowManager.LayoutParams? = null
    private val markerOrigin = Point()
    internal var permissionRequest: ((CompletableDeferred<Unit>) -> Unit)? = null
    private val hideMarker = Runnable { removeMarker() }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) { if (displayId == Display.DEFAULT_DISPLAY) captureStopped("공유 화면이 연결 해제됐어요.") }
        override fun onDisplayChanged(displayId: Int) { if (displayId == Display.DEFAULT_DISPLAY && ownsCapture) prepareGeometry() }
    }
    private val frameSink = object : VideoSink {
        override fun onFrame(frame: VideoFrame) {
            if (!expectingFrame) return
            val width = frame.rotatedWidth
            val height = frame.rotatedHeight
            handler.post {
                val expected = pendingGeometry ?: return@post
                if (!ownsCapture || !expectingFrame || resizePending || width <= 0 || height <= 0) return@post
                if (abs(width.toDouble() / height - expected.width.toDouble() / expected.height) > .005) return@post
                expectingFrame = false
                mutable.value = mutable.value.copy(capturing = true, geometry = expected, error = null)
            }
        }
    }

    init {
        if (media != null) scope.launch {
            media.state.collect { value ->
                if (ownsCapture && !starting && (!value.screenSharing || !value.connected)) captureStopped(null)
            }
        }
    }

    override suspend fun ensureOverlayPermission() {
        check(!closed && mutable.value.supported) { "이 기기는 원격 화면 안내 받기를 지원하지 않아요." }
        mutable.value = mutable.value.copy(error = null, overlayAllowed = Settings.canDrawOverlays(context))
        if (mutable.value.overlayAllowed) return
        val result = CompletableDeferred<Unit>()
        permissionRequest?.invoke(result) ?: error("앱 화면에서 다른 앱 위 표시 권한을 허용해 주세요.")
        result.await()
        val allowed = Settings.canDrawOverlays(context)
        mutable.value = mutable.value.copy(overlayAllowed = allowed, error = if (allowed) null else "다른 앱 위 표시 권한이 필요해요.")
        check(allowed) { "다른 앱 위 표시 권한이 필요해요." }
    }

    override suspend fun startScreenShare(): AssistanceGeometry {
        check(!closed && !ownsCapture && ownedTrack == null && media != null) { "원격 화면 안내를 시작할 수 없어요." }
        check(Settings.canDrawOverlays(context)) { "다른 앱 위 표시 권한을 먼저 허용해 주세요." }
        ownsCapture = true
        val attempt = ++attemptGeneration
        var startedTrack: LocalVideoTrack? = null
        starting = true
        mutable.value = mutable.value.copy(overlayAllowed = true, capturing = true, geometry = null, error = null)
        try {
            startedTrack = media.setScreenShareFullDisplay()
            check(!closed && ownsCapture && attempt == attemptGeneration) { "화면 안내 요청이 취소됐어요." }
            ownedTrack = startedTrack
            screenTrack = startedTrack
            projection = (screenTrack?.capturer as? ScreenCapturerAndroid)?.mediaProjection
                ?: error("전체 화면 캡처 연결을 확인하지 못했어요.")
            val callback = object : MediaProjection.Callback() {
                override fun onStop() { handler.post { if (attempt == attemptGeneration) captureStopped(null) } }
                override fun onCapturedContentResize(width: Int, height: Int) {
                    handler.post { if (attempt == attemptGeneration) validateCapturedSize(width, height) }
                }
            }
            projectionCallback = callback
            projection?.registerCallback(callback, handler)
            displays.registerDisplayListener(displayListener, handler)
            prepareGeometry(force = true)
            screenTrack?.addRenderer(frameSink)
            starting = false
            return withTimeout(10_000) { state.first { it.geometry != null || !it.capturing }.geometry ?: error("화면 공유가 종료됐어요.") }
        } catch (error: Throwable) {
            withContext(NonCancellable) {
                // OS consent can finish after its remote request was cancelled. Release only its track.
                startedTrack?.let { track -> media.stopRemoteAssistanceCaptureNow(track); media.stopRemoteAssistanceScreenShare(track) }
                if (attempt == attemptGeneration) {
                    starting = false
                    captureStopped(null)
                    if (error !is CancellationException) mutable.value = mutable.value.copy(error = error.message ?: "전체 화면 공유를 준비하지 못했어요.")
                }
            }
            throw error
        }
    }

    private fun validateCapturedSize(width: Int, height: Int) {
        if (!ownsCapture || closed) return
        resizePending = true
        expectingFrame = false
        clearPointer()
        mutable.value = mutable.value.copy(geometry = null)
        resizeValidation?.let(handler::removeCallbacks)
        val attempt = attemptGeneration
        val validation = Runnable {
            if (!ownsCapture || closed || attempt != attemptGeneration) return@Runnable
            resizePending = false
            val physical = displayGeometry(version.coerceAtLeast(1))
            if (physical.width != width || physical.height != height)
                failCapture("원격 화면 안내는 전체 화면 공유에서만 사용할 수 있어요.")
            else prepareGeometry(force = true)
        }
        resizeValidation = validation
        // Projection and WindowMetrics callbacks can arrive on opposite sides of a rotation.
        handler.postDelayed(validation, 300)
    }

    private fun prepareGeometry(force: Boolean = false) {
        if (!ownsCapture || closed) return
        val previous = pendingGeometry ?: mutable.value.geometry
        val latest = displayGeometry(version.coerceAtLeast(1))
        if (!force && previous != null && previous.width == latest.width && previous.height == latest.height && previous.rotation == latest.rotation) return
        version++
        pendingGeometry = latest.copy(version = version)
        expectingFrame = !resizePending
        clearPointer()
        mutable.value = mutable.value.copy(geometry = null)
    }

    @Suppress("DEPRECATION")
    private fun displayGeometry(revision: Int): AssistanceGeometry {
        val bounds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) windows.maximumWindowMetrics.bounds else null
        val size = Point().also { if (bounds == null) windows.defaultDisplay.getRealSize(it) else { it.x = bounds.width(); it.y = bounds.height() } }
        val rotation = when (displays.getDisplay(Display.DEFAULT_DISPLAY)?.rotation) {
            Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0
        }
        return AssistanceGeometry(size.x.coerceAtLeast(1), size.y.coerceAtLeast(1), rotation, revision)
    }

    override fun showPointer(pointer: AssistancePointer) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { showPointer(pointer) }; return }
        val geometry = mutable.value.geometry ?: return
        if (closed || !ownsCapture || !mutable.value.capturing || pointer.geometryVersion != geometry.version ||
            !pointer.x.isFinite() || !pointer.y.isFinite() || pointer.x !in 0.0..1.0 || pointer.y !in 0.0..1.0) return
        if (!Settings.canDrawOverlays(context)) { failCapture("다른 앱 위 표시 권한이 해제됐어요."); return }
        val existing = marker
        val view = existing ?: RemotePointerView(context).also { marker = it }
        val diameter = (DesignTokens.Component.RemotePointerSize.value * context.resources.displayMetrics.density).roundToInt().coerceAtLeast(1)
        val desiredX = (pointer.x * (geometry.width - 1) - diameter / 2.0).roundToInt()
        val desiredY = (pointer.y * (geometry.height - 1) - diameter / 2.0).roundToInt()
        val params = markerParams ?: WindowManager.LayoutParams(diameter, diameter, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            alpha = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                min(.8f, context.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch) else .8f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { setFitInsetsTypes(0); layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }.also { markerParams = it }
        val x = desiredX - markerOrigin.x; val y = desiredY - markerOrigin.y
        val moved = params.x != x || params.y != y
        params.x = x; params.y = y
        try {
            if (existing == null) {
                windows.addView(view, params)
                view.doOnPreDraw {
                    if (marker !== view || !view.isAttachedToWindow) return@doOnPreDraw
                    // Measure the OS origin once after layout, never against the previous packet's position.
                    val actual = IntArray(2); view.getLocationOnScreen(actual)
                    markerOrigin.set(actual[0] - params.x, actual[1] - params.y)
                    if (markerOrigin.x != 0 || markerOrigin.y != 0) {
                        params.x -= markerOrigin.x; params.y -= markerOrigin.y
                        runCatching { windows.updateViewLayout(view, params) }
                    }
                }
            } else if (moved) windows.updateViewLayout(view, params)
            handler.removeCallbacks(hideMarker)
            handler.postDelayed(hideMarker, RemotePointerTtlMillis)
        } catch (_: RuntimeException) { failCapture("다른 앱 위에 안내 표시를 띄우지 못했어요.") }
    }

    override fun clearPointer() {
        if (Looper.myLooper() == Looper.getMainLooper()) removeMarker() else handler.post { removeMarker() }
    }

    private fun removeMarker() {
        handler.removeCallbacks(hideMarker)
        marker?.let { runCatching { windows.removeViewImmediate(it) } }
        marker = null; markerParams = null; markerOrigin.set(0, 0)
    }

    private fun detachCaptureObservers() {
        expectingFrame = false
        pendingGeometry = null
        screenTrack?.let { runCatching { it.removeRenderer(frameSink) } }; screenTrack = null
        val callback = projectionCallback
        projection?.let { if (callback != null) runCatching { it.unregisterCallback(callback) } }; projection = null; projectionCallback = null
        resizeValidation?.let(handler::removeCallbacks); resizeValidation = null; resizePending = false
        runCatching { displays.unregisterDisplayListener(displayListener) }
    }

    private fun captureStopped(error: String?) {
        if (!ownsCapture) return
        ownsCapture = false; starting = false
        detachCaptureObservers(); clearPointer()
        mutable.value = mutable.value.copy(capturing = false, geometry = null, error = error)
        val track = ownedTrack
        if (track != null) scope.launch { releaseOwnedTrack(track) }
    }

    private suspend fun releaseOwnedTrack(track: LocalVideoTrack) {
        try { withContext(NonCancellable) { runCatching { media?.stopRemoteAssistanceScreenShare(track) } } }
        finally { if (ownedTrack === track) ownedTrack = null }
    }

    private fun failCapture(message: String) {
        val track = ownedTrack
        captureStopped(message)
        if (track != null) media?.stopRemoteAssistanceCaptureNow(track)
    }

    /** Copies one frame from the student's own approved capture; the encoder runs off the capture thread. */
    override suspend fun captureScreenFrame(): ByteArray? {
        val track = screenTrack?.takeIf { ownsCapture } ?: return null
        val lock = Any()
        var accepting = true
        var received: VideoFrame? = null
        val arrived = CompletableDeferred<Unit>()
        val sink = VideoSink { frame ->
            synchronized(lock) {
                if (!accepting || received != null) return@VideoSink
                frame.retain()
                received = frame
            }
            arrived.complete(Unit)
        }
        track.addRenderer(sink)
        var frame: VideoFrame? = null
        try {
            withTimeoutOrNull(2_000) { arrived.await() }
            frame = synchronized(lock) { accepting = false; received }
        } finally {
            runCatching { track.removeRenderer(sink) }
            // Cancelled while waiting: release a frame that arrived but will not be used.
            synchronized(lock) { accepting = false; if (frame == null) received?.release() }
        }
        val captured = frame ?: return null
        return try { withContext(Dispatchers.Default) { frameJpeg(captured) } } finally { captured.release() }
    }

    override suspend fun stopScreenShare() {
        attemptGeneration++
        val track = ownedTrack
        if (track != null) media?.stopRemoteAssistanceCaptureNow(track)
        captureStopped(null)
        if (track != null) releaseOwnedTrack(track)
    }

    override fun close() {
        if (closed) return
        closed = true
        permissionRequest = null
        attemptGeneration++
        val track = ownedTrack
        if (track != null) media?.stopRemoteAssistanceCaptureNow(track)
        captureStopped(null); clearPointer()
        scope.launch { try { if (track != null) runCatching { releaseOwnedTrack(track) } } finally { scope.cancel() } }
    }
}

private class RemotePointerView(context: Context) : View(context) {
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DesignTokens.Colors.Danger.toArgb() }
    private val density = resources.displayMetrics.density
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO; setWillNotDraw(false) }
    override fun onDraw(canvas: Canvas) {
        val ring = DesignTokens.Component.RemotePointerRingWidth.value * density
        ink.style = Paint.Style.STROKE; ink.strokeWidth = ring
        canvas.drawCircle(width / 2f, height / 2f, (width - ring) / 2f, ink)
        ink.style = Paint.Style.FILL
        canvas.drawCircle(width / 2f, height / 2f, DesignTokens.Component.RemotePointerCoreSize.value * density / 2f, ink)
    }
}

@Composable
actual fun rememberRemoteAssistanceController(media: MediaController): RemoteAssistanceController {
    val context = LocalContext.current
    val controller = remember(media) { AndroidRemoteAssistanceController(context.applicationContext, media as? AndroidMediaController) }
    var pending by remember { mutableStateOf<CompletableDeferred<Unit>?>(null) }
    var permissionPip by remember { mutableStateOf<AndroidPictureInPictureController?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        AndroidSettingsVisitService.stop(context)
        permissionPip?.endTransientInteraction(); permissionPip = null
        pending?.complete(Unit); pending = null
    }
    SideEffect {
        controller.permissionRequest = { result ->
            pending?.cancel(); pending = result
            permissionPip?.endTransientInteraction()
            permissionPip = context.findMainActivity()?.pictureInPictureController
            permissionPip?.beginTransientInteraction()
            // The full-screen Settings page puts this app in the background; keep the class connection (and the
            // teacher's pending request, which is bound to it) alive until the student returns.
            AndroidSettingsVisitService.start(context)
            try { launcher.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))) }
            catch (error: RuntimeException) { AndroidSettingsVisitService.stop(context); permissionPip?.endTransientInteraction(); permissionPip = null; pending = null; result.completeExceptionally(error) }
        }
    }
    DisposableEffect(controller) { onDispose { AndroidSettingsVisitService.stop(context); permissionPip?.endTransientInteraction(); pending?.cancel(); controller.close() } }
    return controller
}

/** I420 -> NV21 -> JPEG, then applies the frame rotation so the saved image matches the screen. */
internal fun frameJpeg(frame: VideoFrame): ByteArray? {
    val i420 = frame.buffer.toI420() ?: return null
    val jpeg = try {
        val width = i420.width and 1.inv()
        val height = i420.height and 1.inv()
        if (width <= 0 || height <= 0) return null
        val nv21 = ByteArray(width * height * 3 / 2)
        val y = i420.dataY.duplicate()
        for (row in 0 until height) { y.position(row * i420.strideY); y.get(nv21, row * width, width) }
        val u = i420.dataU; val v = i420.dataV
        var offset = width * height
        for (row in 0 until height / 2) for (column in 0 until width / 2) {
            nv21[offset++] = v.get(row * i420.strideV + column)
            nv21[offset++] = u.get(row * i420.strideU + column)
        }
        val output = ByteArrayOutputStream()
        if (!YuvImage(nv21, ImageFormat.NV21, width, height, null).compressToJpeg(Rect(0, 0, width, height), 90, output)) return null
        output.toByteArray()
    } finally { i420.release() }
    if (frame.rotation % 360 == 0) return jpeg
    val decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
    val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(frame.rotation.toFloat()) }, true)
    return ByteArrayOutputStream().use { output -> if (rotated.compress(Bitmap.CompressFormat.JPEG, 90, output)) output.toByteArray() else null }
}
