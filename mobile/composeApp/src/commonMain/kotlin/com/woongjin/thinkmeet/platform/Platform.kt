package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.woongjin.thinkmeet.data.Share
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.config.ServerConfig
import io.ktor.client.HttpClient
import kotlinx.coroutines.flow.StateFlow

data class MediaParticipant(
    val identity: String, val name: String = "", val camera: Boolean = false,
    val microphone: Boolean = false, val screen: Boolean = false,
    val speaking: Boolean = false, val local: Boolean = false, val screenAspectRatio: Float = 16f / 9f,
)
enum class PreviewDevice { Checking, Connected, Permission, Unavailable, Failed }

class PreviewDeviceException(val status: PreviewDevice) : Exception()

data class MediaState(
    val connected: Boolean = false, val reconnecting: Boolean = false,
    val participants: List<MediaParticipant> = emptyList(), val error: String? = null,
    val camera: Boolean = true, val microphone: Boolean = true,
    val screenSharing: Boolean = false, val speaker: Boolean = true,
    /** The local regular capture, including while its LiveKit publication is reconnecting. */
    val screenCaptureId: Long = 0,
    val previewCamera: PreviewDevice = PreviewDevice.Checking,
    val canFlipPreview: Boolean = false,

)
interface MediaController {
    val state: StateFlow<MediaState>
    suspend fun connect(url: String, token: String, camera: Boolean, microphone: Boolean)
    suspend fun disconnect()
    suspend fun setCamera(enabled: Boolean)
    suspend fun setMicrophone(enabled: Boolean)
    suspend fun flipCamera()
    suspend fun setScreenShare(enabled: Boolean)
    suspend fun setSpeaker(enabled: Boolean)
}
interface PreviewAudio {
    suspend fun checkPreviewMicrophone(onLevel: (Float) -> Unit)
    suspend fun playPreviewTone()
}
@Composable expect fun rememberMediaController(): MediaController
@Composable expect fun VideoSurface(controller: MediaController, identity: String, screen: Boolean = false, modifier: Modifier = Modifier)
@Composable expect fun CameraPreview(controller: MediaController, enabled: Boolean, modifier: Modifier = Modifier)
@Composable expect fun prejoinInForeground(): Boolean

data class PickedFile(
    val name: String, val size: Long, val mimeType: String,
    val openChannel: () -> io.ktor.utils.io.ByteReadChannel,
    val release: () -> Unit = {},
)
@Composable expect fun rememberFilePicker(onResult: (PickedFile?) -> Unit): () -> Unit
@Composable expect fun MaterialSurface(
    api: ThinkMeetApi, share: Share, lessonId: String,
    modifier: Modifier = Modifier, onAspectRatio: (Float) -> Unit = {},
)
expect fun createHttpClient(): HttpClient
expect fun readPreference(key: String, fallback: String = ""): String
expect fun writePreference(key: String, value: String)
expect fun shareLink(url: String)
expect fun copyText(text: String)
@Composable expect fun BackHandler(enabled: Boolean = true, onBack: () -> Unit)
expect fun platformName(): String
/** Stable wire identifier; platformName() remains the user-facing label. */
expect fun clientPlatformId(): String

/** Receives verified /join/<code> or thinkmeet://join/<code> URLs. Never opens arbitrary URLs. */
object AppLinks {
    private val pending = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val code: StateFlow<String?> = pending
    fun receive(url: String) {
        val native = Regex("^thinkmeet://join/([A-Za-z0-9_-]{1,100})/?(?:[?#].*)?$", RegexOption.IGNORE_CASE).matchEntire(url)
        val configured = ServerConfig.ORIGIN
        val web = Regex("^${Regex.escape(configured)}/join/([A-Za-z0-9_-]{1,100})/?(?:[?#].*)?$").matchEntire(url)
        val code = (native ?: web)?.groupValues?.get(1)
        if (code != null) pending.value = code
    }
    fun consume() { pending.value = null }
}
