package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import com.woongjin.thinkmeet.ErrorCard
import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component as ComponentToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.platform.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.datetime.*
import kotlin.math.roundToLong
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

private val LocalLessonWidth = staticCompositionLocalOf { LayoutToken.PageMaxWidth }

/** Web .page dimensions; the host owns OS safe areas. */
@Composable fun PageColumn(verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(Space.S24), content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        val width = maxWidth
        val gutter = when { width <= LayoutToken.RootNavigationMobile -> Space.S18; width <= LayoutToken.FormWide -> Space.S26; width <= LayoutToken.PageCompactBreakpoint -> Space.S28; else -> Space.S48 }
        val top = when { width <= LayoutToken.RootNavigationMobile -> Space.S26; width <= LayoutToken.FormWide -> Space.S30; width <= LayoutToken.PageCompactBreakpoint -> Space.S32; width >= LayoutToken.PageLargeBreakpoint -> Space.S52; else -> Space.S48 }
        val bottom = when { width <= LayoutToken.RootNavigationMobile -> Space.S26; width <= LayoutToken.FormWide -> Space.S30; width <= LayoutToken.PageCompactBreakpoint -> Space.S40; else -> Space.S64 }
        Column(Modifier.widthIn(max = LayoutToken.PageMaxWidth).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = gutter).padding(top = top, bottom = bottom), verticalArrangement = verticalArrangement) {
            CompositionLocalProvider(LocalLessonWidth provides width) { content() }
        }
    }
}

@Composable internal fun LessonCard(modifier: Modifier = Modifier, padding: Dp = ComponentToken.CardPadding, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier, color = Palette.Surface, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(ComponentToken.CardRadius)) {
        Column(Modifier.fillMaxWidth().padding(padding), content = content)
    }
}

@Composable fun LessonDetail(lesson: Lesson, state: AppUiState, controller: AppState, origin: String) {
    var cancelling by remember(lesson.id) { mutableStateOf(false) }
    var copied by remember(lesson.id) { mutableStateOf(false) }
    val owner = lesson.teacher.id == state.user?.id
    val capabilities = controller.capabilities.collectAsState().value
    val link = "$origin/join/${lesson.code}"
    PageColumn {
        val width = LocalLessonWidth.current
        val phone = width <= LayoutToken.RootNavigationMobile
        val main: @Composable (Modifier) -> Unit = { modifier ->
            LessonCard(modifier, if (phone) Space.S20 else ComponentToken.CardPadding) {
                Row(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalAlignment = Alignment.CenterVertically) { StatusBadge(lesson.status); if (lesson.isOpen) AccessBadge() }
                Spacer(Modifier.height(Space.S12))
                LessonText(lesson.title, fontSize = if (phone) Type.Title else Type.Display, lineHeight = if (phone) Type.Title * 1.3462f else Type.Display * 1.3333f, fontWeight = DesignWeight.Bold)
                Spacer(Modifier.height(Space.S8))
                LessonText(lesson.description.ifBlank { "${lesson.teacher.name} 선생님과 함께하는 화상 수업" }, color = Muted, fontSize = Type.Body, lineHeight = Type.Body * 1.5f)
                Spacer(Modifier.height(Space.S32))
                val info = buildList {
                    add(Triple("calendar", "날짜", lessonDay(lesson.startsAt)))
                    add(Triple("clock", "수업 시간", lessonTimeRange(lesson)))
                    add(Triple("users", "선생님", "${lesson.teacher.name} 선생님"))
                    add(Triple(if (lesson.isOpen) "globe" else "lock", "참여 방식", if (lesson.isOpen) "누구나 참여 가능" else "선택한 학생만 참여"))
                    if (capabilities.supports(ContractProtocol.FeatureIds.ClassroomSubjects)) lesson.subject?.let {
                        add(Triple("file", DesignContent.LessonSubjectLabel, it.name))
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(Space.S24)) {
                    info.chunked(if (phone) 1 else 2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.S32)) { row.forEach { (icon, label, value) -> DetailInfo(icon, label, value, Modifier.weight(1f)) } }
                    }
                }
                Spacer(Modifier.height(if (lesson.isOpen) Space.S32 else Space.S40))
                if (lesson.isOpen) {
                    Surface(shape = RoundedCornerShape(Corner.R9), color = Palette.Canvas) {
                        Row(Modifier.fillMaxWidth().padding(Space.S18), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                            DesignIcon("globe", Modifier.padding(top = Space.S2).size(Space.S20), tint = Brand)
                            Column(verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                                LessonText("함께하고 싶은 누구나 참여할 수 있어요", fontSize = Type.Support, fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary)
                                LessonText(if (lesson.canJoin) "로그인 후 수업 목록이나 참여 링크로 입장할 수 있어요." else "누구나 참여할 수 있도록 열린 공개 수업이에요.", color = Muted, fontSize = Type.Caption, lineHeight = Type.Caption * 1.7f)
                            }
                        }
                    }
                    Spacer(Modifier.height(Space.S28))
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    LessonText(if (lesson.isOpen) "참여자" else if (lesson.canJoin) "초대 학생" else "참여 학생", Modifier.weight(1f), fontSize = Type.Heading, fontWeight = DesignWeight.Bold)
                    LessonText("${lesson.students.size}명", color = Muted, fontSize = Type.Support)
                }
                Spacer(Modifier.height(Space.S24))
                if (lesson.students.isEmpty()) {
                    HorizontalDivider(color = Palette.Line)
                    Column(Modifier.fillMaxWidth().padding(vertical = Space.S28), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                        DesignIcon("users", Modifier.size(Space.S24), tint = Palette.LineInput)
                        LessonText(if (lesson.canJoin) "아직 참여한 사람이 없어요." else "참여 기록이 없어요.", color = Palette.TextSecondary, fontSize = Type.Support)
                        if (lesson.canJoin) LessonText("참여 링크를 공유해 함께할 사람을 만나 보세요.", color = Muted, fontSize = Type.Caption, textAlign = TextAlign.Center)
                    }
                }
                lesson.students.forEach { student ->
                    HorizontalDivider(color = Palette.Line)
                    Row(Modifier.fillMaxWidth().padding(vertical = Space.S16), horizontalArrangement = Arrangement.spacedBy(Space.S12), verticalAlignment = Alignment.CenterVertically) {
                        DesignAvatar(student.name, student.id)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                            LessonText(student.name, fontSize = Type.Body, fontWeight = DesignWeight.SemiBold)
                            LessonText(if (lesson.isOpen) if (student.isTeacher) "선생님" else "학생" else "초등 5학년", fontSize = Type.Support, color = Muted)
                        }
                        val present = lesson.participants.any { it.userId == student.id }
                        SmallBadge(when (lesson.status) { "LIVE" -> if (present) "참여 중" else "아직 입장하지 않음"; "SCHEDULED" -> if (lesson.isOpen) "입장 대기" else "초대됨"; "CANCELLED" -> "취소"; else -> "수업 종료" }, live = lesson.status == "LIVE" && present)
                    }
                }
            }
        }
        val aside: @Composable (Modifier) -> Unit = { modifier ->
            LessonCard(modifier, if (phone) Space.S20 else Space.S24) {
                LessonText(if (lesson.canJoin) "수업 참여" else "수업 기록", color = Brand, fontSize = Type.Caption, fontWeight = DesignWeight.SemiBold)
                Spacer(Modifier.height(Space.S12))
                LessonText(when (lesson.status) { "LIVE" -> "지금 수업이 진행 중이에요"; "SCHEDULED" -> "수업을 미리 준비해 보세요"; "CANCELLED" -> "취소된 수업이에요"; else -> "종료된 수업이에요" }, fontSize = Type.Dialog, lineHeight = Type.Dialog * 1.409f, fontWeight = DesignWeight.Bold)
                Spacer(Modifier.height(Space.S8))
                LessonText(if (lesson.canJoin) "입장 전에 카메라와 마이크를 확인할 수 있어요." else "내 수업에서 다른 일정과 지난 수업을 확인할 수 있어요.", color = Muted, fontSize = Type.Support, lineHeight = Type.Support * 1.5f)
                Spacer(Modifier.height(Space.S24))
                val compactAside = width > LayoutToken.RootNavigationMobile && width <= LayoutToken.FormWide
                val canEdit = owner && lesson.status == "SCHEDULED"
                val primaryAction: @Composable (Modifier) -> Unit = { actionModifier ->
                    DesignButton(if (lesson.canJoin) if (lesson.status == "SCHEDULED") "입장 준비" else "수업 참여" else "홈으로 돌아가기", { if (lesson.canJoin) controller.prejoin(lesson) else controller.home() }, actionModifier, enabled = !state.busy, icon = if (lesson.canJoin) ({ DesignIcon("video", Modifier.size(Space.S20), tint = Palette.White) }) else null)
                }
                if (compactAside) Row(horizontalArrangement = Arrangement.spacedBy(Space.S18)) {
                    primaryAction(Modifier.weight(1f))
                    if (canEdit) DesignButton("일정 수정", { controller.edit(lesson) }, Modifier.weight(1f), enabled = !state.busy, secondary = true) else Spacer(Modifier.weight(1f))
                } else primaryAction(Modifier.fillMaxWidth())
                if (owner && lesson.status == "SCHEDULED") {
                    Spacer(Modifier.height(Space.S8))
                    if (!compactAside) DesignButton("일정 수정", { controller.edit(lesson) }, Modifier.fillMaxWidth(), enabled = !state.busy, secondary = true)
                    Row {
                        TextButton({ cancelling = true }, (if (compactAside) Modifier.weight(1f) else Modifier.fillMaxWidth()).heightIn(min = Space.S48), enabled = !state.busy) { LessonText("예정 수업 취소", color = Palette.DangerText, fontSize = Type.Label, fontWeight = DesignWeight.SemiBold) }
                        if (compactAside) Spacer(Modifier.weight(1f))
                    }
                }
                if (lesson.canJoin) {
                    Spacer(Modifier.height(Space.S24)); HorizontalDivider(color = Palette.Line)
                    CopyLinkAction(if (copied) "참여 링크 복사 완료" else "참여 링크 복사", copied, link) { copied = true }
                    if (lesson.isOpen) LessonText("로그인한 누구나 이 링크로 참여할 수 있어요.", color = Muted, fontSize = Type.Caption, lineHeight = Type.Caption * 1.7f)
                }
            }
        }
        if (width > LayoutToken.FormWide) Row(horizontalArrangement = Arrangement.spacedBy(Space.S24)) { main(Modifier.weight(1f)); aside(Modifier.width(if (width <= LayoutToken.PageCompactBreakpoint) LayoutToken.LessonAsideCompactWidth else LayoutToken.LessonAsideWidth)) }
        else Column(verticalArrangement = Arrangement.spacedBy(Space.S24)) { main(Modifier.fillMaxWidth()); aside(Modifier.fillMaxWidth()) }
        state.error?.let { ErrorCard(it) }
    }
    if (cancelling) AlertDialog(onDismissRequest = { cancelling = false }, title = { LessonText("이 수업을 취소할까요?") }, text = { LessonText("취소한 수업은 예정된 수업에서 더 이상 참여할 수 없습니다.") }, confirmButton = { TextButton({ cancelling = false; controller.cancel() }) { LessonText("수업 취소", color = Palette.DangerText) } }, dismissButton = { TextButton({ cancelling = false }) { LessonText("돌아가기") } })
}

