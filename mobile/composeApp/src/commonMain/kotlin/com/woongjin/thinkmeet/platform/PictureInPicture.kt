package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.StateFlow

/** A view of an existing LiveKit track; PiP never creates another admission or room. */
data class PipVideoTarget(val identity: String, val screen: Boolean = false, val aspectRatio: Float = 16f / 9f)

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
}

@Composable
expect fun rememberPictureInPictureController(media: MediaController): PictureInPictureController
