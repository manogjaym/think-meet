package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.design.Brand
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignContent as Copy
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout
import com.woongjin.thinkmeet.design.generated.DesignTokens.LineHeight as Leading
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.platform.NoteDraft
import com.woongjin.thinkmeet.platform.RecordingPlayerDialog
import kotlin.time.Instant
import com.woongjin.thinkmeet.platform.decodeNoteImage
import com.woongjin.thinkmeet.platform.rememberNoteImagePicker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.number
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock

enum class NotesTab { Worksheets, Records }
private val SeoulZone = TimeZone.of("Asia/Seoul")
private val weekdays = listOf("월", "화", "수", "목", "금", "토", "일")
private fun today() = Clock.System.now().toLocalDateTime(SeoulZone).date
private fun date(value: String) = checkNotNull(localDateTime(value)).date
private fun dateLabel(value: String) = date(value).let { "${it.month.number}월 ${it.day}일 (${weekdays[it.dayOfWeek.ordinal]})" }
private fun message(error: Throwable): String {
    if (error is CancellationException) throw error
    return error.message ?: "요청을 처리하지 못했어요. 다시 시도해 주세요."
}
private val PillShape = RoundedCornerShape(percent = 50)

@Composable
internal fun NoteCard(modifier: Modifier = Modifier, title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier, color = Palette.White, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Component.CardRadius)) {
        Column(Modifier.fillMaxWidth().padding(Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = DesignWeight.Bold, color = Palette.TextSecondary)
            content()
        }
    }
}

/** Web .note-round: a 36 dp circular icon button on the canvas color. */
@Composable
private fun RoundButton(icon: String, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(onClick = onClick, enabled = enabled, shape = CircleShape, color = Palette.Canvas, modifier = Modifier.size(Space.S36).alpha(if (enabled) 1f else .4f)) {
        Box(contentAlignment = Alignment.Center) { DesignIcon(icon, Modifier.size(18.dp), Palette.TextSecondary, label) }
    }
}

@Composable
internal fun NoteDialog(title: String, busy: Boolean = false, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (!busy) onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(Space.S20), contentAlignment = Alignment.Center) {
            val maxDialogHeight = maxHeight
            val padding = if (maxWidth <= Layout.DashboardCompact) Space.S16 else Space.S24
            Surface(Modifier.widthIn(max = Layout.PrejoinWide).fillMaxWidth().heightIn(max = maxDialogHeight),
                color = Palette.White, contentColor = Palette.TextSecondary, shape = RoundedCornerShape(Component.DialogRadius)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(padding), verticalArrangement = Arrangement.spacedBy(Space.S16)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                        Text(title, Modifier.weight(1f), fontSize = Type.Dialog, lineHeight = Leading.Dialog, fontWeight = DesignWeight.Bold, color = Palette.Ink)
                        RoundButton("close", "닫기", enabled = !busy, onClick = onClose)
                    }
                    content()
                }
            }
        }
    }
}

@Composable
internal fun NotePreview(bytes: ByteArray, label: String) {
    val bitmap by produceState<ImageBitmap?>(null, bytes) { value = withContext(Dispatchers.Default) { decodeNoteImage(bytes) } }
    bitmap?.let {
        Image(it, label, Modifier.fillMaxWidth().heightIn(max = Layout.DashboardCompact).clip(RoundedCornerShape(Radius.R12)).background(Palette.Canvas),
            contentScale = ContentScale.Fit)
    }
}

internal data class NoteLoad<T>(val value: T? = null, val error: String? = null)
/** Loads once per [key]; a [retry] keeps the shown value until the new one arrives, but clears an error. */
@Composable
internal fun <T> loadNote(key: Any, retry: Int, request: suspend () -> T): NoteLoad<T> {
    var result by remember(key) { mutableStateOf(NoteLoad<T>()) }
    LaunchedEffect(key, retry) {
        if (result.error != null) result = NoteLoad()
        result = try { NoteLoad(value = request()) } catch (error: Throwable) { NoteLoad(error = message(error)) }
    }
    return result
}