@Composable private fun DetailInfo(icon: String, label: String, value: String, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
        DesignIcon(icon, Modifier.size(Space.S20), tint = Muted)
        Column(verticalArrangement = Arrangement.spacedBy(Space.S4)) { LessonText(label, color = Muted, fontSize = Type.Support); LessonText(value, fontSize = Type.Label, fontWeight = DesignWeight.SemiBold, lineHeight = Type.Label * 1.5f, color = Palette.TextSecondary) }
    }
}
@Composable private fun AccessBadge() {
    Surface(color = Palette.Surface, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Corner.R5)) {
        Row(Modifier.padding(horizontal = Space.S8, vertical = Space.S4), horizontalArrangement = Arrangement.spacedBy(Space.S5), verticalAlignment = Alignment.CenterVertically) { DesignIcon("globe", Modifier.size(Space.S14), tint = Muted); LessonText("공개 수업", fontSize = Type.Caption, color = Muted, fontWeight = DesignWeight.Medium) }
    }
}
@Composable private fun SmallBadge(text: String, selected: Boolean = false, live: Boolean = false) {
    Surface(color = if (live) Palette.LiveSuccessBackground else if (selected) Palette.Selection else Palette.Canvas, shape = RoundedCornerShape(Corner.R5)) {
        LessonText(text, Modifier.padding(horizontal = Space.S8, vertical = Space.S4), color = if (live) Palette.LiveSuccessText else if (selected) Brand else Muted, fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f, fontWeight = DesignWeight.SemiBold)
    }
}
/** Long-press keeps native sharing available without changing the web action layout. */
@Composable private fun CopyLinkAction(text: String, copied: Boolean, link: String, onCopied: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = Space.S48).combinedClickable(onClick = { copyText(link); onCopied() }, onLongClick = { shareLink(link) }, onLongClickLabel = "참여 링크 공유"), horizontalArrangement = Arrangement.spacedBy(Space.S9), verticalAlignment = Alignment.CenterVertically) {
        DesignIcon(if (copied) "check" else "copy", Modifier.size(Space.S20), tint = Brand); LessonText(text, color = Brand, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable fun LessonForm(state: AppUiState, controller: AppState, existing: Lesson?) {
    val initial = remember(existing?.id) { existing?.let { localDateTime(it.startsAt) } ?: (Clock.System.now() + 1.days).toLocalDateTime(Seoul).date.atTime(16, 0) }
    var title by remember(existing?.id) { mutableStateOf(existing?.title.orEmpty()) }
    var description by remember(existing?.id) { mutableStateOf(existing?.description.orEmpty()) }
    val subjectsEnabled = controller.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomSubjects)
    val savedSubject = existing?.subject
    var subject by remember(existing?.id, savedSubject) { mutableStateOf(savedSubject) }
    var date by remember(existing?.id) { mutableStateOf(initial.date.toString()) }
    var start by remember(existing?.id) { mutableStateOf(clockText(initial)) }
    var end by remember(existing?.id) { mutableStateOf(existing?.endsAt?.let { localDateTime(it) }?.let(::clockText) ?: clockText((initial.toInstant(Seoul) + 50.minutes).toLocalDateTime(Seoul))) }
    var noEnd by remember(existing?.id) { mutableStateOf(existing != null && existing.endsAt == null) }
    var open by remember(existing?.id) { mutableStateOf(existing?.isOpen ?: false) }
    var selected by remember(existing?.id) { mutableStateOf(existing?.students?.map { it.id }?.toSet() ?: emptySet()) }
    var search by remember { mutableStateOf("") }
    var validation by remember { mutableStateOf<String?>(null) }
    var datePicker by remember { mutableStateOf(false) }
    fun toggle(id: String) { selected = if (id in selected) selected - id else selected + id }
    fun save() {
        validation = null
        try {
            require(title.isNotBlank()) { "학습 제목을 입력해 주세요." }
            require(open || selected.isNotEmpty()) { "학생을 한 명 이상 선택해 주세요." }
            val startInstant = LocalDateTime.parse("${date}T${start}:00").toInstant(Seoul)
            require(startInstant > Clock.System.now()) { "현재 시간 이후의 시작 시간을 선택해 주세요." }
            val endInstant = if (noEnd) null else LocalDateTime.parse("${date}T${end}:00").toInstant(Seoul)
            require(endInstant == null || endInstant > startInstant) { "종료 시간은 시작 시간보다 늦어야 해요." }
            val subjectChanged = subjectsEnabled && subject?.id != savedSubject?.id
            controller.save(
                LessonInput(
                    title = title.trim(),
                    description = description.trim(),
                    startsAt = startInstant.toString(),
                    endsAt = endInstant?.toString(),
                    accessMode = if (open) "OPEN" else "INVITE_ONLY",
                    studentIds = if (open) emptyList() else selected.toList(),
                    subjectId = subject?.id.takeIf { subjectChanged },
                ),
                clearSubject = subjectChanged && subject == null,
            )
        } catch (e: IllegalArgumentException) { validation = e.message?.takeIf { !it.contains("parse", true) } ?: "날짜와 시간을 확인해 주세요. 시간은 HH:mm 형식이에요." }
    }
    PageColumn(verticalArrangement = Arrangement.Top) {
        val width = LocalLessonWidth.current
        val phone = width <= LayoutToken.RootNavigationMobile
        Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            LessonText("선생님 전용", color = Brand, fontSize = Type.Caption, fontWeight = DesignWeight.SemiBold)
            LessonText(if (existing == null) "새 수업 예약" else "수업 일정 수정", fontSize = if (phone) Type.Title else Type.Display, lineHeight = if (phone) Type.Title * 1.3462f else Type.Display * 1.3333f, fontWeight = DesignWeight.Bold)
            LessonText("함께 배울 내용과 수업 참여 방식을 정해 주세요.", color = Muted, fontSize = Type.Body, lineHeight = Type.Body * 1.5f)
        }
        Spacer(Modifier.height(Space.S32))
        val information: @Composable (Modifier) -> Unit = { modifier ->
            LessonCard(modifier, if (phone) Space.S20 else if (width <= LayoutToken.PageCompactBreakpoint) Space.S24 else ComponentToken.CardPadding) {
                LessonText("수업 정보", fontSize = Type.Heading, fontWeight = DesignWeight.Bold); Spacer(Modifier.height(Space.S22))
                DesignTextField(title, { title = it.take(200) }, Modifier.fillMaxWidth(), label = "학습 제목 *", placeholder = "예: 분수의 덧셈과 뺄셈", isError = validation != null && title.isBlank())
                Spacer(Modifier.height(Space.S24))
                if (subjectsEnabled) {
                    LessonSubjectField(controller.api, subject, !state.busy) { subject = it }
                    Spacer(Modifier.height(Space.S24))
                }
                DesignTextField(description, { description = it.take(5000) }, Modifier.fillMaxWidth(), label = "학습 내용", placeholder = "함께 배울 내용을 간단히 적어 주세요.", singleLine = false, minLines = 3)
                Spacer(Modifier.height(Space.S24))
                val dateField: @Composable (Modifier) -> Unit = { m -> DesignTextField(date, { date = it.take(10) }, m, label = "날짜 *", trailingIcon = { IconButton({ datePicker = true }, Modifier.size(Space.S24)) { DesignIcon("calendar", Modifier.size(Space.S20), tint = Muted, contentDescription = "날짜 선택") } }) }
                val startField: @Composable (Modifier) -> Unit = { m -> DesignTextField(start, { start = it.take(5) }, m, label = "시작 시간 *", placeholder = "HH:mm") }
                val endField: @Composable (Modifier) -> Unit = { m -> DesignTextField(end, { end = it.take(5) }, m, label = "종료 시간 *", placeholder = "HH:mm", enabled = !noEnd) }
                // Web .field keeps its 24px bottom margin inside the 12px-gap grid.
                if (phone) Column(verticalArrangement = Arrangement.spacedBy(Space.S36)) { dateField(Modifier.fillMaxWidth()); Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) { startField(Modifier.weight(1f)); endField(Modifier.weight(1f)) } }
                else Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) { dateField(Modifier.weight(1.2f)); startField(Modifier.weight(1f)); endField(Modifier.weight(1f)) }
                Spacer(Modifier.height(Space.S24))
                Row(Modifier.fillMaxWidth().heightIn(min = Space.S48).toggleable(value = noEnd, role = androidx.compose.ui.semantics.Role.Checkbox, onValueChange = { noEnd = it }), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(Space.S16).background(if (noEnd) Brand else Palette.White, RoundedCornerShape(Corner.R2)).border(Space.S1, if (noEnd) Brand else Palette.LineInput, RoundedCornerShape(Corner.R2)), contentAlignment = Alignment.Center) {
                        if (noEnd) DesignIcon("check", Modifier.size(Space.S13), tint = Palette.White)
                    }
                    Spacer(Modifier.width(Space.S8)); LessonText("종료 시간 없음", color = Palette.TextSecondary, fontSize = 14.sp, lineHeight = 21.sp)
                }
                if (noEnd) { Spacer(Modifier.height(Space.S8)); LessonText("선생님이 수업 종료를 누를 때까지 계속 참여할 수 있어요.", color = Muted, fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f) }
                (validation ?: state.error)?.let { Spacer(Modifier.height(Space.S16)); ErrorCard(it) }
            }
        }
        val participation: @Composable (Modifier) -> Unit = { modifier ->
            LessonCard(modifier, if (phone) Space.S20 else if (width <= LayoutToken.PageCompactBreakpoint) Space.S24 else ComponentToken.CardPadding) {
                LessonText("참여 설정", fontSize = Type.Heading, fontWeight = DesignWeight.Bold); Spacer(Modifier.height(Space.S6))
                LessonText("수업에 참여할 수 있는 대상을 정해 주세요.", color = Muted, fontSize = if (phone) Type.Caption else Type.Support); Spacer(Modifier.height(Space.S22))
                Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                    AccessOption("lock", "선택한 학생만", "초대한 학생끼리 집중하는 수업", !open, { open = false }, Modifier.weight(1f), phone)
                    AccessOption("globe", "누구나 참여", "초대 없이 함께할 수 있는 공개 수업", open, { open = true }, Modifier.weight(1f), phone)
                }
                if (existing != null && open != existing.isOpen) { Spacer(Modifier.height(Space.S16)); LessonText(if (open) "저장하면 초대받지 않은 사용자도 참여할 수 있어요." else "저장하면 아래에서 선택한 학생만 참여할 수 있어요.", color = Palette.TextSecondary, fontSize = Type.Caption, lineHeight = Type.Caption * 1.7f) }
                if (open) {
                    Spacer(Modifier.height(Space.S20))
                    Surface(Modifier.fillMaxWidth(), color = Palette.Canvas, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Corner.R8)) { LessonText("로그인한 사용자만 참여할 수 있어요.", Modifier.padding(horizontal = Space.S16, vertical = Space.S14), fontSize = Type.Caption, color = Muted, textAlign = TextAlign.Center) }
                } else {
                    Spacer(Modifier.height(Space.S28)); HorizontalDivider(color = Palette.Line); Spacer(Modifier.height(Space.S24))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) { LessonText("초대할 학생", fontSize = Type.Label, fontWeight = DesignWeight.SemiBold); LessonText("선택한 학생만 이 수업에 참여할 수 있어요.", color = Muted, fontSize = Type.Caption) }
                        SmallBadge("${selected.size}명 선택")
                    }
                    Spacer(Modifier.height(Space.S16))
                    DesignTextField(search, { search = it }, Modifier.fillMaxWidth(), placeholder = "학생 이름 검색", leadingIcon = { DesignIcon("search", Modifier.size(Space.S20), tint = Muted) })
                    Spacer(Modifier.height(Space.S12))
                    if (selected.isNotEmpty()) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S8)) { selected.forEach { id ->
                            Surface(onClick = { toggle(id) }, shape = RoundedCornerShape(Corner.R8), border = BorderStroke(Space.S1, Palette.Line), color = Palette.Canvas) {
                                Row(Modifier.heightIn(min = Space.S44).padding(horizontal = Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) { LessonText(state.students.find { it.id == id }?.name ?: "학생", fontSize = Type.Support, color = Palette.TextSecondary); DesignIcon("close", Modifier.size(Space.S14), tint = Muted, contentDescription = "학생 선택 해제") }
                            }
                        } }
                        Spacer(Modifier.height(Space.S16))
                    }
                    val results = state.students.filter { it.name.contains(search.trim(), ignoreCase = true) }
                    Column(Modifier.fillMaxWidth().heightIn(max = LayoutToken.PanelMinHeight).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                        results.forEach { student ->
                            val checked = student.id in selected
                            Surface(onClick = { toggle(student.id) }, color = if (checked) Palette.Selection.copy(alpha = .35f) else Palette.Surface, border = BorderStroke(Space.S1, if (checked) Brand.copy(alpha = .2f) else Palette.Line), shape = RoundedCornerShape(Corner.R8)) {
                                Row(Modifier.fillMaxWidth().padding(horizontal = Space.S16, vertical = Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                                    DesignAvatar(student.name, student.id)
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) { LessonText(student.name, fontSize = Type.Body, fontWeight = DesignWeight.SemiBold); LessonText("초등 5학년", fontSize = Type.Support, color = Muted) }
                                    Surface(Modifier.size(Space.S22), color = if (checked) Brand else Palette.Surface, border = BorderStroke(Space.S1, if (checked) Brand else Palette.LineInput), shape = RoundedCornerShape(Corner.R4)) { if (checked) Box(contentAlignment = Alignment.Center) { DesignIcon("check", Modifier.size(Space.S16), tint = Palette.White) } }
                                }
                            }
                        }
                        if (results.isEmpty()) LessonText("검색된 학생이 없습니다.", color = Muted, fontSize = Type.Support)
                    }
                }
            }
        }
        if (width > LayoutToken.FormWide) Row(horizontalArrangement = Arrangement.spacedBy(Space.S24)) { information(Modifier.weight(1.1f)); participation(Modifier.weight(1f)) }
        else Column(verticalArrangement = Arrangement.spacedBy(Space.S24)) { information(Modifier.fillMaxWidth()); participation(Modifier.fillMaxWidth()) }
        Spacer(Modifier.height(Space.S28))
        HorizontalDivider(color = Palette.Line)
        Spacer(Modifier.height(Space.S24))
        val summary = if (open) "누구나 참여할 수 있는 공개 수업" else if (selected.isNotEmpty()) "선택한 학생 ${selected.size}명만 참여" else "참여할 학생을 선택해 주세요"
        val actions: @Composable (Modifier) -> Unit = { m -> Row(m, horizontalArrangement = Arrangement.spacedBy(Space.S10)) { DesignButton("취소", controller::home, if (phone) Modifier.weight(1f) else Modifier, enabled = !state.busy, secondary = true); DesignButton(if (state.busy) "저장 중" else if (existing == null) "수업 예약" else "변경사항 저장", ::save, if (phone) Modifier.weight(2f) else Modifier, enabled = !state.busy) } }
        if (phone) Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S16), horizontalAlignment = Alignment.CenterHorizontally) { LessonText(summary, color = Muted, fontSize = Type.Caption); actions(Modifier.fillMaxWidth()) }
        else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S20)) { LessonText(summary, Modifier.weight(1f), color = Muted, fontSize = Type.Support); actions(Modifier) }
    }
    if (datePicker) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = runCatching { LocalDate.parse(date).atStartOfDayIn(TimeZone.UTC).toEpochMilliseconds() }.getOrNull())
        DatePickerDialog(onDismissRequest = { datePicker = false }, confirmButton = { TextButton({ picker.selectedDateMillis?.let { date = Instant.fromEpochMilliseconds(it).toLocalDateTime(TimeZone.UTC).date.toString() }; datePicker = false }) { LessonText("선택") } }, dismissButton = { TextButton({ datePicker = false }) { LessonText("취소") } }) { DatePicker(picker) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LessonSubjectField(api: ThinkMeetApi, selected: TeacherSubject?, enabled: Boolean, onSelect: (TeacherSubject?) -> Unit) {
    var subjects by remember(api) { mutableStateOf<List<TeacherSubject>?>(null) }
    var failed by remember(api) { mutableStateOf(false) }
    var retry by remember(api) { mutableIntStateOf(0) }
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(api, retry) {
        failed = false
        try {
            subjects = api.subjects()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    val rows = subjects
    val canSelect = enabled && rows != null && (rows.isNotEmpty() || selected != null)
    val message = when {
        failed -> DesignContent.LessonSubjectsError
        rows == null -> DesignContent.LessonSubjectsLoading
        rows.isEmpty() -> DesignContent.LessonSubjectsEmpty
        else -> null
    }
    Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        LessonText(DesignContent.LessonSubjectOptional, color = Palette.TextSecondary, fontSize = Type.Support, fontWeight = DesignWeight.Medium)
        ExposedDropdownMenuBox(expanded = canSelect && expanded, onExpandedChange = { expanded = it && canSelect }) {
            Surface(
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled = canSelect)
                    .semantics { contentDescription = DesignContent.LessonSubjectOptional }
                    .alpha(if (canSelect) 1f else .45f),
                color = Palette.White,
                shape = RoundedCornerShape(ComponentToken.InputRadius),
                border = BorderStroke(Space.S1, Palette.LineInput),
            ) {
                Row(
                    Modifier.heightIn(min = ComponentToken.InputHeight).padding(horizontal = ComponentToken.InputPadding),
                    horizontalArrangement = Arrangement.spacedBy(Space.S8),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(selected?.name ?: DesignContent.LessonSubjectNone, Modifier.weight(1f), maxLines = 1,
                        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                    DesignIcon("chevron", Modifier.size(Space.S16).rotate(90f), tint = Muted)
                }
            }
            ExposedDropdownMenu(expanded = canSelect && expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(text = { Text(DesignContent.LessonSubjectNone) }, onClick = { onSelect(null); expanded = false })
                rows.orEmpty().forEach { subject ->
                    DropdownMenuItem(text = { Text(subject.name) }, onClick = { onSelect(subject); expanded = false })
                }
            }
        }
        message?.let { LessonText(it, color = Muted, fontSize = Type.Support) }
        if (failed) TextButton(onClick = { retry++ }, enabled = enabled) { Text(DesignContent.LessonSubjectsRetry) }
    }
}

@Composable private fun AccessOption(icon: String, title: String, copy: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier, phone: Boolean) {
    Surface(onClick = onClick, modifier = modifier, color = if (selected) Brand.copy(alpha = .03f) else Palette.Surface, shape = RoundedCornerShape(Corner.R10), border = BorderStroke(if (selected) Space.S2 else Space.S1, if (selected) Brand else Palette.Line)) {
        Column(Modifier.padding(horizontal = if (phone) Space.S12 else Space.S16, vertical = if (phone) Space.S14 else Space.S16)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Surface(Modifier.size(Space.S36), shape = RoundedCornerShape(Corner.R8), color = if (selected) Palette.Selection else Palette.Canvas) { Box(contentAlignment = Alignment.Center) { DesignIcon(icon, Modifier.size(Space.S20), tint = if (selected) Brand else Muted) } }
                Surface(Modifier.size(Space.S18), shape = CircleShape, border = BorderStroke(Space.S1, if (selected) Brand else Palette.LineInput), color = if (selected) Brand else Palette.Surface) { if (selected) Box(contentAlignment = Alignment.Center) { DesignIcon("check", Modifier.size(Space.S12), tint = Palette.White) } }
            }
            Spacer(Modifier.height(Space.S14)); LessonText(title, fontSize = if (phone) Type.Support else Type.Label, fontWeight = DesignWeight.SemiBold); Spacer(Modifier.height(Space.S5))
            LessonText(copy, fontSize = Type.Caption, color = Muted, lineHeight = Type.Caption * 1.6f)
        }
    }
}

@Composable fun PrejoinScreen(lesson: Lesson, user: User, state: AppUiState, controller: AppState) {
    val enabled = controller.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomPrejoin)
    if (enabled) EnhancedPrejoinScreen(lesson, user, state, controller)
    else LegacyPrejoinScreen(lesson, user, state, controller)
}

