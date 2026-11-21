package com.woongjin.thinkmeet.meeting

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.ChatMessage
import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.design.generated.DesignTokens.FontSize as FontSize
import com.woongjin.thinkmeet.platform.MediaState
import kotlinx.coroutines.delay
import kotlin.time.Clock
import kotlin.time.Instant

/** Only the meeting stage is dark; web panels and confirmations retain their light surface. */
internal val LocalMeetingCompact = staticCompositionLocalOf { false }
internal val LocalMeetingViewportWidth = staticCompositionLocalOf { 0.dp }
internal val LocalMeetingShort = staticCompositionLocalOf { false }

@Composable
internal fun MeetingStageTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(
        primary = Palette.PrimaryOnDark, onPrimary = Palette.MeetingCanvas,
        background = Palette.MeetingCanvas, onBackground = Palette.MeetingText,
        surface = Palette.MeetingTile, onSurface = Palette.MeetingText,
        surfaceVariant = Palette.MeetingControl, onSurfaceVariant = Palette.MeetingMuted,
        outline = Palette.MeetingBorder, error = Palette.MicMuted,
    ), typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, content = content)
}

@Composable
internal fun MeetingLightTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(
        primary = Palette.Primary, onPrimary = Palette.White,
        background = Palette.White, surface = Palette.White,
        onBackground = Palette.Ink, onSurface = Palette.Ink,
        surfaceVariant = Palette.MeetingSubtle, onSurfaceVariant = Palette.Muted,
        outline = Palette.Line, error = Palette.Danger,
    ), typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, content = content)
}

@Composable
internal fun MeetingLightPanel(modifier: Modifier, overlay: Boolean = false, content: @Composable () -> Unit) {
    MeetingLightTheme {
        Surface(modifier, shape = RoundedCornerShape(Corner.R12), color = Palette.White, contentColor = Palette.Ink, border = if (overlay) BorderStroke(Space.S1, Palette.Line) else null, shadowElevation = if (overlay) Space.S12 else 0.dp) { content() }
    }
}

@Composable
internal fun MeetingHeader(
    lesson: Lesson, state: MediaState, socketConnected: Boolean, serverTime: String?, grid: Boolean,
    compact: Boolean, width: Dp, instructionPhase: String? = null, instructionStartedAt: String? = null, subjectName: String? = null, onLayout: () -> Unit,
) {
    val short = LocalMeetingShort.current
    val height = if (short) 62.dp else if (compact) LayoutToken.MeetingHeaderCompact else if (width <= LayoutToken.MeetingOverlayBreakpoint) LayoutToken.MeetingHeaderMedium else LayoutToken.MeetingHeader
    val padding = if (compact) Space.S14 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S20 else Space.S32
    Row(Modifier.fillMaxWidth().height(height).padding(horizontal = padding), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S10 else Space.S12)) {
        if (!compact) BrandSymbol(Modifier.size(Space.S32), tint = Palette.PrimaryOnDark)
        Column(Modifier.weight(1f)) {
            Text(lesson.title, style = MaterialTheme.typography.titleMedium.copy(fontSize = Type.Heading, lineHeight = Type.Heading * 1.45f),
                fontWeight = DesignWeight.SemiBold, color = Palette.MeetingSubtle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val subtitle = subjectName?.let { "$it · ${lesson.teacher.name} 선생님" } ?: "${lesson.teacher.name} 선생님과 함께하는 화상 수업"
            if (!short) Text(subtitle, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f),
                color = Palette.MeetingDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (width > LayoutToken.MeetingOverlayBreakpoint) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                Box(Modifier.size(7.dp).clip(RoundedCornerShape(7.dp)).background(if (state.connected && socketConnected) Palette.MeetingConnected else Palette.Pending))
                Text(if (state.reconnecting) "재연결 중" else if (state.connected && socketConnected) DesignContent.MeetingConnected else if (state.connected) "수업 상태 재연결 중" else "연결 중",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingMuted)
            }
        }
        if (width > LayoutToken.MeetingOverlayBreakpoint) Spacer(Modifier.width(if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S2 else Space.S12))
        if (instructionPhase != "preparing") MeetingElapsed(instructionStartedAt ?: lesson.startedAt, serverTime)
        if (!compact) Spacer(Modifier.width(if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S2 else Space.S12))
        Surface(onClick = onLayout, modifier = if (compact) Modifier.widthIn(min = 42.dp) else Modifier, shape = RoundedCornerShape(Corner.R8), color = Color.Transparent,
            border = BorderStroke(Space.S1, Palette.MeetingBorder)) {
            Row(Modifier.heightIn(min = Space.S44).padding(horizontal = if (compact) Space.S8 else Space.S14),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                DesignIcon(if (grid) "screen" else "users", Modifier.size(Space.S18), Palette.MeetingText, if (grid) "발표자 보기로 전환" else "바둑판 보기로 전환")
                if (!compact) Text(if (grid) "발표자 보기" else "바둑판 보기", style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.MeetingText)
            }
        }
    }
}

