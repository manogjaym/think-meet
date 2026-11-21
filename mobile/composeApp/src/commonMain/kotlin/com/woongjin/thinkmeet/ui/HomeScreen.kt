package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.woongjin.thinkmeet.data.ClassNoteLesson
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component as ComponentToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.design.generated.DesignTokens.LineHeight as Leading
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import kotlinx.coroutines.launch
import kotlinx.datetime.number
import kotlinx.datetime.toLocalDateTime
import kotlin.math.roundToInt
import kotlin.time.Clock
import kotlin.time.Instant

/** Native rendering of the same dashboard sections and breakpoints as web Home/home.css. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(state: AppUiState, controller: AppState, onWorksheetCamera: (ClassNoteLesson) -> Unit) {
    val capabilities = controller.capabilities.collectAsState().value
    val student = state.user?.takeIf { it.role == "student" }
    if (student != null) {
        val noteLessons = remember(state.lessons) { state.lessons.map { Triple(it.id, it.status, it.startsAt) } }
        ClassNotesHome(controller.api, noteLessons, capabilities.supports("classroom.notes"), controller::notes, onWorksheetCamera) { noteCard ->
            DashboardBody(state, controller, noteCard)
        }
    } else DashboardBody(state, controller)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DashboardBody(state: AppUiState, controller: AppState, noteCard: (@Composable () -> Unit)? = null) {
    val subjectsEnabled = controller.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomSubjects)
    var tab by rememberSaveable { mutableStateOf("upcoming") }
    var search by rememberSaveable { mutableStateOf("") }
    var selectedLiveId by rememberSaveable { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var codeError by remember { mutableStateOf<String?>(null) }
    var submittedCode by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(state.busy) { if (!state.busy) refreshing = false }
    val scroll = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val live = remember(state.lessons) { state.lessons.filter { it.status == "LIVE" } }
    val upcoming = remember(state.lessons) { state.lessons.filter { it.status == "SCHEDULED" }.sortedBy { it.startsAt } }
    val history = remember(state.lessons) { state.lessons.filter { it.status in listOf("ENDED", "CANCELLED") }.sortedByDescending { it.startsAt } }
    val featured = live.firstOrNull { it.id == selectedLiveId } ?: live.firstOrNull()
    val filtered = remember(live, upcoming, history, tab, search) {
        (when (tab) { "live" -> live; "history" -> history; else -> upcoming }).filter {
            "${it.title} ${lessonPeople(it)} ${it.students.joinToString(" ") { student -> student.name }} ${if (it.isOpen) "공개 수업" else ""}"
                .contains(search.trim(), ignoreCase = true)
        }
    }
    val submitCode: () -> Unit = {
        if (code.trim().length < 6) codeError = "6자 이상의 코드나 수업 링크를 입력해 주세요."
        else if (!state.busy) { codeError = null; submittedCode = true; controller.joinCode(code.trim()) }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val viewport = maxWidth
        val compact = viewport <= LayoutToken.DashboardCompact
        val featureWide = viewport > LayoutToken.DashboardFeatureWide
        val large = viewport >= LayoutToken.DashboardLarge
        val gutter = when { compact -> Space.S20; !featureWide -> Space.S24; viewport <= LayoutToken.DashboardIntermediate -> Space.S28; else -> Space.S40 }
        val top = when { large -> Space.S44; compact -> Space.S24; viewport <= LayoutToken.DashboardIntermediate -> Space.S28; else -> Space.S32 }
        val gap = if (compact) Space.S12 else if (viewport <= LayoutToken.DashboardIntermediate) Space.S16 else Space.S20
        PullToRefreshBox(isRefreshing = refreshing && state.busy, onRefresh = { if (!state.busy) { refreshing = true; controller.reload() } }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(state = scroll,
                modifier = Modifier.fillMaxHeight().widthIn(max = LayoutToken.DashboardMaxWidth).fillMaxWidth().align(Alignment.TopCenter),
                contentPadding = PaddingValues(start = gutter, end = gutter, top = top, bottom = if (compact) Space.S32 else Space.S40)) {
                item(key = "heading") {
                    DashboardHeading(state, compact, featureWide) { controller.form() }
                    Spacer(Modifier.height(if (compact) Space.S24 else if (large) Space.S32 else Space.S28))
                }
                item(key = "features") {
                    val session: @Composable (Modifier) -> Unit = { modifier ->
                        SessionFeature(featured, featured?.subject?.name.takeIf { subjectsEnabled }, upcoming.size, state, compact, featureWide, large, modifier,
                            onJoin = controller::prejoin, onSchedule = { scope.launch { scroll.animateScrollToItem(2) } })
                    }
                    val quick: @Composable (Modifier) -> Unit = { modifier ->
                        val join: @Composable (Modifier) -> Unit = { joinModifier ->
                            QuickJoin(code, { code = it; codeError = null; submittedCode = false }, codeError ?: state.error?.takeIf { submittedCode },
                                !state.busy, !compact && !featureWide, featureWide, compact, large, joinModifier, submitCode)
                        }
                        if (noteCard != null) Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
                            noteCard()
                            join(Modifier.fillMaxWidth())
                        } else join(modifier)
                    }
                    if (featureWide) Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(gap)) {
                        if (viewport <= LayoutToken.DashboardIntermediate) {
                            session(Modifier.weight(1f).fillMaxHeight())
                            quick(Modifier.width(ComponentToken.DashboardQuickJoinWidth).fillMaxHeight())
                        } else { session(Modifier.weight(1.8f).fillMaxHeight()); quick(Modifier.weight(1f).fillMaxHeight()) }
                    } else Column(verticalArrangement = Arrangement.spacedBy(gap)) { session(Modifier.fillMaxWidth()); quick(Modifier.fillMaxWidth()) }
                }
                item(key = "schedule") {
                    Spacer(Modifier.height(if (!featureWide) Space.S28 else Space.S32))
                    ScheduleToolbar(tab, search, listOf(live.size, upcoming.size, history.size), compact, { tab = it }, { search = it })
                }
                if (!compact && filtered.isNotEmpty()) item(key = "columns") { DashboardColumns(viewport, Modifier.listBoundary(first = true, last = false)) }
                if (filtered.isEmpty()) item(key = "empty") { DashboardEmpty(tab, search) { search = "" } }
                itemsIndexed(filtered, key = { _, lesson -> lesson.id }) { index, lesson ->
                    DashboardLessonRow(lesson, lesson.subject?.name.takeIf { subjectsEnabled }, viewport, compact, lesson.status == "LIVE" && lesson.id == featured?.id, !state.busy,
                        Modifier.listBoundary(first = compact && index == 0, last = index == filtered.lastIndex)) {
                        if (lesson.status == "LIVE") { selectedLiveId = lesson.id; scope.launch { scroll.animateScrollToItem(1) } }
                        else controller.open(lesson)
                    }
                }
            }
        }
    }
}

@Composable
private fun DashboardHeading(state: AppUiState, compact: Boolean, showToday: Boolean, onReserve: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S16 else Space.S24)) {
        Column(Modifier.weight(1f)) {
            Text("${state.user?.name.orEmpty()} ${if (state.user?.isTeacher == true) "선생님" else "학생"}의 클래스", style = homeText(if (compact) Type.Caption else Type.Support, DesignWeight.Medium), color = Muted)
            Spacer(Modifier.height(Space.S5))
            Text(DesignContent.HomeTitle, style = homeText(if (compact) Type.Title else Type.Display, DesignWeight.Bold, if (compact) Leading.Title else Leading.Display), color = Ink)
        }
        if (showToday) Row(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalAlignment = Alignment.CenterVertically) {
            DesignIcon("calendar", Modifier.size(Space.S16), tint = Muted)
            Text(todayLabel(), style = homeText(Type.Support), color = Muted)
        }
        if (state.user?.isTeacher == true) DashboardAction("새 수업 예약", onReserve, !state.busy,
            fontSize = if (compact) Type.Support else Type.Label, horizontalPadding = if (compact) Space.S12 else Space.S18,
            icon = { DesignIcon("plus", Modifier.size(Space.S18), tint = Palette.White) })
    }
}

@Composable
private fun SessionFeature(lesson: Lesson?, subjectName: String?, upcoming: Int, state: AppUiState, compact: Boolean, featureWide: Boolean, large: Boolean,
    modifier: Modifier, onJoin: (Lesson) -> Unit, onSchedule: () -> Unit) {
    val px = when { compact -> Space.S20; large -> Space.S32; featureWide -> Space.S24; else -> Space.S28 }
    val py = if (large) Space.S28 else if (compact) Space.S20 else Space.S24
    val minHeight = when { large -> ComponentToken.DashboardSessionLargeHeight; !compact && !featureWide -> ComponentToken.DashboardSessionTabletHeight; else -> ComponentToken.DashboardSessionHeight }
    val joined = lesson?.students.orEmpty().filter { person -> lesson?.participants?.any { it.userId == person.id } == true }
    Surface(modifier, shape = RoundedCornerShape(ComponentToken.CardRadius), color = Ink, border = BorderStroke(Space.S1, Ink)) {
        Column(Modifier.heightIn(min = minHeight).padding(horizontal = px, vertical = py)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S16), verticalAlignment = Alignment.CenterVertically) {
                if (lesson != null) Surface(shape = RoundedCornerShape(Corner.R5), color = Palette.White.copy(alpha = 13f / 255f), border = BorderStroke(Space.S1, Palette.White.copy(alpha = 21f / 255f))) {
                    Row(Modifier.padding(horizontal = Space.S8, vertical = Space.S4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                        Box(Modifier.size(Space.S5).background(Palette.SessionLiveDot, CircleShape))
                        Text("진행 중", style = homeText(Type.Caption, DesignWeight.SemiBold), color = Palette.SessionLiveText)
                    }
                } else Row(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalAlignment = Alignment.CenterVertically) {
                    DesignIcon("video", Modifier.size(Space.S17), tint = Palette.LineInput)
                    Text("나의 클래스룸", style = homeText(Type.Support, DesignWeight.Medium), color = Palette.LineInput)
                }
                Spacer(Modifier.weight(1f))
                if (lesson == null) Text("${upcoming}개의 예정 수업", style = homeText(if (compact) Type.Caption else Type.Support), color = Palette.LineInput)
                else Row(horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S5 else Space.S7), verticalAlignment = Alignment.CenterVertically) {
                    DesignIcon("clock", Modifier.size(Space.S15), tint = Palette.LineInput)
                    Text(koreanTime(lesson.startsAt), style = homeText(if (compact) Type.Caption else Type.Support), color = Palette.LineInput)
                    Text("·", style = homeText(Type.Caption), color = Palette.LineInput.copy(alpha = .6f))
                    Text(lessonDuration(lesson), style = homeText(if (compact) Type.Caption else Type.Support), color = Palette.LineInput)
                }
            }
            Column(Modifier.padding(top = if (compact || !featureWide) Space.S20 else Space.S24 - Space.S1, bottom = if (compact || !featureWide) Space.S24 else Space.S26)) {
                if (lesson?.isOpen == true) Row(horizontalArrangement = Arrangement.spacedBy(Space.S7), verticalAlignment = Alignment.CenterVertically) {
                    DesignIcon("globe", Modifier.size(Space.S15), tint = Palette.LineInput)
                    Text("공개 수업 · 누구나 참여 가능", style = homeText(Type.Support, DesignWeight.Medium), color = Palette.LineInput)
                } else {
                    val subtitle = if (lesson == null) "다음 만남을 준비하는 시간" else subjectName
                    subtitle?.let { Text(it, style = homeText(Type.Support, DesignWeight.Medium), color = Palette.LineInput) }
                }
                Spacer(Modifier.height(Space.S6))
                Text(lesson?.title ?: "지금 진행 중인 수업이 없어요", style = homeText(Type.Title, DesignWeight.Bold, Leading.Title), color = Palette.White)
                Spacer(Modifier.height(Space.S8))
                Text(lesson?.let { "${it.teacher.name} 선생님과 함께하는 화상 수업" } ?: "예정된 수업을 확인하거나 수업 링크로 참여하세요.", style = homeText(Type.Support), color = Palette.LineInput)
            }
            if (lesson != null) Spacer(Modifier.weight(1f))
            if (lesson == null) Row(Modifier.heightIn(min = Space.S44).clickable(role = Role.Button, onClick = onSchedule), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S5)) {
                Text("수업 일정 확인", style = homeText(Type.Support, DesignWeight.SemiBold), color = Palette.Line)
                DesignIcon("chevron", Modifier.size(Space.S16), tint = Palette.Line)
            } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S10 else Space.S16), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S7 else Space.S10)) {
                    if (joined.isNotEmpty()) {
                        val avatarSize = if (compact) Space.S24 else Space.S28
                        val shown = joined.take(3)
                        Box(Modifier.width(avatarSize + (avatarSize - Space.S6) * (shown.size - 1)).height(avatarSize)) {
                            shown.forEachIndexed { index, person -> DesignAvatar(person.name, person.id, size = avatarSize, small = true,
                                modifier = Modifier.offset(x = (avatarSize - Space.S6) * index).drawWithContent { drawContent(); drawCircle(Ink, size.minDimension / 2 - Space.S1.toPx(), style = Stroke(Space.S2.toPx())) }) }
                        }
                    }
                    Text("${joined.size}명 참여 중${if (!compact && !lesson.isOpen) " / ${lesson.students.size}명" else ""}", style = homeText(if (compact) Type.Caption else Type.Support), color = Palette.Line)
                }
                DashboardAction(if (lesson.teacher.id == state.user?.id) "수업으로 돌아가기" else "수업 참여", { onJoin(lesson) }, !state.busy,
                    background = Palette.White, contentColor = Ink, fontSize = if (compact) Type.Support else Type.Label,
                    horizontalPadding = if (compact) Space.S12 else Space.S16, trailing = { DesignIcon("chevron", Modifier.size(Space.S18), tint = Ink) })
            }
        }
    }
}

@Composable
private fun QuickJoin(code: String, onCode: (String) -> Unit, error: String?, enabled: Boolean, horizontal: Boolean,
    showIcon: Boolean, compact: Boolean, large: Boolean, modifier: Modifier, onSubmit: () -> Unit) {
    val padding = if (compact || horizontal) Space.S20 else if (large) Space.S28 else Space.S24
    Surface(modifier, shape = RoundedCornerShape(ComponentToken.CardRadius), color = Palette.White, border = BorderStroke(Space.S1, Palette.Line)) {
        Column(Modifier.padding(padding)) {
            val copy: @Composable (Modifier) -> Unit = { copyModifier ->
                Column(copyModifier) {
                    if (showIcon) {
                        Box(Modifier.size(Space.S32).background(Palette.Selection, RoundedCornerShape(Corner.R8)), contentAlignment = Alignment.Center) { DesignIcon("link", Modifier.size(Space.S19), tint = Brand) }
                        Spacer(Modifier.height(Space.S14))
                    }
                    Text(DesignContent.QuickJoinTitle, style = homeText(Type.Heading, DesignWeight.Bold, Leading.Heading), color = Palette.TextSecondary)
                    Spacer(Modifier.height(Space.S5))
                    Text(DesignContent.QuickJoinDescription, style = homeText(Type.Support), color = Muted)
                }
            }
            if (horizontal) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S24), verticalAlignment = Alignment.CenterVertically) {
                copy(Modifier.weight(1f)); JoinCodeField(code, onCode, enabled, error != null, Modifier.weight(1f), onSubmit)
            } else { copy(Modifier.fillMaxWidth()); Spacer(Modifier.height(if (compact) Space.S16 else Space.S18)); JoinCodeField(code, onCode, enabled, error != null, Modifier.fillMaxWidth(), onSubmit) }
            if (error != null) Text(error, Modifier.padding(top = Space.S7), style = homeText(Type.Support), color = Palette.Danger)
            Spacer(Modifier.weight(1f))
            Row(Modifier.padding(top = if (compact) Space.S12 else if (horizontal) Space.S10 else Space.S18), horizontalArrangement = Arrangement.spacedBy(Space.S7), verticalAlignment = Alignment.Top) {
                DesignIcon("video", Modifier.padding(top = Space.S2).size(Space.S15), tint = Muted)
                Text("입장 전에 카메라와 마이크를 확인할 수 있어요.", style = homeText(Type.Caption), color = Muted)
            }
        }
    }
}

@Composable
private fun JoinCodeField(code: String, onCode: (String) -> Unit, enabled: Boolean, error: Boolean, modifier: Modifier, onSubmit: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val canSubmit = enabled && code.isNotBlank()
    Row(modifier.heightIn(min = ComponentToken.InputHeight).clip(RoundedCornerShape(ComponentToken.DashboardControlRadius)).background(Palette.White)
        .inputBorder(focused, error, Palette.LineInput), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(code, onCode, Modifier.weight(1f).padding(Space.S12).onFocusChanged { focused = it.isFocused }.semantics { contentDescription = "수업 코드 또는 링크" },
            enabled = enabled, singleLine = true, textStyle = homeText(Type.Support).copy(color = Palette.TextSecondary), cursorBrush = SolidColor(Brand),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (enabled) onSubmit() }),
            decorationBox = { inner -> Box { if (code.isEmpty()) Text(DesignContent.QuickJoinPlaceholder, style = homeText(Type.Support), color = Muted); inner() } })
        Box(Modifier.width(Space.S48).height(ComponentToken.InputHeight).alpha(if (canSubmit) 1f else .45f).background(Canvas).clickable(enabled = canSubmit, role = Role.Button, onClick = onSubmit)
            .semantics { contentDescription = "입장 준비" }, contentAlignment = Alignment.Center) {
            DesignIcon("chevron", Modifier.size(Space.S18), tint = Brand)
        }
    }
}

@Composable
private fun ScheduleToolbar(tab: String, search: String, counts: List<Int>, compact: Boolean, onTab: (String) -> Unit, onSearch: (String) -> Unit) {
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
        Text(DesignContent.ScheduleTitle, style = homeText(Type.Heading, DesignWeight.Bold, Leading.Heading), color = Palette.TextSecondary)
        if (!compact) Text(when (tab) { "live" -> "수업을 선택하면 상단에서 확인할 수 있어요"; "history" -> "함께한 수업을 확인하세요"; else -> "다가오는 수업을 미리 준비하세요" }, style = homeText(Type.Support), color = Muted)
    }
    Spacer(Modifier.height(if (compact) Space.S12 else Space.S16))
    val tabs: @Composable () -> Unit = {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S4)) {
            listOf("live" to DesignContent.LiveTab, "upcoming" to DesignContent.UpcomingTab, "history" to DesignContent.HistoryTab).forEachIndexed { index, (value, title) ->
                Row(Modifier.heightIn(min = Space.S48).clip(RoundedCornerShape(ComponentToken.DashboardControlRadius)).background(if (tab == value) Palette.Selection else Color.Transparent)
                    .clickable(role = Role.Tab, onClick = { onTab(value) }).semantics { selected = tab == value }.padding(horizontal = Space.S12),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S7)) {
                    Text(title, style = homeText(Type.Label, if (tab == value) DesignWeight.SemiBold else DesignWeight.Medium), color = if (tab == value) Palette.PrimaryPressed else Muted)
                    Text(counts[index].toString(), style = homeText(Type.Caption, DesignWeight.Medium), color = if (tab == value) Palette.PrimaryPressed else Muted)
                }
            }
        }
    }
    if (compact) Column(verticalArrangement = Arrangement.spacedBy(Space.S12)) { tabs(); SearchField(search, onSearch, Modifier.fillMaxWidth(), true) }
    else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { tabs(); SearchField(search, onSearch, Modifier.width(ComponentToken.DashboardSearchWidth), false) }
    Spacer(Modifier.height(Space.S12))
}

@Composable
private fun SearchField(search: String, onSearch: (String) -> Unit, modifier: Modifier, compact: Boolean) {
    var focused by remember { mutableStateOf(false) }
    Row(modifier.heightIn(min = if (compact) Space.S48 else Space.S44).background(Palette.White, RoundedCornerShape(ComponentToken.DashboardControlRadius))
        .inputBorder(focused, false, Palette.Line).padding(horizontal = Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
        DesignIcon("search", Modifier.size(Space.S17), tint = Muted)
        BasicTextField(search, onSearch, Modifier.weight(1f).padding(vertical = Space.S10).onFocusChanged { focused = it.isFocused }.semantics { contentDescription = "수업 검색" },
            singleLine = true, textStyle = homeText(Type.Support).copy(color = Palette.TextSecondary), cursorBrush = SolidColor(Brand), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            decorationBox = { inner -> Box { if (search.isEmpty()) Text("수업명, 학생 이름 검색", style = homeText(Type.Support), color = Muted); inner() } })
        if (search.isNotEmpty()) Box(Modifier.width(Space.S30).height(Space.S42).clickable(role = Role.Button, onClick = { onSearch("") }).semantics { contentDescription = "검색어 지우기" }, contentAlignment = Alignment.Center) {
            DesignIcon("close", Modifier.size(Space.S16), tint = Muted)
        }
    }
}

private fun Modifier.inputBorder(focused: Boolean, error: Boolean, color: Color) = drawWithContent {
    drawContent()
    val width = (if (focused) Space.S2 else Space.S1).toPx()
    drawRoundRect(if (error) Palette.Danger else if (focused) Palette.PrimarySoft else color,
        Offset(width / 2, width / 2), Size(size.width - width, size.height - width), CornerRadius(ComponentToken.DashboardControlRadius.toPx()), style = Stroke(width))
}

@Composable
private fun DashboardColumns(viewport: Dp, modifier: Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth().background(Palette.Line)) {
        val c = dashboardColumns(maxWidth, viewport)
        Row(Modifier.fillMaxWidth().heightIn(min = Space.S44).padding(horizontal = c.padding), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(c.gap)) {
            listOf("날짜 및 시간" to c.date, "수업" to c.lesson, "참여 학생" to c.people, "상태" to c.status).forEach { (text, width) -> Text(text, Modifier.width(width), style = homeText(Type.Caption, DesignWeight.SemiBold), color = Palette.TextSecondary) }
            Spacer(Modifier.width(c.chevron))
        }
    }
}

@Composable
private fun DashboardLessonRow(lesson: Lesson, subjectName: String?, viewport: Dp, compact: Boolean, selected: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth().background(if (selected) Palette.Selection else Palette.White).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { this.selected = selected }) {
        val c = dashboardColumns(maxWidth, viewport)
        if (selected) Box(Modifier.matchParentSize().drawWithContent { drawRect(Brand, size = Size(Space.S3.toPx(), size.height)) })
        Row(Modifier.fillMaxWidth().heightIn(min = if (compact) ComponentToken.DashboardLessonCompactRowHeight else ComponentToken.DashboardLessonRowHeight)
            .padding(horizontal = if (compact) Space.S16 else c.padding, vertical = if (compact) Space.S12 else Space.S8), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S12 else c.gap)) {
            Column(Modifier.width(if (compact) ComponentToken.DashboardMobileDateWidth else c.date), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                Text(koreanDate(lesson.startsAt), style = homeText(if (compact) Type.Support else Type.Label, DesignWeight.SemiBold), color = Palette.TextSecondary)
                Text(koreanTime(lesson.startsAt), style = homeText(if (compact) Type.Caption else Type.Support), color = Muted)
            }
            Column(if (compact) Modifier.weight(1f) else Modifier.width(c.lesson), verticalArrangement = Arrangement.spacedBy(Space.S5)) {
                Text(lesson.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = homeText(Type.Body, DesignWeight.SemiBold), color = if (selected) Palette.PrimaryPressed else Palette.TextSecondary)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S5 else Space.S7), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                    val size = if (compact) Type.Caption else Type.Support
                    if (lesson.isOpen) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S4)) {
                            DesignIcon("globe", Modifier.size(Space.S13), tint = Palette.PrimaryPressed)
                            Text("공개 수업", style = homeText(size, DesignWeight.Medium), color = Palette.PrimaryPressed)
                        }
                        Text("·", style = homeText(size), color = Muted)
                    }
                    if (subjectName != null) {
                        Text(subjectName, style = homeText(size), color = Muted)
                        Text("·", style = homeText(size), color = Muted)
                    }
                    Text(lessonDuration(lesson), style = homeText(size), color = Muted)
                }
            }
            if (!compact) {
                Row(Modifier.width(c.people), horizontalArrangement = Arrangement.spacedBy(Space.S9), verticalAlignment = Alignment.CenterVertically) {
                    if (lesson.isOpen) Box(Modifier.size(Space.S25).background(Palette.Selection, CircleShape), contentAlignment = Alignment.Center) { DesignIcon("globe", Modifier.size(Space.S16), tint = Brand) }
                    else if (viewport > LayoutToken.DashboardFeatureWide) { val first = lesson.students.firstOrNull(); DesignAvatar(first?.name ?: "초대 학생 없음", first?.id.orEmpty(), size = Space.S25, small = true) }
                    Text(lessonPeople(lesson), maxLines = 1, overflow = TextOverflow.Ellipsis, style = homeText(Type.Support), color = Muted)
                }
                Row(Modifier.width(c.status), horizontalArrangement = Arrangement.spacedBy(Space.S5), verticalAlignment = Alignment.CenterVertically) {
                    val cancelled = lesson.status == "CANCELLED"
                    Box(Modifier.size(Space.S4).background(if (cancelled) Palette.LineInput else Palette.PrimarySoft, CircleShape))
                    Text(statusText(lesson.status), style = homeText(Type.Caption, DesignWeight.Medium), color = if (cancelled) Muted else Palette.PrimaryPressed)
                }
            }
            DesignIcon(if (selected) "check" else "chevron", Modifier.size(if (compact) Space.S14 else c.chevron), tint = if (selected) Palette.PrimaryPressed else Palette.LineInput)
        }
    }
}

private data class DashboardColumns(val date: Dp, val lesson: Dp, val people: Dp, val status: Dp, val chevron: Dp, val gap: Dp, val padding: Dp)
private fun dashboardColumns(width: Dp, viewport: Dp): DashboardColumns {
    val intermediate = viewport <= LayoutToken.DashboardIntermediate
    val tablet = viewport <= LayoutToken.DashboardFeatureWide
    val padding = if (tablet) Space.S18 else if (intermediate) Space.S20 else Space.S24
    val gap = if (tablet) Space.S14 else if (intermediate) Space.S20 else Space.S24
    val status = if (tablet) Space.S42 else if (intermediate) Space.S50 else Space.S64
    val chevron = if (tablet) Space.S14 else Space.S16
    val flexible = (width - padding * 2 - gap * 4 - status - chevron).coerceAtLeast(0.dp)
    return when {
        tablet -> { val date = Space.S96 + Space.S4; val rest = (flexible - date).coerceAtLeast(0.dp); DashboardColumns(date, rest * (1.4f / 2.4f), rest / 2.4f, status, chevron, gap, padding) }
        intermediate -> { val date = Space.S96 + Space.S16; val rest = (flexible - date).coerceAtLeast(0.dp); DashboardColumns(date, rest * (2f / 3f), rest / 3f, status, chevron, gap, padding) }
        else -> DashboardColumns(flexible * (.8f / 3.9f), flexible * (2f / 3.9f), flexible * (1.1f / 3.9f), status, chevron, gap, padding)
    }
}

/** A continuous border across lazy rows avoids doubled dividers and composing offscreen lessons. */
private fun Modifier.listBoundary(first: Boolean, last: Boolean): Modifier = clip(RoundedCornerShape(
    topStart = if (first) Corner.R10 else 0.dp, topEnd = if (first) Corner.R10 else 0.dp,
    bottomStart = if (last) Corner.R10 else 0.dp, bottomEnd = if (last) Corner.R10 else 0.dp)).drawWithContent {
    drawContent()
    val half = Space.S1.toPx() / 2; val radius = Corner.R10.toPx(); val right = size.width - half; val bottom = size.height - half
    val path = Path().apply {
        moveTo(half, if (first) radius else 0f); lineTo(half, if (last) bottom - radius else bottom)
        if (last) quadraticTo(half, bottom, radius, bottom)
        lineTo(if (last) right - radius else right, bottom)
        if (last) quadraticTo(right, bottom, right, bottom - radius)
        lineTo(right, if (first) radius else 0f)
        if (first) { quadraticTo(right, half, right - radius, half); lineTo(radius, half); quadraticTo(half, half, half, radius) }
    }
    drawPath(path, Palette.Line, style = Stroke(Space.S1.toPx()))
}