@Composable private fun LegacyPrejoinScreen(lesson: Lesson, user: User, state: AppUiState, controller: AppState) {
    val media = rememberMediaController()
    val mediaState by media.state.collectAsState()
    val scope = rememberCoroutineScope()
    var camera by remember { mutableStateOf(readPreference("devices.camera", "true") == "true") }
    var microphone by remember { mutableStateOf(readPreference("devices.microphone", "false") == "true") }
    var flipError by remember { mutableStateOf<String?>(null) }
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        val viewportWidth = maxWidth
        val phone = maxWidth <= LayoutToken.PrejoinPhone
        val wide = maxWidth > LayoutToken.PrejoinWide
        val previewHeightLimit = if (!phone && !wide) maxHeight * .3f else Dp.Infinity
        val gutter = if (phone) Space.S24 else if (maxWidth <= LayoutToken.PrejoinCompactBreakpoint && wide) Space.S28 else Space.S40
        Column(Modifier.widthIn(max = if (wide) LayoutToken.PrejoinMaxWidth else LayoutToken.PrejoinSingleMaxWidth).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = gutter).padding(top = if (phone) Space.S16 else if (wide) Space.S32 else Space.S24, bottom = if (phone) Space.S32 else Space.S48)) {
            val preview: @Composable (Modifier) -> Unit = { modifier ->
                Column(modifier) {
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val ratio = if (phone) 4f / 3f else if (wide) 16f / 10f else 16f / 9f
                    Surface(Modifier.fillMaxWidth().height((maxWidth / ratio).coerceAtMost(previewHeightLimit)), color = if (camera) Palette.PrejoinBackground else Palette.PrejoinCameraOff, shape = RoundedCornerShape(if (phone) Corner.R10 else Corner.R14)) {
                        Box(contentAlignment = Alignment.Center) {
                            if (camera) CameraPreview(media, true, Modifier.fillMaxSize())
                            if (!camera) Column(Modifier.padding(bottom = Space.S24), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S12)) { DesignAvatar(user.name, user.id, size = if (phone) Space.S72 else ComponentToken.PrejoinAvatarSize); LessonText("카메라가 꺼져 있습니다", color = Palette.PrejoinHint, fontSize = Type.Support) }
                            LessonText("${user.name} · 나", Modifier.align(Alignment.BottomStart).padding(start = if (phone) Space.S12 else Space.S20, bottom = if (phone) Space.S16 else Space.S20), fontSize = Type.Support, color = Palette.Line, fontWeight = DesignWeight.Medium)
                            Row(Modifier.align(Alignment.BottomCenter).padding(bottom = if (phone) Space.S12 else Space.S16), horizontalArrangement = Arrangement.spacedBy(if (phone) Space.S8 else Space.S12)) {
                                PreviewControl(if (microphone) "mic" else "micOff", if (microphone) "마이크 끄기" else "마이크 켜기", microphone, phone) { microphone = !microphone; writePreference("devices.microphone", microphone.toString()) }
                                PreviewControl(if (camera) "video" else "videoOff", if (camera) "카메라 끄기" else "카메라 켜기", camera, phone) { camera = !camera; writePreference("devices.camera", camera.toString()) }
                            }
                        }
                    }
                    }
                    Spacer(Modifier.height(Space.S12))
                    Row(horizontalArrangement = Arrangement.spacedBy(if (phone) Space.S12 else Space.S24)) {
                        NativeDeviceLine("mic", "기본 마이크", Modifier.weight(1f))
                        NativeDeviceLine("video", "카메라 전환", Modifier.weight(1f), enabled = camera) { scope.launch { try { media.flipCamera(); flipError = null } catch (cancelled: CancellationException) { throw cancelled } catch (error: Exception) { flipError = error.message ?: "카메라를 전환하지 못했어요." } } }
                    }
                    // Retain the web meter's 12px + 5px + 6px rhythm without a fake input level.
                    Spacer(Modifier.height(Space.S12 + Space.S5 + Space.S6)); LessonText("입장 전에 카메라와 마이크를 확인해 주세요.", color = Muted, fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f)
                    (flipError ?: mediaState.error)?.let { Spacer(Modifier.height(Space.S12)); ErrorCard(it) }
                }
            }
            val information: @Composable (Modifier) -> Unit = { modifier ->
                Column(modifier) {
                    StatusBadge(lesson.status); Spacer(Modifier.height(Space.S16))
                    LessonText(lesson.title, fontSize = Type.Title, lineHeight = Type.Title * 1.3462f, fontWeight = DesignWeight.Bold); Spacer(Modifier.height(Space.S8))
                    LessonText("${lesson.teacher.name} 선생님 · ${lessonDay(lesson.startsAt)} ${koreanTime(lesson.startsAt)}", color = Muted, fontSize = Type.Support, lineHeight = Type.Support * 1.5f)
                    if (lesson.isOpen) {
                        Spacer(Modifier.height(Space.S16))
                        Surface(Modifier.fillMaxWidth(), color = Palette.Canvas, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Corner.R8)) {
                            Row(Modifier.padding(horizontal = Space.S14 + Space.S1, vertical = Space.S12 + Space.S1), horizontalArrangement = Arrangement.spacedBy(Space.S9), verticalAlignment = Alignment.Top) {
                                Box(Modifier.padding(top = Space.S2)) { DesignIcon("globe", Modifier.size(Space.S17), tint = Brand) }
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S2)) {
                                    LessonText("공개 수업", color = Palette.TextSecondary, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
                                    LessonText("로그인한 누구나 참여할 수 있어요.", color = Muted, fontSize = Type.Caption)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(Space.S16))
                    val participants = lesson.students.filter { person -> lesson.participants.any { it.userId == person.id } }
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.S12), verticalAlignment = Alignment.CenterVertically) {
                        if (participants.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(-Space.S5)) { participants.take(3).forEach { DesignAvatar(it.name, it.id, Modifier.border(BorderStroke(Space.S2, Palette.White), CircleShape), size = Space.S30) } }
                        LessonText(if (participants.isNotEmpty()) "${participants.size}명이 먼저 참여하고 있어요" else "아직 참여 중인 사람이 없어요", fontSize = Type.Support, color = Muted, lineHeight = Type.Support * 1.5f)
                    }
                    Spacer(Modifier.height(if (wide) Space.S32 else Space.S24)); HorizontalDivider(color = Palette.Line); Spacer(Modifier.height(if (wide) Space.S24 else Space.S16))
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.S12), verticalAlignment = Alignment.CenterVertically) { DesignAvatar(user.name, user.id); Column(verticalArrangement = Arrangement.spacedBy(Space.S4)) { LessonText("다음 계정으로 참여", fontSize = Type.Caption, color = Muted); LessonText("${user.name} ${if (user.isTeacher) "선생님" else "학생"}", fontSize = Type.Body, fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary) } }
                    Spacer(Modifier.height(if (wide) Space.S24 else Space.S16))
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.S16)) { DeviceState(if (microphone) "mic" else "micOff", "마이크 ${if (microphone) "켜짐" else "꺼짐"}"); DeviceState(if (camera) "video" else "videoOff", "카메라 ${if (camera) "켜짐" else "꺼짐"}") }
                    Spacer(Modifier.height(if (wide) Space.S32 else Space.S24))
                    state.error?.let { ErrorCard(it); Spacer(Modifier.height(Space.S12)) }
                    DesignButton(if (state.busy) "입장 확인 중…" else if (lesson.teacher.id == user.id && lesson.status == "SCHEDULED") "수업 시작하기" else "지금 참여하기", { controller.devices(camera, microphone); controller.join() }, Modifier.fillMaxWidth().heightIn(min = Space.S54), enabled = !state.busy, trailingIcon = { DesignIcon("chevron", Modifier.size(Space.S18), tint = Palette.White) }, textStyle = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(Space.S8)); LessonText(if (!microphone && !camera) "카메라와 마이크를 끈 상태로 참여합니다." else "준비가 되면 참여해 주세요.", Modifier.fillMaxWidth(), color = Muted, fontSize = Type.Caption, textAlign = TextAlign.Center)
                }
            }
            if (wide) Row(horizontalArrangement = Arrangement.spacedBy(if (viewportWidth <= LayoutToken.PrejoinCompactBreakpoint) Space.S32 else (viewportWidth * .05f).coerceIn(Space.S40, Space.S64)), verticalAlignment = Alignment.Top) { preview(Modifier.weight(if (viewportWidth <= LayoutToken.PrejoinCompactBreakpoint) 1.2f else 1.45f)); information(if (viewportWidth <= LayoutToken.PrejoinCompactBreakpoint) Modifier.width(LayoutToken.PrejoinInfoMinWidth) else Modifier.weight(.9f)) }
            else Column(verticalArrangement = Arrangement.spacedBy(Space.S24), horizontalAlignment = Alignment.CenterHorizontally) { preview(Modifier.fillMaxWidth()); information(Modifier.widthIn(max = LayoutToken.PrejoinInfoMaxWidth).fillMaxWidth()) }
        }
    }
}
@Composable internal fun PreviewControl(icon: String, label: String, enabled: Boolean, phone: Boolean, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.size(if (phone) Space.S48 else Space.S50), shape = CircleShape, color = if (enabled) Palette.White.copy(alpha = .07f) else Palette.PrejoinControlOff, border = BorderStroke(Space.S1, if (enabled) Palette.PrejoinToggleBorder else Palette.PrejoinControlOff)) {
        Box(contentAlignment = Alignment.Center) { DesignIcon(icon, Modifier.size(ComponentToken.PrejoinControlIconSize), tint = Palette.White, contentDescription = label) }
    }
}
@Composable private fun NativeDeviceLine(icon: String, label: String, modifier: Modifier, enabled: Boolean = true, onClick: (() -> Unit)? = null) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth().heightIn(min = Space.S48).then(if (onClick != null) Modifier.combinedClickable(enabled = enabled, onClick = onClick) else Modifier), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) { DesignIcon(icon, Modifier.size(Space.S19), tint = Muted); LessonText(label, Modifier.weight(1f), fontSize = Type.Support, color = if (enabled) Palette.TextSecondary else Muted, fontWeight = DesignWeight.Medium); if (onClick != null) DesignIcon("chevron", Modifier.size(Space.S16), tint = Muted) }
        HorizontalDivider(color = Palette.Line)
    }
}
@Composable private fun DeviceState(icon: String, label: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Space.S6), verticalAlignment = Alignment.CenterVertically) { DesignIcon(icon, Modifier.size(Space.S17), tint = Muted); LessonText(label, color = Muted, fontSize = Type.Support, fontWeight = DesignWeight.Medium) }
}

