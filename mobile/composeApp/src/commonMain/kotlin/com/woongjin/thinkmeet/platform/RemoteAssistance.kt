package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import kotlinx.coroutines.flow.StateFlow

data class RemoteAssistanceState(
    val supported: Boolean = false,
    val overlayAllowed: Boolean = false,
    val capturing: Boolean = false,
    /** Null while display rotation and the captured frame have not converged. */
    val geometry: AssistanceGeometry? = null,
    val error: String? = null,
)

/** Displays guidance only; it never sends touch input to another application. */
interface RemoteAssistanceController {
    val state: StateFlow<RemoteAssistanceState>
    suspend fun ensureOverlayPermission()
    suspend fun startScreenShare(): AssistanceGeometry
    /** Caller verifies the approved session, target student and teacher identity. */
    fun showPointer(pointer: AssistancePointer)
    fun clearPointer()
    suspend fun stopScreenShare()
    fun close()
}

@Composable
expect fun rememberRemoteAssistanceController(media: MediaController): RemoteAssistanceController
