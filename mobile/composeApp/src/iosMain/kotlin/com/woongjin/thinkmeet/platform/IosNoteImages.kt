@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.interop.UIKitView
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asSkiaBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.delay
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Image
import platform.Foundation.NSData
import platform.Foundation.getBytes
import platform.UIKit.UIView

@Composable
internal actual fun rememberWorksheetDraft(studentId: String): MutableState<NoteDraft?> =
    remember(studentId) { mutableStateOf(null) }

@Composable
internal actual fun rememberNoteImagePicker(onResult: (ByteArray?, String?) -> Unit): NoteImagePicker {
    val bridge = checkNotNull(IosPlatform.bridge)
    val latest by rememberUpdatedState(onResult)
    var active by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { active = true; onDispose { active = false } }
    return NoteImagePicker(true) {
        bridge.pickNoteImage { data, error -> if (active) latest(data?.noteBytes(), error) }
    }
}

@Composable
internal actual fun WorksheetCameraPreview(
    modifier: Modifier, onAccess: (WorksheetCameraAccess) -> Unit, onPhoto: (ByteArray?, String?) -> Unit,
) {
    val bridge = checkNotNull(IosPlatform.bridge)
    val latestAccess by rememberUpdatedState(onAccess)
    val latestPhoto by rememberUpdatedState(onPhoto)
    var attempt by remember { mutableIntStateOf(0) }
    key(attempt) {
        var active by remember { mutableStateOf(true) }
        var view by remember { mutableStateOf<UIView?>(null) }
        DisposableEffect(Unit) {
            active = true
            latestAccess(WorksheetCameraAccess())
            onDispose { active = false }
        }
        UIKitView(factory = {
            bridge.worksheetCameraView { failure ->
                if (active) {
                    val source = view
                    if (failure != null) latestAccess(WorksheetCameraAccess(error = failure, retry = { attempt++ }))
                    else if (source != null) latestAccess(WorksheetCameraAccess(shutter = {
                        bridge.captureWorksheetPhoto(source) { data, error ->
                            if (active) {
                                val bytes = data?.noteBytes()
                                latestPhoto(bytes, error ?: if (bytes == null) "학습지 사진을 열 수 없어요." else null)
                            }
                        }
                    }))
                }
            }.also { view = it }
        }, modifier = modifier, onRelease = { bridge.disposeWorksheetCamera(it) }, interactive = false)
    }
}

@Composable
internal fun IosNoteFrame(source: NoteFrameSource?, view: UIView?, page: Int) {
    if (source == null || view == null) return
    val bridge = checkNotNull(IosPlatform.bridge)
    var ready by remember(view, page) { mutableStateOf(false) }
    LaunchedEffect(view, page) {
        while (true) { ready = bridge.isNoteFrameReady(view, page); delay(250) }
    }
    BindNoteFrame(source, ready) { bridge.readNoteFrame(view, page)?.noteBytes()?.let(::decodeNoteImage) }
}

private fun NSData.noteBytes(): ByteArray? {
    if (length == 0uL || length > NoteImageLimit.toULong()) return null
    return ByteArray(length.toInt()).also { buffer -> buffer.usePinned { getBytes(it.addressOf(0), length) } }
}

internal actual fun decodeNoteImage(bytes: ByteArray): ImageBitmap? = runCatching {
    val image = Image.makeFromEncoded(bytes)
    try {
        require(image.width.toLong() * image.height <= 25_000_000)
        image.toComposeImageBitmap()
    } finally { image.close() }
}.getOrNull()

internal actual fun encodeNoteImage(image: ImageBitmap): ByteArray? {
    val frame = Image.makeFromBitmap(image.asSkiaBitmap())
    try {
        val data = frame.encodeToData(EncodedImageFormat.JPEG, 92) ?: return null
        return try { data.bytes } finally { data.close() }
    } finally { frame.close() }
}