@Composable
internal fun MeetingLessonModes(
    phase: String, enabled: Boolean, assistanceSupported: Boolean, onMode: (String) -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(start = Space.S14, end = Space.S14, bottom = Space.S8),
        horizontalArrangement = Arrangement.spacedBy(Space.S8, Alignment.CenterHorizontally)) {
        LessonModeButton(DesignContent.MeetingLessonClassroom, phase == "classroom", enabled) { onMode("classroom") }
        LessonModeButton(DesignContent.MeetingLessonMirroring, phase == "mirroring", enabled && assistanceSupported) { onMode("mirroring") }
    }
}

@Composable
private fun LessonModeButton(label: String, active: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val background = if (active) Palette.PrimaryOnDark else Palette.MeetingControl
    val foreground = if (active) Palette.MeetingCanvas else Palette.MeetingText
    Surface(onClick = onClick, enabled = enabled, modifier = Modifier.semantics { selected = active },
        shape = RoundedCornerShape(Corner.R8), color = background.copy(alpha = if (enabled) 1f else .55f),
        contentColor = foreground, border = BorderStroke(Space.S1, if (active) Palette.PrimaryOnDark else Palette.MeetingBorder)) {
        Box(Modifier.heightIn(min = Space.S44).padding(horizontal = Space.S14), contentAlignment = Alignment.Center) {
            Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f))
        }
    }
}

@Composable
private fun MeetingElapsed(startedAt: String?, serverTime: String?) {
    val receivedAt = remember(serverTime) { Clock.System.now() }
    val serverAt = remember(serverTime) { serverTime?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: receivedAt }
    val started = remember(startedAt) { startedAt?.let { runCatching { Instant.parse(it) }.getOrNull() } }
    var now by remember { mutableStateOf(Clock.System.now()) }
    LaunchedEffect(startedAt) { while (true) { delay(1000); now = Clock.System.now() } }
    val seconds = started?.let { ((serverAt - it) + (now - receivedAt)).inWholeSeconds.coerceAtLeast(0) } ?: 0L
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S4)) {
        DesignIcon("clock", Modifier.size(Space.S16), Palette.MeetingMuted)
        Text("${(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}",
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.MeetingMuted)
    }
}

