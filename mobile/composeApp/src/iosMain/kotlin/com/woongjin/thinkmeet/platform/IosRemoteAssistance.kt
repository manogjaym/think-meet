package com.woongjin.thinkmeet.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** iOS can request assistance as a teacher; displaying marks over other apps is unsupported. */
private class IosRemoteAssistanceController : RemoteAssistanceController {
    override val state = MutableStateFlow(RemoteAssistanceState()).asStateFlow()
    override suspend fun ensureOverlayPermission(): Unit = error("iOS에서는 다른 앱 위에 안내 표시를 띄울 수 없어요.")
    override suspend fun startScreenShare(): AssistanceGeometry = error("이 기기는 원격 화면 안내 받기를 지원하지 않아요.")
    override fun showPointer(pointer: AssistancePointer) = Unit
    override fun clearPointer() = Unit
    override suspend fun stopScreenShare() = Unit
    override fun close() = Unit
}

@Composable
actual fun rememberRemoteAssistanceController(media: MediaController): RemoteAssistanceController = remember { IosRemoteAssistanceController() }
