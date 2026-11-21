package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
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
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.platform.NoteDraft
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

@Composable
private fun NoteCard(modifier: Modifier = Modifier, title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier, color = Palette.White, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Component.CardRadius)) {
        Column(Modifier.fillMaxWidth().padding(Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = DesignWeight.Bold, color = Palette.TextSecondary)
            content()
        }
    }
}

@Composable
internal fun NoteDialog(title: String, busy: Boolean = false, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (!busy) onClose() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(Space.S20), contentAlignment = Alignment.Center) {
            val maxDialogHeight = maxHeight
            Surface(Modifier.widthIn(max = Layout.PrejoinWide).fillMaxWidth().heightIn(max = maxDialogHeight),
                color = Palette.White, contentColor = Palette.TextSecondary, shape = RoundedCornerShape(Component.CardRadius)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(Space.S20), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = DesignWeight.Bold)
                        IconButton(onClick = onClose, enabled = !busy) { DesignIcon("close", Modifier.size(Space.S20), Palette.TextSecondary, "닫기") }
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
    bitmap?.let { Image(it, label, Modifier.fillMaxWidth().heightIn(max = Layout.DashboardCompact), contentScale = ContentScale.Fit) }
}

internal data class NoteLoad<T>(val value: T? = null, val error: String? = null)
@Composable
internal fun <T> loadNote(key: Any, retry: Int, request: suspend () -> T): NoteLoad<T> {
    var result by remember(key, retry) { mutableStateOf(NoteLoad<T>()) }
    LaunchedEffect(key, retry) {
        result = try { NoteLoad(value = request()) } catch (error: Throwable) { NoteLoad(error = message(error)) }
    }
    return result
}

@Composable
private fun NoteLoadStatus(error: String?, onRetry: () -> Unit) {
    Text(error ?: "기록을 불러오는 중이에요.", color = if (error == null) Palette.Muted else Palette.DangerText)
    if (error != null) DesignButton("다시 시도", onRetry, secondary = true)
}

@Composable
private fun StoredNoteImage(api: ThinkMeetApi, id: String, label: String) {
    var retry by remember(id) { mutableIntStateOf(0) }
    val image = loadNote(id, retry) { api.noteImage(id) }
    val bytes = image.value
    if (bytes != null) NotePreview(bytes, label) else NoteLoadStatus(image.error) { retry++ }
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NoteTabs(selected: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
        options.forEach { (id, title) -> FilterChip(selected = id == selected, onClick = { onSelect(id) }, label = { Text(title) }) }
    }
}

@Composable
internal fun ClassNotesScreen(api: ThinkMeetApi, initialTab: NotesTab) {
    var tab by remember(initialTab) { mutableStateOf(initialTab) }
    PageColumn(verticalArrangement = Arrangement.spacedBy(Space.S12)) {
        NoteTabs(tab.name, listOf(NotesTab.Worksheets.name to Copy.NotesWorksheet, NotesTab.Records.name to Copy.NotesRecords)) { tab = NotesTab.valueOf(it) }
        if (tab == NotesTab.Worksheets) WorksheetArchive(api) else CaptureArchive(api)
    }
}

@Composable
private fun LessonFilter(lessons: List<ClassNoteLesson>, selected: String, onSelect: (String) -> Unit) {
    NoteTabs(selected, listOf("" to "전체") + lessons.map { it.title }.distinct().sorted().map { it to it }, onSelect)
}

@Composable
private fun <T> NoteGrid(items: List<T>, content: @Composable (T, Modifier) -> Unit) {
    val columns = if (LocalLessonWidth.current <= Layout.DashboardCompact) 1 else 2
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
        items.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                row.forEach { content(it, Modifier.weight(1f)) }
                if (row.size < columns) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun WorksheetArchive(api: ThinkMeetApi) {
    var month by remember { mutableStateOf(today().let { LocalDate(it.year, it.month, 1) }) }
    var title by remember { mutableStateOf("") }
    var retry by remember { mutableIntStateOf(0) }
    var group by remember { mutableStateOf<List<ClassNoteWorksheet>?>(null) }
    var index by remember { mutableIntStateOf(0) }
    val list = loadNote(month, retry) { api.noteWorksheets(month = month.toString().take(7)) }
    val groups = list.value.orEmpty().filter { title.isEmpty() || it.lesson.title == title }.groupBy { date(it.original.createdAt) to it.lesson.id }.values.toList()
    LessonFilter(list.value.orEmpty().map { it.lesson }, title) { title = it }
    NoteCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { month = month.plus(DatePeriod(months = -1)); title = "" }) { DesignIcon("back", Modifier.size(Space.S20), Brand, "이전 달") }
            Text("${month.year}년 ${month.month.number}월 제출", fontWeight = DesignWeight.SemiBold)
            IconButton(onClick = { month = month.plus(DatePeriod(months = 1)); title = "" }, enabled = month.plus(DatePeriod(months = 1)) <= today()) { DesignIcon("chevron", Modifier.size(Space.S20), Brand, "다음 달") }
        }
    }
    if (list.value == null) NoteLoadStatus(list.error) { retry++ }
    else if (groups.isEmpty()) NoteCard { Text("이 달에 제출한 학습지가 없어요.") }
    else NoteGrid(groups) { rows, modifier ->
        val first = rows.first()
        NoteCard(modifier, "${dateLabel(first.original.createdAt)} · ${first.lesson.title}") {
            Text("${Copy.NotesSubmitted} ${rows.size}장", color = Palette.Muted)
            Text("${Copy.NotesCorrected} ${rows.count { it.correction != null }}장", color = Palette.Muted)
            DesignButton("학습지 보기", { index = 0; group = rows }, secondary = true)
        }
    }
    group?.let { rows -> NoteDialog("${rows.first().lesson.title} · ${dateLabel(rows.first().original.createdAt)}", onClose = { group = null }) {
        NoteTabs(index.toString(), rows.indices.map { it.toString() to "학습지 ${it + 1}" }) { index = it.toInt() }
        WorksheetImages(api, rows[index])
    } }
}