@Composable fun WaitingScreen(lesson: Lesson, user: User, state: AppUiState, controller: AppState) {
    val enhanced = controller.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomPrejoin)
    CenteredLessonCard(LayoutToken.WaitingCardMaxWidth, waiting = true) {
        Surface(Modifier.size(ComponentToken.WaitingIconSize), shape = CircleShape, color = Palette.Selection) { Box(contentAlignment = Alignment.Center) { DesignIcon("clock", Modifier.size(Space.S28), tint = Brand) } }
        Spacer(Modifier.height(Space.S24)); SmallBadge("입장 대기 중", selected = true); Spacer(Modifier.height(Space.S16))
        LessonText("곧 수업이 시작돼요", fontSize = Type.Title, fontWeight = DesignWeight.Bold, lineHeight = Type.Title * 1.3462f, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S8))
        LessonText("${lesson.title} · ${lesson.teacher.name} 선생님\n선생님이 수업을 시작할 때까지 잠시 기다려 주세요.", color = Muted, fontSize = Type.Body, lineHeight = Type.Body * 1.5f, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S32))
        Surface(Modifier.fillMaxWidth(), color = Palette.Canvas, shape = RoundedCornerShape(Corner.R8)) { Row(Modifier.padding(Space.S16), horizontalArrangement = Arrangement.spacedBy(Space.S12), verticalAlignment = Alignment.CenterVertically) { DesignAvatar(user.name, user.id, small = true); LessonText("${user.name} ${if (user.isTeacher) "선생님" else "학생"}으로 대기 중", color = Muted, fontSize = Type.Support, fontWeight = DesignWeight.Medium) } }
        Spacer(Modifier.height(Space.S24)); state.error?.let { ErrorCard(it); Spacer(Modifier.height(Space.S12)) }
        DesignButton(if (enhanced) DesignContent.PrejoinRecheck else "카메라·마이크 확인하기", { controller.prejoin(lesson) }, Modifier.fillMaxWidth(), secondary = true, enabled = !state.busy)
        TextButton(controller::home, Modifier.fillMaxWidth().heightIn(min = Space.S48)) { LessonText("대기 나가기", color = Muted, fontSize = Type.Label, fontWeight = DesignWeight.SemiBold) }
    }
}

