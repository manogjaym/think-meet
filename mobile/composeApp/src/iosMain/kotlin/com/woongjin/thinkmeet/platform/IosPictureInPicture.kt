package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private class IosPictureInPictureController : PictureInPictureController {
    private val native get() = checkNotNull(IosPlatform.bridge)
    private val mutable = MutableStateFlow(PictureInPictureState())
    private var closed = false
    override val state: StateFlow<PictureInPictureState> = mutable

    init { native.listenPictureInPicture { mutable.value = it } }

    override fun update(enabled: Boolean, target: PipVideoTarget?) {
        if (closed || IosPlatform.pictureInPictureOwner !== this) return
        native.updatePictureInPicture(enabled, target)
    }

    override suspend fun enter() = suspendCancellableCoroutine<Unit> { continuation ->
        if (closed || IosPlatform.pictureInPictureOwner !== this) {
            continuation.resumeWithException(IllegalStateException("수업 화면에서 다시 시도해 주세요."))
            return@suspendCancellableCoroutine
        }
        native.enterPictureInPicture { error ->
            if (continuation.isActive) {
                if (error == null) continuation.resume(Unit)
                else continuation.resumeWithException(IllegalStateException(error))
            }
        }
        continuation.invokeOnCancellation {
            if (IosPlatform.pictureInPictureOwner === this) native.closePictureInPicture()
        }
    }

    override fun close() {
        closed = true
        if (IosPlatform.pictureInPictureOwner === this) native.closePictureInPicture()
    }
}

@Composable
actual fun rememberPictureInPictureController(media: MediaController): PictureInPictureController {
    val controller = remember(media) {
        IosPictureInPictureController().also { IosPlatform.pictureInPictureOwner = it }
    }
    DisposableEffect(controller) {
        onDispose {
            if (IosPlatform.pictureInPictureOwner === controller) {
                controller.close()
                IosPlatform.pictureInPictureOwner = null
            }
        }
    }
    return controller
}
