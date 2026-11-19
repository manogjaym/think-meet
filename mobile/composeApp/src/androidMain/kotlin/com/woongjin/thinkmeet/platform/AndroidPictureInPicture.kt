package com.woongjin.thinkmeet.platform

import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.os.Process
import android.os.PowerManager
import android.util.Rational
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.woongjin.thinkmeet.MainActivity
import io.livekit.android.room.Room
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlin.math.roundToInt

/** PiP changes the presentation of the current Activity and never creates a second room. */
internal class AndroidPictureInPictureController(
    private val activity: MainActivity?,
    private val media: AndroidMediaController?,
) : PictureInPictureController {
    private val hardwareSupported = activity?.packageManager
        ?.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) == true
    private val mutable = MutableStateFlow(PictureInPictureState(supported = hardwareSupported))
    override val state: StateFlow<PictureInPictureState> = mutable.asStateFlow()
    private var enabled = false
    private var target: PipVideoTarget? = null
    private var closed = false
    private var resumed = true
    private var stopped = false
    private var enteredSinceResume = false
    private var transientInteraction = false
    private var lastParameters: ParametersKey? = null
    private var fullscreenSourceTarget: Pair<String, Boolean>? = null
    private var fullscreenSourceBounds: Rect? = null

    init { activity?.attachPictureInPictureController(this) }

    override fun update(enabled: Boolean, target: PipVideoTarget?) {
        if (closed) return
        this.enabled = enabled
        this.target = target
        applyParameters()
    }

    override suspend fun enter() { enterNow(reportFailure = true) }

    internal fun onMediaChanged() { if (!closed) applyParameters() }

    /** Permission/document/capture pickers are temporary app flows, not call dismissal. */
    internal fun beginTransientInteraction() {
        transientInteraction = true
        applyParameters()
    }

    internal fun endTransientInteraction() {
        transientInteraction = false
        applyParameters()
    }

    internal fun onResume() {
        resumed = true
        stopped = false
        transientInteraction = false
        if (activity?.isInPictureInPictureMode != true) {
            if (!deviceLocked()) enteredSinceResume = false
            mutable.update { it.copy(active = false, transitioning = false) }
        }
        applyParameters()
    }

    internal fun onStart() { stopped = false }

    internal fun onPause() { resumed = false }

    internal fun onUserLeaveHint() {
        if (closed || transientInteraction) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) enterNow(reportFailure = false)
        else if (Build.VERSION.SDK_INT < 35 && canEnter()) mutable.update { it.copy(transitioning = true, error = null) }
    }

    internal fun onTransitionStarted() {
        if (!closed && canEnter()) mutable.update { it.copy(transitioning = true, error = null) }
    }

    internal fun onModeChanged(active: Boolean) {
        if (closed) return
        if (active) enteredSinceResume = true
        mutable.update { it.copy(active = active, transitioning = false, error = if (active) null else it.error) }
        // A normal full-screen restoration reaches onResume; a dismissed window reaches onStop.
        // Do not infer dismissal from this callback alone: both transitions deliver active=false.
        if (!active && stopped && !resumed && enteredSinceResume && !deviceLocked() && isParticipating()) dismissOwnParticipation()
    }

    internal fun onStop() {
        stopped = true
        if (closed || transientInteraction || activity?.isChangingConfigurations == true) return
        // Screen lock/system occlusion can hide a still-existing PiP. Preserve that call.
        // A user-dismissed PiP either leaves PiP mode or finishes its Activity; order varies by OS.
        if (!resumed && enteredSinceResume && !deviceLocked() && isParticipating() &&
            (activity?.isInPictureInPictureMode != true || activity?.isFinishing == true)) dismissOwnParticipation()
    }

    internal fun onActivityDestroyed(changingConfiguration: Boolean) {
        if (!changingConfiguration && enteredSinceResume && activity?.isFinishing == true && !deviceLocked() && isParticipating()) dismissOwnParticipation()
        close()
    }

    private fun deviceLocked(): Boolean {
        val host = activity ?: return false
        return host.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true ||
            host.getSystemService(PowerManager::class.java)?.isInteractive == false
    }

    private fun isParticipating(): Boolean = media?.room?.state?.let { it != Room.State.DISCONNECTED } == true

    private fun dismissOwnParticipation() {
        if (mutable.value.closedByUser) return
        enabled = false
        // Latch this event until shared UI consumes it. update(false) must not erase the event.
        mutable.update { it.copy(active = false, transitioning = false, closedByUser = true) }
        applyParameters()
        // Synchronous room shutdown protects capture even if stopped-Activity recomposition is paused.
        // The shared session separately leaves this participant, including a lesson owner.
        media?.disconnectNow()
    }

    private fun canEnter(): Boolean {
        if (target == null) return false
        val controller = media ?: return false
        return !closed && !mutable.value.closedByUser && enabled && !transientInteraction && hardwareSupported &&
            controller.state.value.connected && permissionAllowed()
    }

    @Suppress("DEPRECATION")
    private fun permissionAllowed(): Boolean {
        val host = activity ?: return false
        return try {
            val manager = host.getSystemService(AppOpsManager::class.java) ?: return true
            val mode = manager.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), host.packageName)
            mode == AppOpsManager.MODE_ALLOWED || mode == AppOpsManager.MODE_DEFAULT
        } catch (_: RuntimeException) { false }
    }

    private fun aspectRatio(): Rational {
        val ratio = target?.aspectRatio?.takeIf { it.isFinite() && it > 0f } ?: (16f / 9f)
        // Android's supported range is [1/2.39, 2.39]. Preserve exact bounds after rounding.
        if (ratio <= 1f / 2.39f) return Rational(100, 239)
        if (ratio >= 2.39f) return Rational(239, 100)
        return Rational((ratio * 10_000).roundToInt().coerceIn(4_185, 23_900), 10_000)
    }

    private fun parameters(automatic: Boolean, source: Rect?): PictureInPictureParams {
        return PictureInPictureParams.Builder().apply {
            setAspectRatio(aspectRatio())
            if (source != null && !source.isEmpty) setSourceRectHint(source)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setAutoEnterEnabled(automatic)
                setSeamlessResizeEnabled(true)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setTitle("웅진 씽크빅 클래스")
        }.build()
    }

    private fun sourceBounds(): Rect? {
        val selected = target ?: return null
        val key = selected.identity to selected.screen
        if (mutable.value.active || mutable.value.transitioning) {
            // Shared UI retains an alpha-zero full-size composition under the compact surface.
            // Native getGlobalVisibleRect cannot detect Compose alpha; don't sample those views.
            return fullscreenSourceBounds?.takeIf { fullscreenSourceTarget == key }?.let(::Rect)
        }
        val bounds = media?.videoBounds(selected.identity, selected.screen)
        fullscreenSourceTarget = key
        fullscreenSourceBounds = bounds?.let(::Rect)
        return bounds
    }

    private fun applyParameters() {
        val host = activity ?: return
        if (!hardwareSupported || host.isDestroyed) return
        val automatic = canEnter()
        val selected = target
        val source = sourceBounds()
        val key = ParametersKey(automatic, selected, source?.let(::Rect))
        if (lastParameters == key) return
        try {
            host.setPictureInPictureParams(parameters(automatic, source))
            lastParameters = key
        } catch (_: IllegalArgumentException) {
            mutable.update { it.copy(transitioning = false, error = "작은 화면 크기를 설정하지 못했어요. 다시 시도해 주세요.") }
        } catch (_: IllegalStateException) {
            // Activity teardown can race a final track event; no presentation remains to update.
        }
    }

    private fun enterNow(reportFailure: Boolean) {
        val host = activity
        val failure = when {
            closed || host == null || host.isFinishing || host.isDestroyed -> "화면을 다시 연 뒤 작은 화면 보기를 시작해 주세요."
            !hardwareSupported -> "이 기기는 다른 앱 위의 작은 화면 보기를 지원하지 않아요."
            !permissionAllowed() -> "기기 설정에서 이 앱의 화면 속 화면(PiP)을 허용해 주세요."
            !canEnter() -> "수업 영상이 연결된 후 작은 화면 보기를 사용할 수 있어요."
            else -> null
        }
        if (failure != null) {
            if (reportFailure) mutable.update { it.copy(error = failure, transitioning = false) }
            return
        }
        if (host!!.isInPictureInPictureMode) return
        mutable.update { it.copy(transitioning = true, closedByUser = false, error = null) }
        try {
            val source = sourceBounds()
            if (!host.enterPictureInPictureMode(parameters(automatic = canEnter(), source = source))) {
                mutable.update { it.copy(transitioning = false, error = "작은 화면을 열지 못했어요. 기기의 화면 속 화면 설정을 확인해 주세요.") }
            }
        } catch (_: RuntimeException) {
            mutable.update { it.copy(transitioning = false, error = "작은 화면을 열지 못했어요. 기기의 화면 속 화면 설정을 확인해 주세요.") }
        }
    }

    override fun close() {
        if (closed) return
        val entering = mutable.value.transitioning && !mutable.value.closedByUser
        enabled = false
        target = null
        applyParameters()
        closed = true
        mutable.update { it.copy(active = false, transitioning = false) }
        activity?.detachPictureInPictureController(this)
        activity?.dismissTerminalPictureInPicture(entering)
    }

    private data class ParametersKey(val automatic: Boolean, val target: PipVideoTarget?, val source: Rect?)
}

internal fun Context.findMainActivity(): MainActivity? {
    var current = this
    while (current is ContextWrapper) {
        if (current is MainActivity) return current
        val base = current.baseContext
        if (base === current) break
        current = base
    }
    return current as? MainActivity
}

@Composable
actual fun rememberPictureInPictureController(media: MediaController): PictureInPictureController {
    val activity = LocalContext.current.findMainActivity()
    val controller = remember(activity, media) { AndroidPictureInPictureController(activity, media as? AndroidMediaController) }
    LaunchedEffect(controller, media) { media.state.collect { controller.onMediaChanged() } }
    DisposableEffect(controller) { onDispose { controller.close() } }
    return controller
}