@Composable fun CreatedLesson(lesson: Lesson, controller: AppState, origin: String) {
    var copied by remember(lesson.id) { mutableStateOf(false) }
    val link = "$origin/join/${lesson.code}"
    CenteredLessonCard {
        Surface(Modifier.size(Space.S48), color = Palette.SuccessSurface, shape = CircleShape) { Box(contentAlignment = Alignment.Center) { DesignIcon("check", Modifier.size(Space.S32), tint = Palette.Success) } }
        Spacer(Modifier.height(Space.S24)); LessonText("예약 완료", color = Brand, fontSize = Type.Caption, fontWeight = DesignWeight.SemiBold); Spacer(Modifier.height(Space.S16))
        LessonText("수업 일정이 저장되었어요", fontSize = Type.Title, fontWeight = DesignWeight.Bold, lineHeight = Type.Title * 1.3462f, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S8))
        LessonText(if (lesson.isOpen) "함께 배우고 싶은 누구나 참여할 수 있어요." else "${invitedPeople(lesson)} 학생을 수업에 초대했어요.", color = Muted, fontSize = Type.Body, lineHeight = Type.Body * 1.5f, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S32))
        Surface(Modifier.fillMaxWidth(), color = Palette.Canvas, shape = RoundedCornerShape(Corner.R8)) {
            Column(Modifier.padding(horizontal = Space.S20, vertical = Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                StatusBadge(lesson.status); LessonText(lesson.title, fontSize = Type.Body, fontWeight = DesignWeight.SemiBold)
                LessonText("${lessonDay(lesson.startsAt)} ${koreanTime(lesson.startsAt)} · ${lessonDuration(lesson)}", color = Muted, fontSize = Type.Support)
                Row(horizontalArrangement = Arrangement.spacedBy(Space.S6), verticalAlignment = Alignment.CenterVertically) { DesignIcon(if (lesson.isOpen) "globe" else "lock", Modifier.size(Space.S15), tint = Brand); LessonText(if (lesson.isOpen) "공개 수업 · 누구나 참여 가능" else "선택한 학생만 참여", color = Brand, fontSize = Type.Caption) }
            }
        }
        Spacer(Modifier.height(Space.S16))
        Surface(Modifier.fillMaxWidth(), color = Palette.Surface, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Corner.R8)) {
            Row(Modifier.padding(horizontal = Space.S16, vertical = Space.S12).combinedClickable(onClick = { copyText(link); copied = true }, onLongClick = { shareLink(link) }, onLongClickLabel = "참여 링크 공유"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S10)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) { LessonText("수업 참여 링크", fontSize = Type.Caption, color = Muted); LessonText(link, fontSize = Type.Caption, fontWeight = DesignWeight.SemiBold, lineHeight = Type.Caption * 1.5f) }
                DesignIcon(if (copied) "check" else "copy", Modifier.size(Space.S20), tint = Brand); LessonText(if (copied) "복사 완료" else "복사", color = Brand, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
            }
        }
        if (copied) { Spacer(Modifier.height(Space.S12)); LessonText("참여 링크를 복사했어요.", color = Palette.Success, fontSize = Type.Support) }
        Spacer(Modifier.height(Space.S24)); DesignButton("일정 보기", controller::detail, Modifier.fillMaxWidth())
        TextButton(controller::home, Modifier.fillMaxWidth().heightIn(min = Space.S48)) { LessonText("홈으로 돌아가기", color = Muted, fontSize = Type.Label, fontWeight = DesignWeight.SemiBold) }
    }
}