@Composable
internal fun NoteLoadStatus(error: String?, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        Text(error ?: "기록을 불러오는 중이에요.", color = if (error == null) Palette.Muted else Palette.DangerText)
        if (error != null) DesignButton("다시 시도", onRetry, secondary = true)
    }
}

@Composable
private fun StoredNoteImage(api: ThinkMeetApi, id: String, label: String) {
    var retry by remember(id) { mutableIntStateOf(0) }
    val image = loadNote(id, retry) { api.noteImage(id) }
    val bytes = image.value
    if (bytes != null) NotePreview(bytes, label)
    else ImagePlaceholder { NoteLoadStatus(image.error) { retry++ } }
}

@Composable
private fun ImagePlaceholder(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 180.dp).background(Palette.Canvas, RoundedCornerShape(Radius.R12)).padding(Space.S16), contentAlignment = Alignment.Center) { content() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ClassNotesHome(
    api: ThinkMeetApi, refreshKey: Any, enabled: Boolean, onTab: (NotesTab) -> Unit,
    onCamera: (ClassNoteLesson) -> Unit, content: @Composable ((@Composable () -> Unit)?) -> Unit,
) {
    var retry by remember { mutableIntStateOf(0) }
    val target = loadNote(refreshKey to enabled, retry) { if (enabled) api.noteTarget() else ClassNoteTarget(null) }
    val lesson = target.value?.lesson
    val card: @Composable () -> Unit = {
        NoteCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                DesignIcon("file", Modifier.size(Space.S20), Brand)
                Text(Copy.NotesTitle, style = MaterialTheme.typography.titleMedium, fontWeight = DesignWeight.Bold, color = Palette.TextSecondary)
            }
            Text(Copy.NotesSubmit, fontWeight = DesignWeight.SemiBold)
            Text(lesson?.description() ?: target.error ?: if (target.value == null) "제출할 수업을 확인하고 있어요." else Copy.NotesTargetEmpty, color = Palette.Muted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                DesignButton(Copy.NotesTakePhoto, { lesson?.let(onCamera) }, enabled = lesson != null)
                DesignButton(Copy.NotesArchive, { onTab(NotesTab.Worksheets) }, secondary = true)
                if (target.error != null) DesignButton("다시 시도", { retry++ }, secondary = true)
            }
            HorizontalDivider(color = Palette.Line)
            Text(Copy.NotesRecords, fontWeight = DesignWeight.SemiBold)
            DesignButton(Copy.NotesRecordArchive, { onTab(NotesTab.Records) }, secondary = true)
        }
    }
    content(card.takeIf { enabled })
}

internal fun ClassNoteLesson.description() = "$title · $teacherName 선생님"

/** Lesson-title and sheet chips: web .note-chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NoteChips(selected: String, options: List<Pair<String, String>>, dot: (String) -> Color? = { null }, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        options.forEach { (id, title) ->
            val on = id == selected
            Surface(onClick = { onSelect(id) }, shape = PillShape, color = if (on) Brand else Palette.White,
                border = if (on) null else BorderStroke(Space.S1, Palette.Line), modifier = Modifier.heightIn(min = Space.S36).semantics { this.selected = on }) {
                Row(Modifier.padding(horizontal = Space.S16), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                    dot(id)?.let { Box(Modifier.size(Space.S8).background(it, CircleShape)) }
                    Text(title, style = MaterialTheme.typography.bodySmall, fontWeight = if (on) DesignWeight.SemiBold else DesignWeight.Medium,
                        color = if (on) Palette.White else Palette.TextSecondary)
                }
            }
        }
    }
}

@Composable
private fun LessonFilter(lessons: List<ClassNoteLesson>, selected: String, onSelect: (String) -> Unit) {
    NoteChips(selected, listOf("" to "전체") + lessons.map { it.title }.distinct().sorted().map { it to it }, onSelect = onSelect)
}

private const val UnclassifiedSubject = "unclassified"
private fun ClassNoteLesson.subjectKey() = subject?.id ?: UnclassifiedSubject

/** All, the listed subjects by name, then unclassified; empty below two groups so the chips stay hidden. */
private fun subjectOptions(lessons: List<ClassNoteLesson>): List<Pair<String, String>> {
    val groups = lessons.mapNotNull { it.subject }.distinctBy { it.id }.sortedBy { it.name }.map { it.id to it.name } +
        listOfNotNull((UnclassifiedSubject to Copy.SubjectUnclassified).takeIf { lessons.any { it.subject == null } })
    return if (groups.size < 2) emptyList() else listOf("" to Copy.SubjectAll) + groups
}

