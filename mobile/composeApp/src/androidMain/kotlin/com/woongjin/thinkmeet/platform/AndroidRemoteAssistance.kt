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
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.woongjin.thinkmeet.MainActivity
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
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
    // One full-display window draws both the pointer and the strokes. Two overlapping translucent windows of
    // this app would add up past the OS touch-through opacity limit and block the student's taps under the pointer.
    private var overlay: AssistanceOverlayView? = null
    private var overlayParams: WindowManager.LayoutParams? = null
    private val overlayOrigin = Point()
    private var pointerAt: android.graphics.PointF? = null
    private var annotations: List<RemoteStroke> = emptyList()
    // The sharing student's own drawing (meeting.remote-annotation): toolbar window, tool and the stroke in progress.
    private var studentMode = false
    private val studentTool = mutableStateOf<String?>("pen")
    private val studentColor = mutableStateOf(StudentAnnotationColors.first())
    private var toolbar: ComposeView? = null
    private var toolbarWindows: WindowManager? = null
    private var draft: MutableList<com.woongjin.thinkmeet.data.Point>? = null
    private var draftPreviewAt = 0L
    private val inputs = MutableSharedFlow<StudentAnnotationInput>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val studentInput = inputs.asSharedFlow()
    /** Hosts the toolbar's Compose view; set by [rememberRemoteAssistanceController]. */
    internal var toolbarHost: MainActivity? = null
    /** Raises other app overlays (the PiP action bar) above a newly added overlay window. */
    internal var raiseCompanions: (() -> Unit)? = null
    internal var permissionRequest: ((CompletableDeferred<Unit>) -> Unit)? = null
    private val hidePointer = Runnable { pointerAt = null; renderOverlay() }
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
        val next = android.graphics.PointF((pointer.x * (geometry.width - 1)).toFloat(), (pointer.y * (geometry.height - 1)).toFloat())
        val moved = pointerAt != next
        pointerAt = next
        // A repeated position only extends the expiry; it never redraws or moves the window.
        if (!renderOverlay(redraw = moved)) return
        handler.removeCallbacks(hidePointer)
        handler.postDelayed(hidePointer, RemotePointerTtlMillis)
    }

    override fun showAnnotations(strokes: List<RemoteStroke>) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { showAnnotations(strokes) }; return }
        if (annotations == strokes) return
        annotations = strokes
        renderOverlay()
    }

    override fun setStudentAnnotation(enabled: Boolean) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { setStudentAnnotation(enabled) }; return }
        if (studentMode == enabled) return
        studentMode = enabled
        draft = null
        // Each new permission starts with the pen, as on the teacher's request.
        if (enabled) studentTool.value = "pen"
        renderOverlay()
        syncToolbar()
    }

    override fun clearPointer() {
        if (Looper.myLooper() == Looper.getMainLooper()) { handler.removeCallbacks(hidePointer); pointerAt = null; renderOverlay() }
        else handler.post { clearPointer() }
    }

    /** Shows the window while a pointer or stroke is visible and removes it otherwise. False when nothing is shown. */
    private fun renderOverlay(redraw: Boolean = true): Boolean {
        val geometry = mutable.value.geometry
        if (closed || !ownsCapture || !mutable.value.capturing || geometry == null || pointerAt == null && annotations.isEmpty() && !studentMode) {
            removeOverlay(); return false
        }
        if (!Settings.canDrawOverlays(context)) { failCapture("다른 앱 위 표시 권한이 해제됐어요."); return false }
        val existing = overlay
        val view = existing ?: AssistanceOverlayView(context).also { overlay = it }
        view.pointer = pointerAt; view.strokes = annotations; view.geometry = geometry
        view.draft = draft?.let { RemoteStroke("pen", studentColor.value, it.toList()) }
        view.onTouch = ::studentTouch
        // Only an active pen or eraser takes touches; otherwise they pass through to the app underneath.
        val touchable = studentMode && studentTool.value != null
        val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        val params = overlayParams ?: WindowManager.LayoutParams(geometry.width, geometry.height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            flags, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            alpha = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                min(.8f, context.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch) else .8f
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { setFitInsetsTypes(0); layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }.also { overlayParams = it }
        // The OS adds its own bits to these params after addView, so compare only the touch bit.
        val touchChanged = (params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0) != touchable
        val resized = params.width != geometry.width || params.height != geometry.height || touchChanged
        params.width = geometry.width; params.height = geometry.height
        params.flags = if (touchable) params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
            else params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        params.x = -overlayOrigin.x; params.y = -overlayOrigin.y
        try {
            if (existing == null) {
                windows.addView(view, params)
                view.doOnPreDraw {
                    if (overlay !== view || !view.isAttachedToWindow) return@doOnPreDraw
                    // Measure the OS origin once after layout so the window covers the display from its top-left corner.
                    val actual = IntArray(2); view.getLocationOnScreen(actual)
                    overlayOrigin.set(actual[0] - params.x, actual[1] - params.y)
                    if (overlayOrigin.x != 0 || overlayOrigin.y != 0) {
                        params.x = -overlayOrigin.x; params.y = -overlayOrigin.y
                        runCatching { windows.updateViewLayout(view, params) }
                    }
                }
                // A touchable overlay added later would cover the toolbar and action bar, so raise them again.
                if (studentMode) { raiseToolbar(); raiseCompanions?.invoke() }
            } else {
                if (resized) windows.updateViewLayout(view, params)
                if (redraw) view.invalidate()
            }
            return true
        } catch (_: RuntimeException) { failCapture("다른 앱 위에 안내 표시를 띄우지 못했어요."); return false }
    }

    private fun removeOverlay() {
        overlay?.let { runCatching { windows.removeViewImmediate(it) } }
        overlay = null; overlayParams = null; overlayOrigin.set(0, 0)
    }

    private fun clearOverlay() {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { clearOverlay() }; return }
        handler.removeCallbacks(hidePointer)
        pointerAt = null; annotations = emptyList(); studentMode = false; draft = null
        removeOverlay()
        removeToolbar()
    }

    /** Pen strokes and eraser touches in display pixels, sent as 0~1 points like the teacher's. */
    private fun studentTouch(event: android.view.MotionEvent): Boolean {
        val geometry = mutable.value.geometry
        val tool = studentTool.value
        if (!studentMode || tool == null || geometry == null) return false
        val point = com.woongjin.thinkmeet.data.Point((event.rawX / (geometry.width - 1).coerceAtLeast(1)).toDouble().coerceIn(0.0, 1.0),
            (event.rawY / (geometry.height - 1).coerceAtLeast(1)).toDouble().coerceIn(0.0, 1.0))
        if (tool == "eraser") {
            if (event.actionMasked == android.view.MotionEvent.ACTION_DOWN || event.actionMasked == android.view.MotionEvent.ACTION_MOVE)
                inputs.tryEmit(StudentAnnotationInput.Erase(point))
            return true
        }
        val color = studentColor.value
        when (event.actionMasked) {
            android.view.MotionEvent.ACTION_DOWN -> { draft = mutableListOf(point); draftPreviewAt = 0L }
            android.view.MotionEvent.ACTION_MOVE -> {
                val points = draft ?: return true
                val last = points.last()
                if (points.size >= 2048 || abs(last.x - point.x) + abs(last.y - point.y) <= .001) return true
                points += point
                val now = android.os.SystemClock.uptimeMillis()
                if (now - draftPreviewAt > 100) { draftPreviewAt = now; inputs.tryEmit(StudentAnnotationInput.Preview("pen", color, points.takeLast(256))) }
            }
            android.view.MotionEvent.ACTION_UP -> { draft?.let { inputs.tryEmit(StudentAnnotationInput.Stroke("pen", color, it.toList())) }; draft = null }
            android.view.MotionEvent.ACTION_CANCEL -> draft = null
        }
        overlay?.let { it.draft = draft?.let { points -> RemoteStroke("pen", color, points.toList()) }; it.invalidate() }
        return true
    }

    private fun syncToolbar() {
        val host = toolbarHost
        if (!studentMode || closed || host == null || host.isDestroyed || !Settings.canDrawOverlays(context)) { removeToolbar(); return }
        if (toolbar != null) return
        // A full-display context: the PiP Activity's own configuration is only as wide as its window.
        val windowContext = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            host.applicationContext.createWindowContext(host.display ?: return, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
        else host.applicationContext
        val toolbarWindows = windowContext.getSystemService(WindowManager::class.java)
        val view = ComposeView(windowContext).apply {
            setViewTreeLifecycleOwner(host)
            setViewTreeViewModelStoreOwner(host)
            setViewTreeSavedStateRegistryOwner(host)
            setContent {
                StudentAnnotationToolbar(studentTool.value, studentColor.value,
                    onTool = { studentTool.value = it; draft = null; renderOverlay() },
                    onColor = { studentColor.value = it; if (studentTool.value != "pen") { studentTool.value = "pen"; renderOverlay() } },
                    onUndo = { inputs.tryEmit(StudentAnnotationInput.Undo) })
            }
        }
        val metrics = windowContext.resources.displayMetrics
        // Phones have no room beside the action bar at the bottom start, so the toolbar sits above it.
        val compact = metrics.widthPixels / metrics.density < DesignTokens.Layout.MeetingCompactBreakpoint.value
        val bottom = DesignTokens.Spacing.S16.value + if (compact) DesignTokens.Spacing.S72.value else 0f
        val params = WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = (bottom * metrics.density).roundToInt()
            title = "ThinkMeetStudentAnnotation"
        }
        try {
            toolbarWindows.addView(view, params)
            toolbar = view; this.toolbarWindows = toolbarWindows
        } catch (_: RuntimeException) { /* Overlay permission can be revoked at any time; capture checks it again. */ }
    }

    private fun raiseToolbar() { if (toolbar != null) { removeToolbar(); syncToolbar() } }

    private fun removeToolbar() {
        val view = toolbar ?: return
        toolbar = null
        runCatching { toolbarWindows?.removeViewImmediate(view) }
        toolbarWindows = null
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
        detachCaptureObservers(); clearOverlay()
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
        captureStopped(null); clearOverlay()
        scope.launch { try { if (track != null) runCatching { releaseOwnedTrack(track) } } finally { scope.cancel() } }
    }
}