fun attendanceText(lesson: Lesson, userId: String): String {
    val seconds = lesson.attendance.filter { it.userId == userId }.sumOf { runCatching { ((it.leftAt?.let(Instant::parse) ?: lesson.endedAt?.let(Instant::parse) ?: Clock.System.now()) - Instant.parse(it.joinedAt)).inWholeSeconds.coerceAtLeast(0) }.getOrDefault(0) }
    return if (seconds > 0) "${seconds / 60}분 ${seconds % 60}초 참여" else "참여 기록 없음"
}
@Composable fun EndedScreen(lesson: Lesson, user: User, state: AppUiState, controller: AppState) {
    val ended = lesson.status == "ENDED"
    val cancelled = lesson.status == "CANCELLED"
    CenteredLessonCard {
        Surface(Modifier.size(Space.S48), color = Palette.Canvas, shape = CircleShape) { Box(contentAlignment = Alignment.Center) { DesignIcon("phone", Modifier.size(Space.S30), tint = Muted) } }
        Spacer(Modifier.height(Space.S24)); SmallBadge(if (cancelled) "수업 취소" else if (ended) "수업 종료 완료" else "수업에서 나감"); Spacer(Modifier.height(Space.S16))
        LessonText(if (cancelled) "취소된 수업이에요" else if (ended) "수업이 모두 종료되었어요" else "수업을 나왔어요", fontSize = Type.Title, lineHeight = Type.Title * 1.3462f, fontWeight = DesignWeight.Bold, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S8))
        LessonText(if (cancelled) "선생님이 이 수업 일정을 취소했습니다." else if (ended && lesson.teacher.id == user.id) "참여 학생에게 종료 안내를 보냈습니다." else if (ended) "선생님이 수업을 종료했어요." else "다른 참여자는 수업을 계속할 수 있어요.", color = Muted, fontSize = Type.Body, lineHeight = Type.Body * 1.5f, textAlign = TextAlign.Center); Spacer(Modifier.height(Space.S32))
        Surface(Modifier.fillMaxWidth(), color = Palette.Canvas, shape = RoundedCornerShape(Corner.R8)) {
            Column(Modifier.padding(horizontal = Space.S20, vertical = Space.S2)) {
                SummaryRow("학습 제목", lesson.title); HorizontalDivider(color = Palette.Line)
                SummaryRow(if (!user.isTeacher) "내 참여 시간" else if (ended) "실제 진행 시간" else "현재까지 진행 시간", elapsedLesson(lesson, user)); HorizontalDivider(color = Palette.Line)
                Row(Modifier.fillMaxWidth().padding(vertical = Space.S14), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S16)) { LessonText("종료 상태", Modifier.weight(1f), fontSize = Type.Support, color = Muted); SmallBadge(if (cancelled) "취소" else if (ended) "정상 종료" else "개인 퇴장") }
            }
        }
        state.error?.let { Spacer(Modifier.height(Space.S12)); ErrorCard(it) }
        Spacer(Modifier.height(Space.S24)); DesignButton("홈으로 돌아가기", controller::home, Modifier.fillMaxWidth())
        if (lesson.canJoin) TextButton({ controller.prejoin(lesson) }, Modifier.fillMaxWidth().heightIn(min = Space.S48)) { LessonText("수업에 다시 참여", color = Muted, fontSize = Type.Label, fontWeight = DesignWeight.SemiBold) }
    }
}
@Composable private fun SummaryRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = Space.S14), horizontalArrangement = Arrangement.spacedBy(Space.S16), verticalAlignment = Alignment.CenterVertically) { LessonText(label, color = Muted, fontSize = Type.Support); LessonText(value, Modifier.weight(1f), textAlign = TextAlign.End, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold, lineHeight = Type.Support * 1.5f) }
}
@Composable private fun CenteredLessonCard(cardWidth: Dp = LayoutToken.StatusCardMaxWidth, waiting: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val phone = maxWidth <= LayoutToken.RootNavigationMobile
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = if (phone) Space.S18 else Space.S24, vertical = if (phone) Space.S28 else Space.S40), horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(Modifier.widthIn(max = cardWidth).fillMaxWidth(), color = Palette.Surface, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(if (waiting) Corner.R14 else ComponentToken.StatusCardRadius)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = if (phone) Space.S26 else Space.S32).padding(top = if (phone) Space.S26 else if (waiting) Space.S32 else Space.S40, bottom = if (phone) Space.S26 else Space.S32), horizontalAlignment = Alignment.CenterHorizontally, content = content)
            }
        }
    }
}
private fun clockText(value: LocalDateTime): String = "${value.hour.toString().padStart(2, '0')}:${value.minute.toString().padStart(2, '0')}"
private fun invitedPeople(lesson: Lesson): String = if (lesson.students.size > 1) "${lesson.students.first().name} 외 ${lesson.students.size - 1}명" else lesson.students.firstOrNull()?.name ?: "초대 학생 없음"
private fun lessonDay(value: String): String = localDateTime(value)?.let { "${it.month.number}월 ${it.day}일" } ?: value
internal fun lessonStartLabel(value: String) = "${lessonDay(value)} ${koreanTime(value)}"
private fun koreanTime(value: String): String = localDateTime(value)?.let { "${if (it.hour >= 12) "오후" else "오전"} ${(it.hour % 12).takeIf { hour -> hour != 0 } ?: 12}:${it.minute.toString().padStart(2, '0')}" } ?: value
private fun lessonDuration(lesson: Lesson): String = lesson.endsAt?.let { end -> runCatching { "${((Instant.parse(end) - Instant.parse(lesson.startsAt)).inWholeSeconds / 60.0).roundToLong()}분" }.getOrNull() } ?: "종료 시간 없음"
private fun lessonTimeRange(lesson: Lesson): String = "${koreanTime(lesson.startsAt)}${lesson.endsAt?.let { " – ${koreanTime(it)}" }.orEmpty()} · ${lessonDuration(lesson)}"
private fun elapsedLesson(lesson: Lesson, user: User): String {
    val intervals = lesson.attendance.filter { it.userId == user.id }
    val personal = !user.isTeacher
    val start = if (personal) intervals.minByOrNull { it.joinedAt }?.joinedAt else lesson.startedAt
    if (start == null) return if (personal) "참여 기록이 없어요" else "수업이 시작되지 않았어요"
    val fallbackFinish = lesson.endedAt ?: Clock.System.now().toString()
    val finish = if (personal) intervals.maxOfOrNull { it.leftAt ?: fallbackFinish } ?: fallbackFinish else fallbackFinish
    val seconds = if (personal) intervals.sumOf { runCatching { (Instant.parse(it.leftAt ?: finish) - Instant.parse(it.joinedAt)).inWholeSeconds.coerceAtLeast(0) }.getOrDefault(0) } else runCatching { (Instant.parse(finish) - Instant.parse(start)).inWholeSeconds.coerceAtLeast(0) }.getOrDefault(0)
    return "${koreanTime(start)} – ${koreanTime(finish)} · ${(seconds / 60.0).roundToLong()}분"
}

/** CSS line-height scales with the chosen font size rather than the ambient body style. */
@Composable
internal fun LessonText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = Type.Body,
    fontWeight: FontWeight? = null,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = fontSize * 1.5f,
) {
    Text(text, modifier, color = color, fontSize = fontSize, fontWeight = fontWeight,
        textAlign = textAlign, lineHeight = lineHeight,
        letterSpacing = (if (fontWeight == DesignWeight.Bold && (fontSize == Type.Title || fontSize == Type.Display)) -.025f else -.02f).em)
}