/** Subject chips (with subject storage) narrow the lesson-title chips; returns the rows both filters keep. */
@Composable
private fun <T> NoteFilters(api: ThinkMeetApi, rows: List<T>, title: String, onTitle: (String) -> Unit, lesson: (T) -> ClassNoteLesson): List<T> {
    val bySubject = api.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomSubjectStorage)
    var subject by remember { mutableStateOf("") }
    val subjects = if (bySubject) subjectOptions(rows.map(lesson)) else emptyList()
    val selected = subject.takeIf { key -> subjects.any { it.first == key } } ?: ""
    val inSubject = if (selected.isEmpty()) rows else rows.filter { lesson(it).subjectKey() == selected }
    if (subjects.isNotEmpty()) NoteChips(selected, subjects) { key ->
        subject = key
        if (title.isNotEmpty() && rows.none { lesson(it).title == title && (key.isEmpty() || lesson(it).subjectKey() == key) }) onTitle("")
    }
    LessonFilter(inSubject.map(lesson), title, onTitle)
    return inSubject.filter { title.isEmpty() || lesson(it).title == title }
}

/** Web .notes-segment: worksheet/record switch on the line color. */
@Composable
private fun NotesSegment(tab: NotesTab, fill: Boolean, onTab: (NotesTab) -> Unit) {
    Surface(if (fill) Modifier.fillMaxWidth() else Modifier, color = Palette.Line, shape = RoundedCornerShape(Radius.R12)) {
        Row(Modifier.padding(Space.S4), horizontalArrangement = Arrangement.spacedBy(Space.S4)) {
            listOf(NotesTab.Worksheets to Copy.NotesWorksheet, NotesTab.Records to Copy.NotesRecords).forEach { (value, label) ->
                val on = value == tab
                Surface(onClick = { onTab(value) }, shape = RoundedCornerShape(Radius.R10), color = if (on) Palette.White else Color.Transparent,
                    shadowElevation = if (on) 1.dp else 0.dp,
                    modifier = (if (fill) Modifier.weight(1f) else Modifier.widthIn(min = 128.dp)).heightIn(min = 44.dp).semantics { this.selected = on }) {
                    Box(Modifier.padding(horizontal = if (fill) Space.S12 else Space.S24), contentAlignment = Alignment.Center) {
                        Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) Brand else Palette.Muted)
                    }
                }
            }
        }
    }
}

