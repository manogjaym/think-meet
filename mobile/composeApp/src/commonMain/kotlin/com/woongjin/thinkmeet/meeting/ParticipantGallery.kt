@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.woongjin.thinkmeet.meeting


import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.design.generated.DesignTokens.FontSize as FontSize
import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.*
import com.woongjin.thinkmeet.ui.NoteDialog
import com.woongjin.thinkmeet.ui.NotePreview
import kotlinx.datetime.toLocalDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*


// Participant video grid, pagination and tiles shared by the meeting stage and shared-content layout.
@Composable
internal fun ParticipantGallery(snapshot: MeetingSnapshot?, lesson: Lesson, user: User, media: MediaController, mediaState: MediaState, grid: Boolean, modifier: Modifier) {
    val roster = (snapshot?.participants.orEmpty().map { it.user } + lesson.students + lesson.teacher + user).associateBy { it.id }
    val people = mediaState.participants.map { participant -> roster[participant.identity]
        ?: User(participant.identity, participant.identity, participant.name.ifBlank { "참여자" }, "student") }
        .ifEmpty { listOf(user) }
    BoxWithConstraints(modifier) {
        val narrow = maxWidth < LayoutToken.MeetingCompactBreakpoint
        val gap = if (narrow) Space.S8 else Space.S12
        val tileAreaHeight = (maxHeight.value - 52).coerceAtLeast(1f)
        val stacked = maxWidth.value <= tileAreaHeight
        val columns = kotlin.math.floor((maxWidth.value + gap.value) / ((if (narrow) 160 else 240) + gap.value)).toInt().coerceIn(1, if (narrow) 2 else 3)
        val rows = kotlin.math.floor((maxHeight.value - 52 + gap.value) / (170 + gap.value)).toInt().coerceIn(1, if (narrow) 2 else 3)
        val featuredId = mediaState.participants.firstOrNull { it.speaking && it.identity != user.id }?.identity
            ?: people.firstOrNull { it.id == lesson.teacher.id }?.id ?: people.first().id
        val featured = people.firstOrNull { it.id == featuredId } ?: people.first()
        val paginated = if (grid) people else people.filter { it.id != featured.id }
        val pageSize = if (grid) columns * rows else 3
        var page by remember(pageSize, grid) { mutableIntStateOf(0) }
        val pages = ((paginated.size + pageSize - 1) / pageSize).coerceAtLeast(1)
        val safePage = page.coerceIn(0, pages - 1)
        LaunchedEffect(pageSize, pages) { page = safePage }
        val displayed = paginated.drop(safePage * pageSize).take(pageSize)
        val preferredColumns = kotlin.math.floor(kotlin.math.sqrt(displayed.size.toDouble() * maxWidth.value / tileAreaHeight) + .5).toInt()
        val visibleColumns = if (grid) preferredColumns.coerceIn(
            kotlin.math.ceil(displayed.size.toDouble() / rows).toInt().coerceAtLeast(1), minOf(columns, displayed.size.coerceAtLeast(1)),
        ) else 1
        fun raised(person: User) = snapshot?.participants?.find { it.user.id == person.id }?.raised == true
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(gap)) {
            if (grid) {
                Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    displayed.chunked(visibleColumns).forEach { row ->
                        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                            row.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxHeight()) }
                            repeat(visibleColumns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            } else if (displayed.isEmpty()) {
                ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(1f).fillMaxWidth())
            } else if (stacked) {
                Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(3f).fillMaxWidth())
                    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                        displayed.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxHeight(), small = true, speakerThumbnail = true) }
                    }
                }
            } else {
                Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(3f).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                        displayed.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxWidth(), small = true, speakerThumbnail = true) }
                    }
                }
            }
            if (pages > 1) MeetingPagination(safePage, pages, safePage * pageSize + 1, kotlin.math.min((safePage + 1) * pageSize, paginated.size), paginated.size,
                onPrevious = { page = (safePage - 1).coerceAtLeast(0) }, onNext = { page = (safePage + 1).coerceAtMost(pages - 1) })
        }
    }
}

@Composable
internal fun MeetingPagination(page: Int, pages: Int, start: Int, end: Int, total: Int, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(Space.S52), horizontalArrangement = Arrangement.spacedBy(Space.S12, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        OutlinedIconButton(onClick = onPrevious, enabled = page > 0, border = BorderStroke(Space.S1, Palette.MeetingBorder), modifier = Modifier.size(Space.S40)) {
            DesignIcon("chevron", Modifier.size(Space.S18).graphicsLayer { rotationZ = 180f }, if (page > 0) Palette.MeetingText else Palette.MeetingWeak, "이전 참가자 페이지")
        }
        Text("${page + 1} / $pages", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingText)
        if (!LocalMeetingCompact.current) Text("$start–$end / ${total}명", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingDim)
        OutlinedIconButton(onClick = onNext, enabled = page < pages - 1, border = BorderStroke(Space.S1, Palette.MeetingBorder), modifier = Modifier.size(Space.S40)) {
            DesignIcon("chevron", Modifier.size(Space.S18), if (page < pages - 1) Palette.MeetingText else Palette.MeetingWeak, "다음 참가자 페이지")
        }
    }
}