/** Full-display canvas in screen pixels: the teacher's strokes, then the pointer on top. Never touchable. */
private class AssistanceOverlayView(context: Context) : View(context) {
    var pointer: android.graphics.PointF? = null
    var strokes: List<RemoteStroke> = emptyList()
    var geometry: AssistanceGeometry? = null
    /** The student's stroke in progress, drawn locally until the server echoes it. */
    var draft: RemoteStroke? = null
    var onTouch: ((android.view.MotionEvent) -> Boolean)? = null
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DesignTokens.Colors.Danger.toArgb() }
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val path = android.graphics.Path()
    private val density = resources.displayMetrics.density
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO; setWillNotDraw(false) }

    @android.annotation.SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: android.view.MotionEvent): Boolean = onTouch?.invoke(event) ?: false

    override fun onDraw(canvas: Canvas) {
        // Draws in display coordinates: the controller moves this window to the display's top-left corner once
        // after the first layout. The moved surface keeps this content, so no redraw is needed after the move.
        val size = geometry ?: return
        (draft?.let { strokes + it } ?: strokes).forEach { stroke ->
            if (stroke.points.isEmpty()) return@forEach
            pen.color = runCatching { android.graphics.Color.parseColor(stroke.color) }.getOrDefault(android.graphics.Color.BLACK)
            // Same widths as the in-app stage (4dp pen, 18dp highlighter at 38%).
            pen.alpha = if (stroke.tool == "highlighter") (.38f * 255).roundToInt() else 255
            pen.strokeWidth = (if (stroke.tool == "highlighter") 18f else 4f) * density
            path.rewind()
            stroke.points.forEachIndexed { index, point ->
                val x = (point.x * (size.width - 1)).toFloat(); val y = (point.y * (size.height - 1)).toFloat()
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            canvas.drawPath(path, pen)
        }
        pointer?.let { center ->
            val diameter = DesignTokens.Component.RemotePointerSize.value * density
            val ring = DesignTokens.Component.RemotePointerRingWidth.value * density
            ink.style = Paint.Style.STROKE; ink.strokeWidth = ring
            canvas.drawCircle(center.x, center.y, (diameter - ring) / 2f, ink)
            ink.style = Paint.Style.FILL
            canvas.drawCircle(center.x, center.y, DesignTokens.Component.RemotePointerCoreSize.value * density / 2f, ink)
        }
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
        val host = context.findMainActivity()
        controller.toolbarHost = host
        controller.raiseCompanions = { host?.pictureInPictureController?.raiseActionBar() }
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