@Composable
internal fun ClassNotesScreen(api: ThinkMeetApi, tab: NotesTab, teacher: Boolean, onTab: (NotesTab) -> Unit, onCamera: (ClassNoteLesson) -> Unit) {
    var targetRetry by remember { mutableIntStateOf(0) }
    var submitInfo by remember { mutableStateOf(false) }
    val target = loadNote(teacher, targetRetry) { if (teacher) ClassNoteTarget(null) else api.noteTarget() }
    PageColumn(verticalArrangement = Arrangement.spacedBy(Space.S16)) {
        val phone = LocalLessonWidth.current <= Layout.DashboardCompact
        val submit: @Composable (Modifier) -> Unit = { modifier ->
            DesignButton(Copy.NotesCameraTitle, { target.value?.lesson?.let(onCamera) ?: run { submitInfo = true } }, modifier.heightIn(min = 52.dp),
                icon = { DesignIcon("camera", Modifier.size(Space.S20), Palette.White) })
        }
        val showSubmit = !teacher && tab == NotesTab.Worksheets
        if (phone) Column(verticalArrangement = Arrangement.spacedBy(Space.S12)) {
            NotesSegment(tab, true, onTab)
            if (showSubmit) submit(Modifier.fillMaxWidth())
        } else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
            NotesSegment(tab, false, onTab)
            if (showSubmit) submit(Modifier)
        }
        if (tab == NotesTab.Worksheets) WorksheetArchive(api, teacher) else CaptureArchive(api, teacher)
    }
    if (submitInfo) NoteDialog(Copy.NotesSubmit, onClose = { submitInfo = false }) {
        Row(Modifier.fillMaxWidth().background(Palette.Canvas, RoundedCornerShape(Radius.R12)).padding(horizontal = Space.S16, vertical = Space.S12),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
            Box(Modifier.size(40.dp).background(Palette.White, CircleShape), contentAlignment = Alignment.Center) { DesignIcon("file", Modifier.size(Space.S20), Brand) }
            Column {
                Text("제출할 수업", style = MaterialTheme.typography.labelMedium, color = Palette.Muted)
                Text(target.value?.lesson?.description() ?: target.error ?: if (target.value == null) "제출할 수업을 확인하고 있어요." else Copy.NotesTargetEmpty,
                    style = MaterialTheme.typography.titleMedium, color = Palette.Ink)
            }
        }
        if (target.error != null) DesignButton("다시 시도", { targetRetry++ }, secondary = true)
        target.value?.lesson?.let { lesson -> DesignButton(Copy.NotesCameraTitle, { submitInfo = false; onCamera(lesson) }, Modifier.fillMaxWidth()) }
    }
}

/** Two cards per row above layout.dashboardCompact, one below; cards in a row share the tallest height. */
@Composable
private fun <T> NoteGrid(items: List<T>, content: @Composable (T, Modifier) -> Unit) {
    val columns = if (LocalLessonWidth.current <= Layout.DashboardCompact) 1 else 2
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S16)) {
        items.chunked(columns).forEach { row ->
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Space.S16)) {
                row.forEach { content(it, Modifier.weight(1f).fillMaxHeight()) }
                if (row.size < columns) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun NotesCard(modifier: Modifier, gap: Dp = Space.S16, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val padding = if (LocalLessonWidth.current <= Layout.DashboardCompact) Space.S16 else Space.S20
    val shape = RoundedCornerShape(Radius.Large)
    val border = BorderStroke(Space.S1, Palette.Line)
    val inner: @Composable () -> Unit = { Column(Modifier.fillMaxWidth().padding(padding), verticalArrangement = Arrangement.spacedBy(gap), content = content) }
    if (onClick != null) Surface(onClick = onClick, modifier = modifier, shape = shape, color = Palette.White, border = border, content = inner)
    else Surface(modifier, shape = shape, color = Palette.White, border = border, content = inner)
}

@Composable
private fun NotesEmpty(icon: String, text: String) {
    val shape = RoundedCornerShape(Radius.Large)
    Column(Modifier.fillMaxWidth().background(Palette.White, shape).drawBehind {
        drawRoundRect(Palette.LineInput, cornerRadius = CornerRadius(Radius.Large.toPx()),
            style = Stroke(Space.S1.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(Space.S6.toPx(), Space.S4.toPx()))))
    }.padding(horizontal = Space.S24, vertical = Space.S48), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S12)) {
        Box(Modifier.size(Space.S56).background(Palette.Selection, CircleShape), contentAlignment = Alignment.Center) { DesignIcon(icon, Modifier.size(26.dp), Brand) }
        Text(text, style = MaterialTheme.typography.bodySmall, color = Palette.Muted, textAlign = TextAlign.Center)
    }
}