@Composable
internal fun ParticipantTile(person: User, teacher: Boolean, raised: Boolean, media: MediaController, state: MediaState, modifier: Modifier = Modifier, small: Boolean = false, speakerThumbnail: Boolean = false) {
    val participant = state.participants.firstOrNull { it.identity == person.id }
    val compact = LocalMeetingCompact.current
    val short = LocalMeetingShort.current
    val name = person.name.removeSuffix(" 선생님")
    val cameraVisible = participant?.camera == true && LocalMeetingVideoRendering.current
    val speaking = participant?.speaking == true
    val avatar = if (teacher) Palette.MeetingAvatarBlue else Palette.MeetingAvatarSage
    val avatarInk = if (teacher) Palette.MeetingAvatarBlueText else Palette.MeetingAvatarSageText
    val strip = small && !speakerThumbnail
    val tileRadius = if (strip) Corner.R8 else if (compact) Corner.R9 else Corner.R12
    val avatarSize = when { small && speakerThumbnail -> if (compact) FontSize.S18 else FontSize.S24; strip -> if (compact) FontSize.S17 else FontSize.S21; compact || short -> FontSize.S25; else -> (LocalMeetingViewportWidth.current.value * .03f).coerceIn(27f, 38f).sp }
    val avatarDiameter = when { small && speakerThumbnail -> if (compact) Space.S40 else Space.S64; strip -> if (compact) 38.dp else Space.S52; compact -> 66.dp; short -> 68.dp; else -> (LocalMeetingViewportWidth.current * .09f).coerceIn(76.dp, 112.dp) }
    val tagSize = if (strip) Type.Caption else Type.Support
    val tagInset = if (strip) Space.S8 else if (compact) Space.S10 else Space.S16
    Box(modifier.clip(RoundedCornerShape(tileRadius))
        .background(Palette.MeetingTile).border(Space.S2, if (speaking) Palette.PrimaryOnDark else androidx.compose.ui.graphics.Color.Transparent,
            RoundedCornerShape(tileRadius)), contentAlignment = Alignment.Center) {
        if (cameraVisible) VideoSurface(media, person.id, modifier = Modifier.fillMaxSize())
        else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S12)) {
            Surface(Modifier.size(avatarDiameter), shape = CircleShape, color = avatar) {
                Box(contentAlignment = Alignment.Center) { Text(if (name.length > 1) name.takeLast(2) else name, color = avatarInk,
                    style = MaterialTheme.typography.headlineMedium.copy(fontSize = avatarSize, lineHeight = avatarSize * 1.5f), fontWeight = DesignWeight.SemiBold) }
            }
            if (!small && !short) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                DesignIcon(if (participant?.camera == true) "video" else "videoOff", Modifier.size(Space.S14), Palette.MeetingCameraStatus)
                Text(if (participant?.camera == true) "영상 연결 중" else "카메라 꺼짐", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingCameraStatus)
            }
        }
        Row(Modifier.align(Alignment.BottomStart).padding(start = tagInset, end = tagInset, bottom = if (small && speakerThumbnail && compact) Space.S7 else tagInset)
            .then(if (cameraVisible) Modifier.background(Palette.Black.copy(alpha = .53f), RoundedCornerShape(Corner.R6)).padding(horizontal = Space.S8, vertical = Space.S4) else Modifier),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
            if (teacher) Text("선생님", Modifier.border(Space.S1, Palette.MeetingAvatarBorder, RoundedCornerShape(Corner.R4)).padding(horizontal = Space.S5, vertical = Space.S2),
                color = Palette.MeetingMuted, style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S12, lineHeight = FontSize.S12 * 1.5f))
            Text(name + if (participant?.local == true) " (나)" else "", color = Palette.MeetingSubtle,
                style = MaterialTheme.typography.labelMedium.copy(fontSize = tagSize, lineHeight = tagSize * 1.5f), fontWeight = DesignWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (raised) Row(Modifier.align(Alignment.TopStart).padding(Space.S12).background(Palette.MeetingHandBackground, RoundedCornerShape(Corner.R7)).padding(horizontal = Space.S10, vertical = Space.S7),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
            DesignIcon("hand", Modifier.size(Space.S17), Palette.MeetingHandText, "손듦")
            Text("손들기", color = Palette.MeetingHandText, style = MaterialTheme.typography.labelSmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
        if (!(small && compact)) Box(Modifier.align(Alignment.TopEnd).padding(if (compact || strip) Space.S7 else Space.S12)
            .size(if (strip) Space.S24 else if (compact) Space.S26 else Space.S32)
            .background(if (participant?.microphone == true) Palette.MeetingMicBackground else Palette.MeetingMicOffBackground, CircleShape), contentAlignment = Alignment.Center) {
            DesignIcon(if (participant?.microphone == true) "mic" else "micOff", Modifier.size(Space.S16),
                if (participant?.microphone == true) Palette.MeetingMuted else Palette.MicMuted, if (participant?.microphone == true) "마이크 켜짐" else "마이크 꺼짐")
        }
    }
}

@OptIn(kotlin.uuid.ExperimentalUuidApi::class)
internal fun uniqueId(prefix: String = ""): String {
    val uuid = kotlin.uuid.Uuid.random().toString()
    return if (prefix.isEmpty()) uuid else "$prefix-$uuid"
}
