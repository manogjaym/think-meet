package com.woongjin.thinkmeet.platform

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.ThinkMeetTheme
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow

/** A view of an existing LiveKit track; PiP never creates another admission or room. */
data class PipVideoTarget(val identity: String, val screen: Boolean = false, val aspectRatio: Float = 16f / 9f)

/** App buttons shown in the system PiP window; the OS draws them and supplies its own expand/close. */
enum class PipAction { CaptureScreen, StopMirroring }

val PipAction.label: String get() = when (this) {
    PipAction.CaptureScreen -> DesignContent.NotesCapture
    PipAction.StopMirroring -> DesignContent.MirroringStop
}

/** Text buttons for [PipAction]s, shown outside the system PiP window because its own menu draws icons only. */
@Composable
fun PipActionBar(actions: List<PipAction>, onAction: (PipAction) -> Unit) {
    ThinkMeetTheme {
        Surface(shape = RoundedCornerShape(Component.CardRadius), color = Palette.White, shadowElevation = Space.S8) {
            Row(Modifier.padding(Space.S8), horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalAlignment = Alignment.CenterVertically) {
                actions.forEach { action ->
                    DesignButton(action.label, { onAction(action) }, secondary = action != PipAction.StopMirroring, danger = action == PipAction.StopMirroring)
                }
            }
        }
    }
}

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
    /** Return a PiP presentation to the full-screen classroom. No-op when already full screen. */
    fun restore() {}
    /** A short system message that stays visible while the app is only a PiP window. */
    fun showNotice(message: String) {}
    /** Moves the over-other-apps action bar to the bottom start so the student's annotation toolbar can take the centre. */
    fun setActionBarAtStart(start: Boolean) {}
}

@Composable
expect fun rememberPictureInPictureController(media: MediaController): PictureInPictureController