@Composable
private fun CountTile(icon: String, label: String, count: Int, accent: Boolean, modifier: Modifier) {
    Surface(modifier, color = if (accent) Palette.Selection else Palette.Canvas, shape = RoundedCornerShape(Radius.R12)) {
        Column(Modifier.padding(Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                DesignIcon(icon, Modifier.size(18.dp), if (accent) Brand else Palette.Muted)
                Text(label, style = MaterialTheme.typography.titleSmall, color = Palette.TextSecondary)
            }
            Text("${count}장", fontSize = Type.Title, lineHeight = Leading.Title, fontWeight = DesignWeight.Bold, color = Brand)
        }
    }
}

@Composable
private fun NoteTag(text: String) {
    Text(text, Modifier.background(Palette.Selection, PillShape).padding(horizontal = Space.S8, vertical = Space.S2),
        style = MaterialTheme.typography.labelMedium, fontWeight = DesignWeight.SemiBold, color = Brand, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
internal fun NoteRow(icon: String, label: String, accent: Boolean = false, enabled: Boolean = true, onClick: () -> Unit, trailing: @Composable RowScope.() -> Unit) {
    Surface(onClick = onClick, enabled = enabled, color = if (accent) Palette.Selection else Palette.Canvas, shape = RoundedCornerShape(Radius.R12),
        modifier = Modifier.fillMaxWidth().heightIn(min = Space.S56)) {
        Row(Modifier.padding(horizontal = Space.S16), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
            DesignIcon(icon, Modifier.size(Space.S20), if (accent) Brand else Palette.Muted)
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = Palette.TextSecondary)
            trailing()
            DesignIcon("chevron", Modifier.size(18.dp), Palette.Muted)
        }
    }
}

@Composable
private fun WorksheetArchive(api: ThinkMeetApi, teacher: Boolean) {
    var month by remember { mutableStateOf(today().let { LocalDate(it.year, it.month, 1) }) }
    var title by remember { mutableStateOf("") }
    var retry by remember { mutableIntStateOf(0) }
    var openKey by remember { mutableStateOf<Pair<LocalDate, String>?>(null) }
    val list = loadNote(month, retry) { api.noteWorksheets(month = month.toString().take(7)) }
    fun changeMonth(delta: Int) { month = month.plus(DatePeriod(months = delta)); title = ""; openKey = null }
    val groups = NoteFilters(api, list.value.orEmpty(), title, { title = it }) { it.lesson }.groupBy { date(it.original.createdAt) to it.lesson.id }
    Surface(color = Palette.White, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Component.CardRadius)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.S12, vertical = Space.S8), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            RoundButton("back", "이전 달") { changeMonth(-1) }
            Text("${month.year}년 ${month.month.number}월 제출", style = MaterialTheme.typography.labelLarge, fontWeight = DesignWeight.Bold, color = Palette.Ink)
            RoundButton("chevron", "다음 달", enabled = month.plus(DatePeriod(months = 1)) <= today()) { changeMonth(1) }
        }
    }
    if (list.value == null) NoteLoadStatus(list.error) { retry++ }
    else if (groups.isEmpty()) NotesEmpty("file", Copy.NotesWorksheetsEmpty)
    else NoteGrid(groups.entries.toList()) { (key, rows), modifier ->
        val first = rows.first()
        NotesCard(modifier, onClick = { openKey = key }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                Text(dateLabel(first.original.createdAt), style = MaterialTheme.typography.bodyLarge, fontWeight = DesignWeight.Bold, color = Palette.Ink, maxLines = 1)
                Box(Modifier.weight(1f)) { NoteTag(first.lesson.title) }
                DesignIcon("chevron", Modifier.size(18.dp), Palette.Muted)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                CountTile("file", if (teacher) Copy.NotesStudentSubmitted else Copy.NotesSubmitted, rows.size, false, Modifier.weight(1f))
                CountTile("checkSquare", if (teacher) Copy.NotesTeacherCorrected else Copy.NotesCorrected, rows.count { it.correction != null }, true, Modifier.weight(1f))
            }
        }
    }
    openKey?.let { groups[it] }?.let { rows -> NoteDialog("${rows.first().lesson.title} · ${dateLabel(rows.first().original.createdAt)}", onClose = { openKey = null }) {
        if (teacher) TeacherWorksheetPicker(api, rows) { retry++ } else StudentWorksheetPicker(api, rows)
    } }
}

