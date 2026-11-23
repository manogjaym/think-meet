package com.woongjin.thinkmeet.platform

import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Process
import android.os.PowerManager
import android.provider.Settings
import android.util.Rational
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.woongjin.thinkmeet.MainActivity
import com.woongjin.thinkmeet.R
import com.woongjin.thinkmeet.design.generated.DesignTokens
import io.livekit.android.room.Room
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
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
    // The OS PiP menu already has an expand button, so the app adds only lesson actions.
    private var pipActions: List<PipAction> = emptyList()
    private val actionEvents = MutableSharedFlow<PipAction>(extraBufferCapacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val actions: Flow<PipAction> = actionEvents.asSharedFlow()
    private val actionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val name = intent.getStringExtra(EXTRA_PIP_ACTION) ?: return
            PipAction.entries.firstOrNull { it.name == name }?.let { actionEvents.tryEmit(it) }
        }
    }
    private var receiverRegistered = false
    // The OS PiP menu draws only icons, so a mirroring student also gets a text button bar
    // in an app overlay window (permission already granted for mirroring). It is part of the shared screen.
    private val barActions = mutableStateOf(emptyList<PipAction>())
    private var actionBar: ComposeView? = null
    private var actionBarWindows: WindowManager? = null

    init {
        activity?.attachPictureInPictureController(this)
        activity?.let { host ->
            // Only this app's own PendingIntents can reach the receiver.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) host.registerReceiver(actionReceiver, IntentFilter(ACTION_PIP), Context.RECEIVER_NOT_EXPORTED)
            else @Suppress("UnspecifiedRegisterReceiverFlag") host.registerReceiver(actionReceiver, IntentFilter(ACTION_PIP))
            receiverRegistered = true
        }
    }

    override fun setActions(actions: List<PipAction>) {
        if (closed || pipActions == actions) return
        pipActions = actions
        applyParameters()
        syncActionBar()
    }

    override fun restore() {
        val host = activity ?: return
        if (closed || host.isFinishing || host.isDestroyed || !host.isInPictureInPictureMode) return
        removeActionBar()
        // MainActivity is singleTask, so the launcher intent expands the same call instead of starting another.
        runCatching { host.startActivity(Intent.makeMainActivity(ComponentName(host, MainActivity::class.java))) }
    }

    private fun syncActionBar() {
        val host = activity
        if (host == null || closed || host.isDestroyed || !mutable.value.active || mutable.value.closedByUser ||
            target == null || pipActions.isEmpty() || !Settings.canDrawOverlays(host)) { removeActionBar(); return }
        barActions.value = pipActions
        if (actionBar != null) return
        // The PiP Activity's own configuration is only as wide as the PiP window, so use a full-display context.
        val context = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            host.applicationContext.createWindowContext(host.display ?: return, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
        else host.applicationContext
        val windows = context.getSystemService(WindowManager::class.java)
        val view = ComposeView(context).apply {
            setViewTreeLifecycleOwner(host)
            setViewTreeViewModelStoreOwner(host)
            setViewTreeSavedStateRegistryOwner(host)
            setContent { PipActionBar(barActions.value) { actionEvents.tryEmit(it) } }
        }
        val params = WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = (DesignTokens.Spacing.S16.value * context.resources.displayMetrics.density).roundToInt()
            title = "ThinkMeetPipActions"
        }
        try {
            windows.addView(view, params)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) view.isPreferKeepClear = true
            actionBar = view
            actionBarWindows = windows
        } catch (_: RuntimeException) {
            // Overlay permission can be revoked at any time; the system PiP menu icons still work.
        }
    }

    private fun removeActionBar() {
        val view = actionBar ?: return
        actionBar = null
        runCatching { actionBarWindows?.removeViewImmediate(view) }
        actionBarWindows = null
    }

    override fun showNotice(message: String) {
        val host = activity ?: return
        if (message.isNotBlank()) Toast.makeText(host.applicationContext, message, Toast.LENGTH_SHORT).show()
    }

    private fun remoteAction(host: MainActivity, action: PipAction): RemoteAction {
        val label = action.label
        val icon = when (action) {
            PipAction.CaptureScreen -> R.drawable.ic_pip_capture
            PipAction.StopMirroring -> R.drawable.ic_pip_stop_mirroring
        }
        val intent = Intent(ACTION_PIP).setPackage(host.packageName).putExtra(EXTRA_PIP_ACTION, action.name)
        val pending = PendingIntent.getBroadcast(host, action.ordinal + 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return RemoteAction(Icon.createWithResource(host, icon), label, label, pending)
    }

    override fun update(enabled: Boolean, target: PipVideoTarget?) {
        if (closed) return
        this.enabled = enabled
        this.target = target
        applyParameters()
        syncActionBar()
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
        syncActionBar()
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
        syncActionBar()
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
        syncActionBar()
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

    @androidx.annotation.VisibleForTesting
    internal fun parameters(automatic: Boolean, source: Rect?): PictureInPictureParams {
        return PictureInPictureParams.Builder().apply {
            setAspectRatio(aspectRatio())
            val host = activity
            val allowed = host?.maxNumPictureInPictureActions ?: 0
            setActions(if (host == null || target == null) emptyList() else pipActions.take(allowed).map { remoteAction(host, it) })
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
        val key = ParametersKey(automatic, selected, source?.let(::Rect), pipActions)
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
        removeActionBar()
        mutable.update { it.copy(active = false, transitioning = false) }
        if (receiverRegistered) { runCatching { activity?.unregisterReceiver(actionReceiver) }; receiverRegistered = false }
        activity?.detachPictureInPictureController(this)
        activity?.dismissTerminalPictureInPicture(entering)
    }

    private data class ParametersKey(val automatic: Boolean, val target: PipVideoTarget?, val source: Rect?, val actions: List<PipAction>)

    private companion object {
        const val ACTION_PIP = "com.woongjin.thinkmeet.action.PIP"
        const val EXTRA_PIP_ACTION = "action"
    }
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
