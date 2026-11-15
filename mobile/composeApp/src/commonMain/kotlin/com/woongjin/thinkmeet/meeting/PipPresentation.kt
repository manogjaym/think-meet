package com.woongjin.thinkmeet.meeting

import androidx.compose.runtime.staticCompositionLocalOf
import com.woongjin.thinkmeet.platform.MediaParticipant
import com.woongjin.thinkmeet.platform.PipVideoTarget

/** Detaches hidden gallery renderers during Android PiP while keeping their surrounding UI state. */
internal val LocalMeetingVideoRendering = staticCompositionLocalOf { true }

/** Selects existing room tracks. A local screen is never selected, avoiding recursive capture. */
fun selectPipTarget(
    participants: List<MediaParticipant>,
    localIdentity: String,
    teacherIdentity: String,
    allowScreen: Boolean = true,
    sharedScreenOwner: String? = null,
): PipVideoTarget? {
    val available = participants.filter { it.identity.isNotBlank() }.distinctBy { it.identity }
    val remote = available.filter { !it.local && it.identity != localIdentity }
    if (allowScreen) {
        val screen = remote.firstOrNull { it.screen && it.identity == sharedScreenOwner }
            ?: remote.firstOrNull { it.screen }
        if (screen != null) return PipVideoTarget(screen.identity, screen = true, aspectRatio = validVideoAspect(screen.screenAspectRatio))
    }
    val camera = remote.firstOrNull { it.identity == teacherIdentity && it.camera }
        ?: remote.firstOrNull { it.speaking && it.camera }
        ?: remote.firstOrNull { it.camera }
        ?: remote.firstOrNull { it.identity == teacherIdentity }
        ?: remote.firstOrNull { it.speaking }
        ?: remote.firstOrNull()
        ?: available.firstOrNull { (it.local || it.identity == localIdentity) && it.camera }
        ?: available.firstOrNull { it.local || it.identity == localIdentity }
        ?: return null
    return PipVideoTarget(camera.identity)
}

/** A shared document/screen remains on the stage; the floating window always shows a camera. */
fun selectMiniVideoTarget(participants: List<MediaParticipant>, localIdentity: String, teacherIdentity: String): PipVideoTarget? =
    selectPipTarget(participants, localIdentity, teacherIdentity, allowScreen = false)

fun validVideoAspect(aspect: Float): Float = if (aspect.isFinite() && aspect > 0f) aspect else 16f / 9f

data class MiniVideoOffset(val x: Float, val y: Float)

/** Pixel bounds for drag/rotation tests. Even an oversized card stays anchored inside the viewport. */
fun clampMiniVideoOffset(
    x: Float, y: Float,
    viewportWidth: Float, viewportHeight: Float,
    miniWidth: Float, miniHeight: Float,
    margin: Float = 0f,
): MiniVideoOffset {
    fun bound(value: Float, viewport: Float, item: Float): Float {
        val area = if (viewport.isFinite()) viewport.coerceAtLeast(0f) else 0f
        val length = if (item.isFinite()) item.coerceAtLeast(0f) else area
        val remaining = (area - length).coerceAtLeast(0f)
        val inset = if (margin.isFinite()) margin.coerceIn(0f, remaining / 2f) else 0f
        return (if (value.isFinite()) value else inset).coerceIn(inset, (remaining - inset).coerceAtLeast(inset))
    }
    return MiniVideoOffset(bound(x, viewportWidth, miniWidth), bound(y, viewportHeight, miniHeight))
}
