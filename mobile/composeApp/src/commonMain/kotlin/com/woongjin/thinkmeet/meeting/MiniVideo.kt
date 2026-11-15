package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.woongjin.thinkmeet.design.DesignIcon
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken
import com.woongjin.thinkmeet.platform.MediaController
import com.woongjin.thinkmeet.platform.MediaState
import com.woongjin.thinkmeet.platform.PipVideoTarget
import com.woongjin.thinkmeet.platform.VideoSurface
import kotlin.math.roundToInt

/** Relative anchors keep the window in its chosen corner after rotation or a side-panel resize. */
@Stable
internal class MiniVideoPosition {
    var horizontal by mutableFloatStateOf(1f)
    var vertical by mutableFloatStateOf(0f)
}

@Composable
internal fun FloatingMiniVideo(
    media: MediaController,
    state: MediaState,
    target: PipVideoTarget,
    name: String,
    tablet: Boolean,
    position: MiniVideoPosition,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val gutter = Space.S12
        val header = Space.S36
        val availableWidth = (maxWidth - gutter * 2).coerceAtLeast(Space.S1)
        val availableHeight = (maxHeight - gutter * 2).coerceAtLeast(Space.S1)
        if (availableHeight <= header) return@BoxWithConstraints
        val desiredWidth = if (tablet) LayoutToken.PipMiniTabletWidth else LayoutToken.PipMiniPhoneWidth
        val minimum = LayoutToken.PipMiniMinWidth.coerceAtMost(availableWidth)
        val heightLimit = ((availableHeight - header).coerceAtLeast(Space.S1) * validVideoAspect(target.aspectRatio))
        val width = desiredWidth.coerceAtLeast(minimum).coerceAtMost(availableWidth).coerceAtMost(heightLimit)
        val videoHeight = width / validVideoAspect(target.aspectRatio)
        val cardHeight = videoHeight + header
        val viewportW = with(density) { maxWidth.toPx() }
        val viewportH = with(density) { maxHeight.toPx() }
        val cardW = with(density) { width.toPx() }
        val cardH = with(density) { cardHeight.toPx() }
        val margin = with(density) { gutter.toPx() }
        val freeX = (viewportW - cardW - margin * 2).coerceAtLeast(0f)
        val freeY = (viewportH - cardH - margin * 2).coerceAtLeast(0f)
        val offset = clampMiniVideoOffset(margin + freeX * position.horizontal, margin + freeY * position.vertical, viewportW, viewportH, cardW, cardH, margin)
        val latestOffset by rememberUpdatedState(offset)
        Surface(
            modifier = Modifier.offset { IntOffset(offset.x.roundToInt(), offset.y.roundToInt()) }.size(width, cardHeight)
                .testTag("meeting-mini-video").semantics { contentDescription = "미니 영상" },
            shape = RoundedCornerShape(Corner.R12), color = Palette.MeetingTile,
            shadowElevation = Space.S8,
        ) {
            Column {
                Row(
                    Modifier.fillMaxWidth().height(header).background(Palette.MeetingCanvas).testTag("meeting-mini-video-handle")
                        .pointerInput(viewportW, viewportH, cardW, cardH, margin) {
                            var dragged = Offset.Zero
                            detectDragGestures(
                                onDragStart = { dragged = Offset(latestOffset.x, latestOffset.y) },
                                onDrag = { change, delta ->
                                    change.consume()
                                    val next = clampMiniVideoOffset(dragged.x + delta.x, dragged.y + delta.y, viewportW, viewportH, cardW, cardH, margin)
                                    dragged = Offset(next.x, next.y)
                                    position.horizontal = if (freeX > 0f) ((next.x - margin) / freeX).coerceIn(0f, 1f) else 0f
                                    position.vertical = if (freeY > 0f) ((next.y - margin) / freeY).coerceIn(0f, 1f) else 0f
                                },
                            )
                        }.semantics { contentDescription = "미니 영상 이동" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DesignIcon("more", Modifier.padding(start = Space.S4).size(Space.S16).graphicsLayer { rotationZ = 90f }, Palette.MeetingMuted)
                    Text(name, Modifier.weight(1f).padding(start = Space.S4), color = Palette.White, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = onClose, modifier = Modifier.size(header)) { DesignIcon("close", Modifier.size(Space.S18), Palette.MeetingText, "미니 영상 닫기") }
                }
                CompactVideo(media, state, target, name, Modifier.fillMaxWidth().height(videoHeight))
            }
        }
    }
}

/** Uses the same native renderer/room in both the floating card and Android's system PiP. */
@Composable
internal fun CompactVideo(media: MediaController, state: MediaState, target: PipVideoTarget?, name: String, modifier: Modifier = Modifier) {
    val participant = state.participants.firstOrNull { it.identity == target?.identity }
    Box(modifier.background(Palette.MeetingTile), contentAlignment = Alignment.Center) {
        if (target != null && participant != null && if (target.screen) participant.screen else participant.camera) {
            VideoSurface(media, target.identity, screen = target.screen, modifier = Modifier.fillMaxSize())
        } else {
            Surface(Modifier.size(Space.S48), shape = CircleShape, color = Palette.MeetingAvatarBlue) {
                Box(contentAlignment = Alignment.Center) { Text(name.removeSuffix(" 선생님").takeLast(2).ifEmpty { "수업" }, color = Palette.MeetingAvatarBlueText, style = MaterialTheme.typography.titleLarge) }
            }
        }
    }
}
