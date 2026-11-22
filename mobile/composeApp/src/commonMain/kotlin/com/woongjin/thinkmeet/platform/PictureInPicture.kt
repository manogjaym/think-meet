package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow

/** A view of an existing LiveKit track; PiP never creates another admission or room. */
data class PipVideoTarget(val identity: String, val screen: Boolean = false, val aspectRatio: Float = 16f / 9f)

/** App buttons shown in the system PiP window; the OS draws them and supplies its own expand/close. */
enum class PipAction { CaptureScreen, StopMirroring }

data class PictureInPictureState(
    val supported: Boolean = false,
    val active: Boolean = false,
    val transitioning: Boolean = false,
    /** Sticky for this presentation until explicit cleanup/new entry; system close means leave self. */
    val closedByUser: Boolean = false,
    val error: String? = null,
)

interface PictureInPictureController {
    val state: StateFlow<PictureInPictureState>
    /** Configure automatic Home/background entry only while a real class connection is active. */
    fun update(enabled: Boolean, target: PipVideoTarget?)
    suspend fun enter()
    /** Disable automatic entry and release the presentation. Does not leave the classroom. */
    fun close()
    /** Taps on [setActions] buttons. Platforms without app PiP buttons never emit. */
    val actions: Flow<PipAction> get() = emptyFlow()
    fun setActions(actions: List<PipAction>) {}
    /** A short system message that stays visible while the app is only a PiP window. */
    fun showNotice(message: String) {}
}

@Composable
expect fun rememberPictureInPictureController(media: MediaController): PictureInPictureController