@Composable
internal fun MeetingControls(
    compact: Boolean, owner: Boolean, microphone: Boolean, camera: Boolean, sharing: Boolean, raised: Boolean,
    count: Int, panel: Panel?, unread: Int, busy: Boolean, showShare: Boolean, showMaterials: Boolean,
    onMicrophone: () -> Unit, onCamera: () -> Unit, onHand: () -> Unit,
    onPanel: (Panel) -> Unit, onShare: () -> Unit, onExit: () -> Unit,
) {
    val width = LocalMeetingViewportWidth.current
    val short = LocalMeetingShort.current
    val outerGap = if (compact) Space.S3 else if (width <= LayoutToken.MeetingOverlayBreakpoint) Space.S6 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S8 else Space.S16
    val innerGap = if (compact) 0.dp else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S3 else Space.S8
    // CSS flex-shrinks compact controls; reserve the divider, gaps and hangup before sizing the seven tools.
    val compactFixedWidth = Space.S6 * 2 + Space.S2 * 2 + Space.S1 + outerGap * 3 + Space.S3 + Space.S44
    val itemWidth = if (compact) 42.dp.coerceAtMost(((width - compactFixedWidth) / 7).coerceAtLeast(0.dp))
        else if (width <= LayoutToken.MeetingOverlayBreakpoint) 62.dp else if (width <= LayoutToken.MeetingMediumBreakpoint) 67.dp else 74.dp
    Row(Modifier.fillMaxWidth().heightIn(min = if (short) 80.dp else if (compact) 84.dp else 92.dp)
        .padding(start = if (compact) Space.S6 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S16 else Space.S24,
            end = if (compact) Space.S6 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S16 else Space.S24,
            top = if (short) Space.S2 else if (compact) Space.S5 else Space.S8,
            bottom = if (short) Space.S4 else if (compact) Space.S7 else Space.S12),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(outerGap, Alignment.CenterHorizontally)) {
        Row(horizontalArrangement = Arrangement.spacedBy(innerGap)) {
            MeetingControl(if (microphone) "mic" else "micOff", if (microphone) "마이크" else "음소거 해제", if (microphone) "마이크 끄기" else "마이크 켜기", compact, itemWidth, muted = !microphone, onClick = onMicrophone)
            MeetingControl(if (camera) "video" else "videoOff", if (camera) "카메라" else "카메라 켜기", if (camera) "카메라 끄기" else "카메라 켜기", compact, itemWidth, muted = !camera, onClick = onCamera)
        }
        Box(Modifier.padding(horizontal = Space.S2).width(Space.S1).height(if (compact) Space.S28 else 35.dp).background(Palette.MeetingBorder))
        Row(horizontalArrangement = Arrangement.spacedBy(innerGap)) {
            if (showShare) MeetingControl("screen", if (sharing) "공유 중지" else "화면 공유", if (sharing) "화면 공유 중지" else "화면 공유", compact, itemWidth, selected = sharing, onClick = onShare)
            MeetingControl("users", DesignContent.MeetingPeopleControl, "${DesignContent.MeetingPeopleControl} ${count}명", compact, itemWidth, selected = panel == Panel.People, badge = count, onClick = { onPanel(Panel.People) })
            MeetingControl("chat", "채팅", if (unread > 0 && panel != Panel.Chat) "채팅, 읽지 않은 메시지 ${unread}개" else "채팅", compact, itemWidth,
                selected = panel == Panel.Chat, badge = unread.takeIf { panel != Panel.Chat } ?: 0, onClick = { onPanel(Panel.Chat) })
            if (showMaterials) MeetingControl("folder", "수업 자료", "수업 자료", compact, itemWidth, selected = panel == Panel.Materials, onClick = { onPanel(Panel.Materials) })
            if (!owner) MeetingControl("hand", if (raised) "손 내리기" else "손들기", if (raised) "손 내리기" else "손들기", compact, itemWidth, selected = raised, onClick = onHand)
            MeetingControl("more", "더보기", "더보기", compact, itemWidth, selected = panel == Panel.More, onClick = { onPanel(Panel.More) })
        }
        Surface(onClick = onExit, enabled = !busy, color = Palette.MeetingHangup, contentColor = Palette.White,
            shape = RoundedCornerShape(Corner.R12), modifier = Modifier.padding(start = if (compact) Space.S3 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S8 else Space.S16)
                .height(if (compact) Space.S44 else Space.S48).then(if (compact) Modifier.width(Space.S44) else Modifier.widthIn(min = if (width <= LayoutToken.MeetingOverlayBreakpoint) 92.dp else if (width <= LayoutToken.MeetingMediumBreakpoint) 100.dp else 116.dp))) {
            Row(Modifier.padding(horizontal = if (compact) Space.S8 else if (width <= LayoutToken.MeetingMediumBreakpoint) Space.S12 else Space.S24), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center) {
                DesignIcon("phone", Modifier.size(23.dp), Palette.White, if (owner) "수업 종료" else "수업 나가기")
                if (!compact) { Spacer(Modifier.width(Space.S8)); Text(if (owner) "수업 종료" else "나가기", style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

@Composable
private fun MeetingControl(
    icon: String, label: String, description: String, compact: Boolean, width: Dp,
    selected: Boolean = false, muted: Boolean = false, badge: Int = 0, onClick: () -> Unit,
) {
    val container = when { muted -> Palette.MicMuted; selected -> Palette.Selection; else -> Palette.MeetingControl }
    val ink = when { muted -> Palette.MeetingMutedInk; selected -> Palette.PrimaryPressed; else -> Palette.MeetingText }
    Column(Modifier.width(width).heightIn(min = if (LocalMeetingShort.current) 65.dp else if (compact) 68.dp else Space.S72)
        .clickable(onClick = onClick).semantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(if (compact) Space.S5 else Space.S8, Alignment.CenterVertically)) {
        Box(Modifier.size(if (compact) Space.S36 else Space.S48, if (compact) 39.dp else 43.dp)
            .background(container, RoundedCornerShape(if (compact) Corner.R10 else Corner.R12)), contentAlignment = Alignment.Center) {
            DesignIcon(icon, Modifier.size(if (compact) Space.S19 else Space.S22), ink)
            if (badge > 0) Surface(Modifier.align(Alignment.TopEnd).offset(x = Space.S4, y = -Space.S4),
                color = if (label == "채팅") Palette.Danger else Palette.MeetingSecondary, contentColor = Palette.White,
                shape = RoundedCornerShape(Corner.R5)) {
                Text(if (badge > 99) "99+" else "$badge", Modifier.padding(horizontal = Space.S4), style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S10, lineHeight = FontSize.S10 * 1.5f))
            }
        }
        Text(label, modifier = if (compact) Modifier.requiredWidth(Space.S56) else Modifier, color = Palette.MeetingText, style = MaterialTheme.typography.labelSmall.copy(fontSize = if (compact) FontSize.S11 else Type.Caption, lineHeight = (if (compact) FontSize.S11 else Type.Caption) * 1.5f),
            maxLines = 1, overflow = TextOverflow.Clip)
    }
}

@Composable
internal fun MeetingChatNotification(message: ChatMessage, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier) {
    MeetingLightTheme {
        Surface(modifier, shape = RoundedCornerShape(Corner.R12), color = Palette.White, contentColor = Palette.Ink,
            border = BorderStroke(Space.S1, Palette.Line), shadowElevation = Space.S8) {
            Row(verticalAlignment = Alignment.Top) {
                Row(Modifier.weight(1f).clickable(onClick = onOpen).semantics { contentDescription = "채팅 열기" }
                    .padding(start = Space.S16, top = Space.S16, bottom = Space.S16), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                    DesignAvatar(message.userName, message.userId, size = Space.S32, small = true)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S5)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                            Text(message.userName, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("새 메시지", style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S11, lineHeight = FontSize.S11 * 1.5f), color = Palette.Muted)
                        }
                        Text(message.text, style = MaterialTheme.typography.bodySmall, color = Palette.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S3)) {
                            Text("채팅 열기", style = MaterialTheme.typography.labelMedium, color = Palette.Primary)
                            DesignIcon("chevron", Modifier.size(Space.S14), Palette.Primary)
                        }
                    }
                }
                IconButton(onClick = onDismiss, modifier = Modifier.padding(Space.S4).size(Space.S40)) { DesignIcon("close", Modifier.size(Space.S16), Palette.Muted, "채팅 알림 닫기") }
            }
        }
    }
}