@Composable
private fun StudentWorksheetPicker(api: ThinkMeetApi, rows: List<ClassNoteWorksheet>) {
    var id by remember { mutableStateOf(rows.first().original.id) }
    val row = rows.firstOrNull { it.original.id == id } ?: rows.first()
    if (rows.size > 1) NoteChips(row.original.id, rows.mapIndexed { index, item -> item.original.id to "학습지 ${index + 1}" }) { id = it }
    key(row.original.id) { WorksheetImages(api, row, teacher = false) }
}

/** Teacher view of one date and lesson: pick a student's sheet, then attach a correction. */
@Composable
private fun TeacherWorksheetPicker(api: ThinkMeetApi, rows: List<ClassNoteWorksheet>, onSaved: () -> Unit) {
    var id by remember { mutableStateOf(rows.first().original.id) }
    val row = rows.firstOrNull { it.original.id == id } ?: rows.first()
    val seen = mutableMapOf<String, Int>()
    val options = rows.map { item ->
        val count = (seen[item.studentName] ?: 0) + 1
        seen[item.studentName] = count
        item.original.id to if (rows.count { it.studentName == item.studentName } > 1) "${item.studentName} $count" else item.studentName
    }
    NoteChips(row.original.id, options, dot = { option -> if (rows.first { it.original.id == option }.correction != null) Palette.Success else Palette.Pending }) { id = it }
    key(row.original.id) { WorksheetCorrection(api, row, onSaved) }
}

@Composable
private fun WorksheetImages(api: ThinkMeetApi, row: ClassNoteWorksheet, teacher: Boolean) {
    val corrected = if (teacher) Copy.NotesTeacherCorrected else Copy.NotesCorrected
    val original: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            ImageLabel("file", Copy.NotesSubmitted, false)
            StoredNoteImage(api, row.original.id, Copy.NotesSubmitted)
        }
    }
    val correction: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            ImageLabel("checkSquare", corrected, true)
            row.correction?.let { StoredNoteImage(api, it.id, corrected) }
                ?: ImagePlaceholder { Text(Copy.NotesCorrectionPending, style = MaterialTheme.typography.bodySmall, color = Palette.Muted) }
        }
    }
    BoxWithConstraints {
        if (maxWidth > 560.dp) Row(horizontalArrangement = Arrangement.spacedBy(Space.S16)) { original(Modifier.weight(1f)); correction(Modifier.weight(1f)) }
        else Column(verticalArrangement = Arrangement.spacedBy(Space.S16)) { original(Modifier); correction(Modifier) }
    }
}

@Composable
private fun ImageLabel(icon: String, label: String, accent: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
        DesignIcon(icon, Modifier.size(18.dp), if (accent) Brand else Palette.Muted)
        Text(label, style = MaterialTheme.typography.titleMedium, color = Palette.TextSecondary)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorksheetCorrection(api: ThinkMeetApi, row: ClassNoteWorksheet, onSaved: () -> Unit) {
    var draft by remember { mutableStateOf<NoteDraft?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val picker = rememberNoteImagePicker { bytes, failure ->
        error = failure
        if (bytes != null) draft = NoteDraft(bytes)
    }
    Text("${row.studentName} · ${dateLabel(row.original.createdAt)} · ${if (row.correction == null) "첨삭 대기" else "첨삭 완료"}",
        style = MaterialTheme.typography.bodySmall, color = Palette.Muted)
    WorksheetImages(api, row, teacher = true)
    if (row.correction == null) {
        HorizontalDivider(color = Palette.Line)
        draft?.let { NotePreview(it.bytes, "첨삭 이미지 미리보기") }
        error?.let { Text(it, color = Palette.DangerText) }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S8, Alignment.End), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignButton(if (draft == null) Copy.NotesCorrection else "다른 이미지 선택", picker.launch, enabled = !busy && picker.supported, secondary = true)
            DesignButton(if (busy) "저장 중…" else "첨삭 저장", {
                val photo = draft ?: return@DesignButton
                if (busy) return@DesignButton
                busy = true; error = null
                scope.launch {
                    try { api.submitNoteCorrection(row.original.id, photo.bytes, photo.requestId); draft = null; onSaved() }
                    catch (failure: Throwable) { error = message(failure) }
                    finally { busy = false }
                }
            }, enabled = draft != null && !busy)
        }
    }
}