@Composable
private fun WorksheetImages(api: ThinkMeetApi, row: ClassNoteWorksheet) {
    Text(Copy.NotesSubmitted, fontWeight = DesignWeight.SemiBold)
    StoredNoteImage(api, row.original.id, Copy.NotesSubmitted)
    Text(Copy.NotesCorrected, fontWeight = DesignWeight.SemiBold)
    row.correction?.let { StoredNoteImage(api, it.id, Copy.NotesCorrected) } ?: Text("아직 첨삭 이미지가 없어요.", color = Palette.Muted)
}

@Composable
private fun CaptureArchive(api: ThinkMeetApi) {
    var title by remember { mutableStateOf("") }
    var retry by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<List<ClassNoteCapture>?>(null) }
    var index by remember { mutableIntStateOf(0) }
    val list = loadNote("captures", retry) { api.noteCaptures() }
    val groups = list.value.orEmpty().filter { title.isEmpty() || it.lesson.title == title }.groupBy { it.lesson.id }.values.toList()
    LessonFilter(list.value.orEmpty().map { it.lesson }, title) { title = it }
    if (list.value == null) NoteLoadStatus(list.error) { retry++ }
    else if (groups.isEmpty()) NoteCard { Text("저장된 수업 화면이 없어요.") }
    else NoteGrid(groups) { rows, modifier ->
        val lesson = rows.first().lesson
        NoteCard(modifier, "${dateLabel(lesson.startsAt)} · ${lesson.title}") {
            listOf("self" to Copy.NotesOwnCapture, "teacher" to Copy.NotesTeacherCapture).forEach { (source, label) ->
                val images = rows.filter { it.source == source }
                DesignButton("$label · ${images.size}장", { selected = images; index = 0 }, Modifier.fillMaxWidth(), enabled = images.isNotEmpty(), secondary = true)
            }
        }
    }
    selected?.let { images -> NoteDialog(if (images.first().source == "self") Copy.NotesOwnCapture else Copy.NotesTeacherCapture, onClose = { selected = null }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            DesignButton("이전", { index-- }, secondary = true, enabled = index > 0)
            Text("${index + 1} / ${images.size}")
            DesignButton("다음", { index++ }, secondary = true, enabled = index < images.lastIndex)
        }
        key(images[index].image.id) { StoredNoteImage(api, images[index].image.id, "수업 화면 ${index + 1}") }
    } }
}

@Composable
internal fun TeacherWorksheets(api: ThinkMeetApi, lessonId: String) {
    var expanded by remember(lessonId) { mutableStateOf(false) }
    NoteCard(title = Copy.NotesTeacherList) {
        DesignButton(if (expanded) "목록 닫기" else "목록 보기", { expanded = !expanded }, secondary = true)
        if (expanded) TeacherWorksheetList(api, lessonId)
    }
}

@Composable
private fun TeacherWorksheetList(api: ThinkMeetApi, lessonId: String) {
    var retry by remember { mutableIntStateOf(0) }
    val list = loadNote(lessonId, retry) { api.noteWorksheets(lessonId = lessonId) }
    var selected by remember { mutableStateOf<ClassNoteWorksheet?>(null) }
    var draft by remember { mutableStateOf<NoteDraft?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val picker = rememberNoteImagePicker { bytes, failure ->
        error = failure
        if (bytes != null) draft = NoteDraft(bytes)
    }
    fun close() { selected = null; draft = null; error = null }
    if (list.value == null) NoteLoadStatus(list.error) { retry++ }
    else if (list.value.isEmpty()) Text("제출한 학생이 없어요.")
    else NoteGrid(list.value) { row, modifier ->
        NoteCard(modifier, row.studentName) {
            Text("${dateLabel(row.original.createdAt)} · ${if (row.correction == null) "첨삭 대기" else "첨삭 완료"}", color = Palette.Muted)
            DesignButton("학습지 보기", { selected = row }, secondary = true)
        }
    }
    selected?.let { row -> NoteDialog("${row.studentName} · ${Copy.NotesWorksheet}", busy, ::close) {
        WorksheetImages(api, row)
        if (row.correction == null) {
            draft?.let { NotePreview(it.bytes, "첨삭 이미지 미리보기") }
            error?.let { Text(it, color = Palette.DangerText) }
            DesignButton(Copy.NotesCorrection, picker.launch, enabled = !busy && picker.supported, secondary = true)
            DesignButton(if (busy) "저장 중…" else "첨삭 저장", {
                val photo = draft ?: return@DesignButton
                if (busy) return@DesignButton
                busy = true; error = null
                scope.launch {
                    try { api.submitNoteCorrection(row.original.id, photo.bytes, photo.requestId); close(); retry++ }
                    catch (failure: Throwable) { error = message(failure) }
                    finally { busy = false }
                }
            }, enabled = draft != null && !busy)
        }
    } }
}