@Composable
private fun DashboardEmpty(tab: String, search: String, onClear: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), color = Palette.White, shape = RoundedCornerShape(Corner.R10), border = BorderStroke(Space.S1, Palette.Line)) {
        Column(Modifier.fillMaxWidth().heightIn(min = Space.S96 * 2 + Space.S28).padding(Space.S24), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            DesignIcon(if (search.isNotBlank()) "search" else "calendar", Modifier.size(Space.S26), tint = Muted)
            Spacer(Modifier.height(Space.S16))
            Text(if (search.isNotBlank()) "검색된 수업이 없어요" else when (tab) { "live" -> "지금 진행 중인 수업이 없어요"; "history" -> "아직 지난 수업이 없어요"; else -> "예정된 수업이 없어요" }, style = homeText(Type.Body, DesignWeight.SemiBold), color = Palette.TextSecondary)
            Spacer(Modifier.height(Space.S8))
            Text(if (search.isNotBlank()) "다른 수업명이나 학생 이름으로 검색해 주세요." else if (tab == "live") "수업이 시작되면 이곳에서 선택할 수 있어요." else "새로운 수업이 등록되면 이곳에 표시됩니다.", style = homeText(Type.Support), color = Muted, textAlign = TextAlign.Center)
            if (search.isNotBlank()) TextButton(onClear, Modifier.heightIn(min = Space.S44).padding(top = Space.S4)) { Text("전체 수업 보기", style = homeText(Type.Support, DesignWeight.SemiBold), color = Brand) }
        }
    }
}