/** One saved screen or one finished recording, grouped per lesson in the records tab. */
private class RecordEntry(val lesson: ClassNoteLesson, val time: String, val capture: ClassNoteCapture? = null, val recording: LessonRecording? = null)

@Composable
private fun CaptureArchive(api: ThinkMeetApi, teacher: Boolean) {
    var title by remember { mutableStateOf("") }
    var retry by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<List<ClassNoteCapture>?>(null) }
    var videos by remember { mutableStateOf<List<LessonRecording>?>(null) }
    var playing by remember { mutableStateOf<LessonRecording?>(null) }
    var cookie by remember { mutableStateOf<String?>(null) }
    var index by remember { mutableIntStateOf(0) }
    val list = loadNote("captures", retry) { api.noteCaptures() }
    // Only the recording teacher sees their own lesson recordings, next to the screens they saved.
    val recordingsEnabled = teacher && api.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomRecording)
    val recordings = loadNote("recordings:$recordingsEnabled", retry) { if (recordingsEnabled) api.recordings() else emptyList() }
    val entries = if (list.value == null || recordings.value == null) null else
        list.value.map { RecordEntry(it.lesson, it.image.createdAt, capture = it) } +
            recordings.value.mapNotNull { recording -> recording.lesson?.takeIf { recording.status == "ready" }?.let { RecordEntry(it, recording.startedAt, recording = recording) } }
    val sources = if (teacher) listOf("self") else listOf("self", "teacher")
    // Newest first, so a lesson that only has a recording sorts like one with saved screens.
    val groups = NoteFilters(api, entries.orEmpty(), title, { title = it }) { it.lesson }
        .sortedByDescending { runCatching { Instant.parse(it.time) }.getOrNull() }.groupBy { it.lesson.id }.values.toList()
    if (entries == null) NoteLoadStatus(list.error ?: recordings.error) { retry++ }
    else if (groups.isEmpty()) NotesEmpty("camera", Copy.NotesCapturesEmpty)
    else NoteGrid(groups) { rows, modifier ->
        val lesson = rows.first().lesson
        val captures = rows.mapNotNull { it.capture }
        val lessonVideos = rows.mapNotNull { it.recording }
        NotesCard(modifier, gap = Space.S12) {
            Text("${dateLabel(lesson.startsAt)} · ${lesson.title}", style = MaterialTheme.typography.bodyLarge, fontWeight = DesignWeight.Bold, color = Palette.Ink)
            sources.forEach { source ->
                val images = captures.filter { it.source == source }
                NoteRow(if (source == "self") "camera" else "user", if (source == "self") Copy.NotesOwnCapture else Copy.NotesTeacherCapture,
                    accent = source == "teacher", enabled = images.isNotEmpty(), onClick = { selected = images; index = 0 }) {
                    Text("${images.size}장", style = MaterialTheme.typography.labelLarge, fontWeight = DesignWeight.Bold, color = if (images.isEmpty()) Palette.Muted else Brand)
                }
            }
            if (recordingsEnabled) NoteRow("video", Copy.RecordingListTitle, enabled = lessonVideos.isNotEmpty(), onClick = { videos = lessonVideos; index = 0 }) {
                Text("${lessonVideos.size}개", style = MaterialTheme.typography.labelLarge, fontWeight = DesignWeight.Bold, color = if (lessonVideos.isEmpty()) Palette.Muted else Brand)
            }
        }
    }
    selected?.let { images -> NoteDialog("${if (images.first().source == "self") Copy.NotesOwnCapture else Copy.NotesTeacherCapture} · ${images.first().lesson.title}", onClose = { selected = null }) {
        NotePager(index, images.size, "화면") { index = it }
        key(images[index].image.id) { StoredNoteImage(api, images[index].image.id, "수업 화면 ${index + 1}") }
    } }
    // The native player is full screen, so the dialog pages through recordings and opens one to play.
    videos?.let { items -> if (playing == null) NoteDialog("${Copy.RecordingListTitle} · ${items.first().lessonTitle}", onClose = { videos = null }) {
        val item = items[index.coerceIn(0, items.lastIndex)]
        if (items.size > 1) NotePager(index, items.size, "녹화") { index = it }
        Text("${dateLabel(item.startedAt)} · ${recordingDuration(item.durationMs)}", Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodyMedium, color = Palette.Muted, textAlign = TextAlign.Center)
        DesignButton(Copy.RecordingPlay, { playing = item }, Modifier.fillMaxWidth())
    } }
    playing?.let { item ->
        LaunchedEffect(item.id) { cookie = api.cookieHeader() }
        cookie?.let { RecordingPlayerDialog(api.recordingContentUrl(item.id), it) { playing = null } }
    }
}

