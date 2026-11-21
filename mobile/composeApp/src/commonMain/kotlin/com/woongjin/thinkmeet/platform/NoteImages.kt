package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

internal const val NoteImageLimit = 10 * 1024 * 1024
internal const val NoteImageEdge = 2560

internal class NoteDraft(val bytes: ByteArray) {
    @OptIn(ExperimentalUuidApi::class)
    val requestId = Uuid.random().toString()
}

@Composable internal expect fun rememberWorksheetDraft(studentId: String): MutableState<NoteDraft?>

internal data class NoteImagePicker(val supported: Boolean, val launch: () -> Unit)
@Composable internal expect fun rememberNoteImagePicker(onResult: (ByteArray?, String?) -> Unit): NoteImagePicker
internal data class WorksheetCameraAccess(val shutter: (() -> Unit)? = null, val error: String? = null, val retry: (() -> Unit)? = null)

@Composable
internal expect fun WorksheetCameraPreview(
    modifier: androidx.compose.ui.Modifier,
    onAccess: (WorksheetCameraAccess) -> Unit,
    onPhoto: (ByteArray?, String?) -> Unit,
)

internal expect fun decodeNoteImage(bytes: ByteArray): ImageBitmap?
internal expect fun encodeNoteImage(image: ImageBitmap): ByteArray?

/** Connects the currently displayed native surface to the in-meeting capture button. */
class NoteFrameSource {
    internal var read by mutableStateOf<(suspend () -> ImageBitmap?)?>(null)
}

@Composable
internal fun BindNoteFrame(source: NoteFrameSource?, ready: Boolean, read: suspend () -> ImageBitmap?) {
    val current by rememberUpdatedState(read)
    DisposableEffect(source, ready) {
        if (ready) source?.read = { current() }
        onDispose { if (ready) source?.read = null }
    }
}