@Composable
private fun DashboardAction(text: String, onClick: () -> Unit, enabled: Boolean, background: Color = Brand, contentColor: Color = Palette.White,
    fontSize: TextUnit = Type.Label, horizontalPadding: Dp = Space.S18, icon: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    Surface(onClick = onClick, enabled = enabled, color = background, contentColor = contentColor, border = BorderStroke(Space.S1, background), shape = RoundedCornerShape(ComponentToken.DashboardControlRadius)) {
        Row(Modifier.heightIn(min = ComponentToken.ButtonHeight).padding(horizontal = horizontalPadding), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (fontSize == Type.Support) Space.S6 else Space.S8)) {
            icon?.invoke(); Text(text, style = homeText(fontSize, DesignWeight.SemiBold), color = contentColor.copy(alpha = if (enabled) 1f else .45f)); trailing?.invoke()
        }
    }
}

@Composable
private fun homeText(size: TextUnit, weight: FontWeight = DesignWeight.Regular, height: TextUnit = size * 1.5f): TextStyle = LocalTextStyle.current.copy(fontSize = size, lineHeight = height, fontWeight = weight, letterSpacing = size * if (weight == DesignWeight.Bold && (size == Type.Title || size == Type.Display)) -.025f else -.02f)
private fun lessonPeople(lesson: Lesson): String = when { lesson.isOpen -> "누구나 참여 가능"; lesson.students.size > 1 -> "${lesson.students.first().name} 외 ${lesson.students.size - 1}명"; else -> lesson.students.firstOrNull()?.name ?: "초대 학생 없음" }
private fun lessonDuration(lesson: Lesson): String = lesson.endsAt?.let { end -> runCatching { "${((Instant.parse(end) - Instant.parse(lesson.startsAt)).inWholeSeconds / 60f).roundToInt()}분" }.getOrNull() } ?: "종료 시간 없음"
private fun koreanDate(value: String): String = localDateTime(value)?.let { "${it.month.number}월 ${it.day}일" } ?: value
private fun koreanTime(value: String): String = localDateTime(value)?.let { "${if (it.hour < 12) "오전" else "오후"} ${if (it.hour % 12 == 0) 12 else it.hour % 12}:${it.minute.toString().padStart(2, '0')}" } ?: ""
private fun todayLabel(): String = Clock.System.now().toLocalDateTime(Seoul).date.let { "${it.month.number}월 ${it.day}일 ${listOf("월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일")[it.dayOfWeek.ordinal]}" }

/** The same status tones as web .badge/.badge-live. Public for detail and prejoin screens. */
@Composable
fun StatusBadge(status: String) {
    val background = when (status) { "LIVE" -> Palette.LiveSuccessBackground; "SCHEDULED" -> Palette.Selection; else -> Canvas }
    val color = when (status) { "LIVE" -> Palette.LiveSuccessText; "SCHEDULED" -> Palette.PrimaryPressed; else -> Muted }
    Surface(color = background, shape = RoundedCornerShape(Corner.R5)) {
        Row(Modifier.padding(horizontal = Space.S9, vertical = Space.S5), horizontalArrangement = Arrangement.spacedBy(Space.S6), verticalAlignment = Alignment.CenterVertically) {
            Text(statusText(status), style = homeText(Type.Caption, DesignWeight.SemiBold), color = color)
        }
    }
}
