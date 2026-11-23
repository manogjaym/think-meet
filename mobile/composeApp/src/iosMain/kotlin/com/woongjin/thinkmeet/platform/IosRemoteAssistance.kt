@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import kotlinx.cinterop.useContents
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import platform.UIKit.UIScreen
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The student starts the ReplayKit broadcast and taps its system start button. */
private const val BROADCAST_START_TIMEOUT_MS = 60_000L

/**
 * Shares the student-approved full screen through the existing ReplayKit broadcast extension.
 * iOS has no public API for drawing over other apps, so the teacher's pointer is drawn on a copy of the
 * shared screen inside the PiP window instead. The capture uses the bridge's `assistanceScreen` action,
 * which never becomes a regular classroom share.
 */
private class IosRemoteAssistanceController(private val media: MediaController) : RemoteAssistanceController {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val mutable = MutableStateFlow(RemoteAssistanceState(supported = true, overlayAllowed = true))
    override val state: StateFlow<RemoteAssistanceState> = mutable.asStateFlow()
    override val showsPointerOverOtherApps = false
    override val showsPointerInPictureInPicture = true
    private var owns = false
    private var published = false
    private var version = 0
    private var closed = false

    init { scope.launch { media.state.collect { if (owns) reconcile(it) } } }

    override suspend fun ensureOverlayPermission() = check(!closed) { "화면 공유를 시작할 수 없어요." }

    override suspend fun startScreenShare(): AssistanceGeometry {
        check(!closed && !owns) { "이전 화면 공유가 멈춘 뒤 다시 시도해 주세요." }
        owns = true
        published = false
        mutable.value = mutable.value.copy(capturing = true, geometry = null, error = null)
        try {
            perform(true)
            reconcile(media.state.value)
            return withTimeout(BROADCAST_START_TIMEOUT_MS) {
                state.first { it.geometry != null || !it.capturing }.geometry ?: error("화면 공유가 종료됐어요.")
            }
        } catch (failure: Throwable) {
            release()
            withContext(NonCancellable) { runCatching { perform(false) } }
            if (failure is TimeoutCancellationException) error("화면 공유가 시작되지 않았어요. 다시 승인한 뒤 방송 시작을 눌러 주세요.")
            throw failure
        }
    }

    private fun reconcile(value: MediaState) {
        val local = value.participants.firstOrNull { it.local }
        // A regular classroom share has its own capture id; only the mirroring broadcast leaves it at 0.
        val sharing = value.connected && value.screenSharing && value.screenCaptureId == 0L && local?.screen == true
        if (!sharing) {
            if (published) release()
            return
        }
        published = true
        val next = displayGeometry(local!!.screenAspectRatio)
        val current = mutable.value.geometry
        if (current == null || current.width != next.width || current.height != next.height || current.rotation != next.rotation)
            mutable.value = mutable.value.copy(capturing = true, geometry = next.copy(version = ++version), error = null)
    }

    /** Matches the published broadcast's aspect so the teacher's pointer mapping and validation agree. */
    private fun displayGeometry(aspect: Float): AssistanceGeometry {
        val (width, height) = UIScreen.mainScreen.nativeBounds.useContents { size.width to size.height }
        val long = max(width, height).roundToInt().coerceAtLeast(1)
        val short = min(width, height).roundToInt().coerceAtLeast(1)
        // MediaState reports 16:9 until the track has dimensions; fall back to the portrait screen then.
        val known = aspect.isFinite() && aspect > 0f && abs(aspect - 16f / 9f) > .0001f
        if (!known) return AssistanceGeometry(short, long, 0, 0)
        return if (aspect >= 1f) AssistanceGeometry(long, (long / aspect).roundToInt().coerceAtLeast(1), 90, 0)
        else AssistanceGeometry((long * aspect).roundToInt().coerceAtLeast(1), long, 0, 0)
    }

    private fun release() {
        IosPlatform.bridge?.clearAssistancePointer()
        owns = false
        published = false
        mutable.value = mutable.value.copy(capturing = false, geometry = null)
    }

    private suspend fun perform(enabled: Boolean) = suspendCancellableCoroutine<Unit> { continuation ->
        val bridge = IosPlatform.bridge
        if (bridge == null) continuation.resumeWithException(IllegalStateException("화면 공유를 시작할 수 없어요."))
        else bridge.action("assistanceScreen", enabled) { error ->
            if (continuation.isActive) if (error == null) continuation.resume(Unit) else continuation.resumeWithException(IllegalStateException(error))
        }
    }

    /** The session has already checked the approved session, share, teacher and geometry version. */
    override fun showPointer(pointer: AssistancePointer) {
        if (closed || !owns || !mutable.value.capturing || mutable.value.geometry == null) return
        IosPlatform.bridge?.showAssistancePointer(pointer.x.coerceIn(0.0, 1.0), pointer.y.coerceIn(0.0, 1.0))
    }
    override fun clearPointer() { IosPlatform.bridge?.clearAssistancePointer() }

    override suspend fun stopScreenShare() {
        if (!owns && !published) return
        release()
        perform(false)
    }

    override fun close() {
        if (closed) return
        closed = true
        val owned = owns || published
        release()
        // The bridge outlives this controller; stop only a mirroring capture this controller started.
        if (owned) IosPlatform.bridge?.action("assistanceScreen", false) { }
        scope.cancel()
    }
}

@Composable
actual fun rememberRemoteAssistanceController(media: MediaController): RemoteAssistanceController = remember(media) { IosRemoteAssistanceController(media) }