@Composable
private fun NotePager(index: Int, total: Int, label: String, onIndex: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S16, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        RoundButton("back", "이전 $label", enabled = index > 0) { onIndex(index - 1) }
        Text("${index + 1} / $total", Modifier.widthIn(min = 64.dp), style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
        RoundButton("chevron", "다음 $label", enabled = index < total - 1) { onIndex(index + 1) }
    }
}

@Composable
internal fun TeacherWorksheets(api: ThinkMeetApi, lessonId: String) {
    var expanded by remember(lessonId) { mutableStateOf(false) }
    NoteCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignIcon("file", Modifier.size(Space.S20), Brand)
            Text(Copy.NotesTeacherList, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, color = Palette.Ink)
            DesignButton(if (expanded) "목록 닫기" else "목록 보기", { expanded = !expanded }, secondary = true)
        }
        if (expanded) TeacherWorksheetList(api, lessonId)
    }
}

@Composable
private fun StatusPill(done: Boolean) {
    val status = if (done) Palette.Success else Palette.Pending
    Text(if (done) "첨삭 완료" else "첨삭 대기", Modifier.background(lerp(Palette.White, status, .12f), PillShape).padding(horizontal = Space.S8, vertical = Space.S2),
        style = MaterialTheme.typography.labelMedium, fontWeight = DesignWeight.SemiBold, color = lerp(Palette.Ink, status, .7f))
}

@Composable
private fun TeacherWorksheetList(api: ThinkMeetApi, lessonId: String) {
    var retry by remember { mutableIntStateOf(0) }
    val list = loadNote(lessonId, retry) { api.noteWorksheets(lessonId = lessonId) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    val phone = LocalLessonWidth.current <= Layout.RootNavigationMobile
    if (list.value == null) NoteLoadStatus(list.error) { retry++ }
    else if (list.value.isEmpty()) Text("제출한 학생이 없어요.", color = Palette.Muted)
    else Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        list.value.forEach { row ->
            NoteRow("user", row.studentName, onClick = { selectedId = row.original.id }) {
                if (!phone) Text(dateLabel(row.original.createdAt), style = MaterialTheme.typography.labelMedium, color = Palette.Muted)
                StatusPill(row.correction != null)
            }
        }
    }
    list.value?.firstOrNull { it.original.id == selectedId }?.let { row ->
        NoteDialog("${row.studentName} · ${Copy.NotesWorksheet}", onClose = { selectedId = null }) {
            key(row.original.id) { WorksheetCorrection(api, row) { retry++ } }
        }
    }
}
