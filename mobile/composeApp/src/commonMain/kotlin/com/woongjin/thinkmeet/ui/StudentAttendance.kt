package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.woongjin.thinkmeet.data.StudentAttendanceInput
import com.woongjin.thinkmeet.data.StudentAttendanceMonth
import com.woongjin.thinkmeet.data.StudentAttendanceReason
import com.woongjin.thinkmeet.data.StudentAttendanceRow
import com.woongjin.thinkmeet.data.StudentAttendanceStatus
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.design.Brand
import com.woongjin.thinkmeet.design.DesignAvatar
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent as Copy
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout
import com.woongjin.thinkmeet.design.generated.DesignTokens.LineHeight as Leading
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.number
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.math.roundToInt
import kotlin.time.Clock

private val weekdays = listOf("월", "화", "수", "목", "금", "토", "일")
private val statusLabels = linkedMapOf<StudentAttendanceStatus, String>(
    "PRESENT" to Copy.AttendancePresent, "LATE" to Copy.AttendanceLate, "ABSENT" to Copy.AttendanceAbsent,
)
private val reasonLabels = linkedMapOf<StudentAttendanceReason, String>(
    "DEVICE" to Copy.AttendanceDevice, "NETWORK" to Copy.AttendanceNetwork, "OTHER" to Copy.AttendanceOther,
)

private fun statusColors(status: StudentAttendanceStatus): Pair<Color, Color> = when (status) {
    "PRESENT" -> Palette.LiveSuccessText to Palette.SuccessSurface
    "LATE" -> Palette.WarningText to Palette.WarningSurface
    "ABSENT" -> Palette.DangerText to Palette.DangerSurface
    else -> Palette.TextSecondary to Palette.SurfaceVariant
}

private fun attendanceDate(value: String): String = localDateTime(value)?.date?.let {
    "${it.month.number}월 ${it.day}일 (${weekdays[it.dayOfWeek.ordinal]})"
} ?: "—"

private fun attendanceTime(value: String?): String = value?.let(::localDateTime)?.let {
    "${it.hour.toString().padStart(2, '0')}:${it.minute.toString().padStart(2, '0')}"
} ?: "—"

private fun attendanceMonth() = Clock.System.now().toLocalDateTime(Seoul).date.toString().take(7)

private fun shiftMonth(month: String, offset: Int): String =
    (LocalDate.parse("$month-01") + DatePeriod(months = offset)).toString().take(7)

@Composable
internal fun AttendanceHeader(studentName: String, mobile: Boolean, back: () -> Unit) {
    Surface(color = Palette.White) {
        Column(Modifier.statusBarsPadding()) {
            Box(Modifier.fillMaxWidth().height(if (mobile) Layout.RootHeaderCompactHeight else Layout.RootHeaderHeight)) {
                Row(Modifier.align(Alignment.CenterStart).fillMaxWidth(.42f).padding(start = if (mobile) Space.S8 else Space.S24),
                    verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = back) { DesignIcon("back", Modifier.size(Space.S24), Palette.TextSecondary, Copy.AttendanceStudents) }
                    Text(studentName, fontSize = if (mobile) Type.Label else Type.Heading, fontWeight = DesignWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.align(Alignment.Center).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    Text(Copy.AttendanceTitle, Modifier.semantics { heading() }, color = Brand, fontSize = Type.Label, fontWeight = DesignWeight.Bold)
                    Box(Modifier.align(Alignment.BottomCenter).width(Space.S36).height(Space.S3).background(Brand))
                }
            }
            HorizontalDivider(color = Palette.Line)
        }
    }
}

@Composable
internal fun AttendanceStudentsScreen(api: ThinkMeetApi, open: (User) -> Unit) {
    var students by remember { mutableStateOf<List<User>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(api, retry) {
        error = null
        try {
            students = api.students()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: Copy.AttendanceLoadError
        }
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.widthIn(max = Layout.AttendanceMaxWidth).fillMaxWidth(),
            contentPadding = PaddingValues(Space.S20), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
            item {
                Text(Copy.AttendanceStudents, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, fontWeight = DesignWeight.Bold)
            }
            val roster = students
            if (roster.isNullOrEmpty()) {
                item {
                    AttendanceMessage(if (roster == null) error ?: Copy.AttendanceLoadingStudents else Copy.AttendanceEmptyStudents,
                        retry = if (error == null) null else { { retry++ } })
                }
            } else items(roster, key = { it.id }) { student ->
                Surface(onClick = { open(student) }, color = Palette.White, shape = RoundedCornerShape(Component.StatusCardRadius)) {
                    Row(Modifier.fillMaxWidth().padding(Space.S12), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                        DesignAvatar(student.name, student.id)
                        Text(student.name, Modifier.weight(1f), fontSize = Type.Body, fontWeight = DesignWeight.SemiBold)
                        DesignIcon("chevron", Modifier.size(Space.S20), Palette.Muted)
                    }
                }
            }
        }
    }
}

@Composable
internal fun StudentAttendanceScreen(api: ThinkMeetApi, studentId: String) {
    var month by rememberSaveable(studentId) { mutableStateOf(attendanceMonth()) }
    var retry by remember { mutableIntStateOf(0) }
    var report by remember(month, retry) { mutableStateOf<StudentAttendanceMonth?>(null) }
    var error by remember(month, retry) { mutableStateOf<String?>(null) }
    var editing by remember(month) { mutableStateOf<StudentAttendanceRow?>(null) }

    LaunchedEffect(api, studentId, month, retry) {
        try {
            report = api.studentAttendance(studentId, month)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = failure.message ?: Copy.AttendanceLoadError
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Palette.AttendanceCanvas), contentAlignment = Alignment.TopCenter) {
        val compact = maxWidth <= Layout.DashboardCompact
        val narrow = maxWidth <= Layout.DialogPhoneBreakpoint
        val gutter = if (compact) Space.S16 else Space.S28
        val gap = if (compact) Space.S12 else Space.S16
        val current = report?.takeIf { it.month == month }
        LazyColumn(
            Modifier.widthIn(max = Layout.AttendanceMaxWidth).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = gutter, vertical = Space.S20),
        ) {
            item(key = "month-header") {
                current?.let {
                    AttendanceSummary(it, compact, gap)
                    Spacer(Modifier.height(gap))
                }
                MonthSelector(month, { month = shiftMonth(month, it) })
                Spacer(Modifier.height(gap))
            }
            if (current == null) {
                item { AttendanceMessage(error ?: Copy.AttendanceLoading, retry = if (error == null) null else { { retry++ } }) }
            } else if (current.rows.isEmpty()) {
                item { AttendanceMessage(Copy.AttendanceEmpty) }
            } else items(current.rows.size, key = { current.rows[it].lessonId }) { index ->
                val row = current.rows[index]
                val radius = Component.StatusCardRadius
                val top = if (index == 0) radius else 0.dp
                val bottom = if (index == current.rows.lastIndex) radius else 0.dp
                Surface(color = Palette.White, shape = RoundedCornerShape(top, top, bottom, bottom)) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = if (compact) Space.S12 else Space.S20)) {
                        if (index != 0) HorizontalDivider(color = Palette.Line)
                        AttendanceRow(row, compact, narrow) { editing = row }
                    }
                }
            }
        }
    }
    editing?.let { row ->
        AttendanceEditor(row, dismiss = { editing = null }, save = { api.saveStudentAttendance(studentId, row.lessonId, it) }) {
            report = it
            editing = null
        }
    }
}

@Composable
private fun AttendanceMessage(message: String, retry: (() -> Unit)? = null) {
    Surface(color = Palette.White, shape = RoundedCornerShape(Component.StatusCardRadius)) {
        Column(Modifier.fillMaxWidth().padding(Space.S24), verticalArrangement = Arrangement.spacedBy(Space.S12),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = Palette.Muted)
            if (retry != null) DesignButton(Copy.AttendanceRetry, retry, secondary = true)
        }
    }
}

@Composable
private fun AttendanceSummary(report: StudentAttendanceMonth, compact: Boolean, gap: Dp) {
    val summary = report.summary
    val cards = listOf(
        Triple(Copy.AttendanceRate, summary.rate?.let { "$it%" } ?: "—", Brand),
        Triple(Copy.AttendancePresent, summary.present.toString(), Palette.LiveSuccessText),
        Triple(Copy.AttendanceLate, summary.late.toString(), Palette.WarningText),
        Triple(Copy.AttendanceAbsent, summary.absent.toString(), Palette.DangerText),
    )
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
        cards.chunked(if (compact) 2 else 4).forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                line.forEach { (label, value, color) ->
                    Surface(Modifier.weight(1f), color = Palette.White, shape = RoundedCornerShape(Component.StatusCardRadius)) {
                        Column(Modifier.padding(horizontal = Space.S20, vertical = Space.S16)) {
                            Text(label, fontSize = Type.Support, color = Palette.Muted, fontWeight = DesignWeight.SemiBold)
                            Text(value, fontSize = Type.Display, lineHeight = Leading.Display, color = color, fontWeight = DesignWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthSelector(month: String, shift: (Int) -> Unit) {
    val date = LocalDate.parse("$month-01")
    Surface(color = Palette.White, shape = RoundedCornerShape(Component.StatusCardRadius)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.S4), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = { shift(-1) }, enabled = month != "2000-01") {
                DesignIcon("back", Modifier.size(Space.S18), Palette.Muted, Copy.AttendancePreviousMonth)
            }
            Text("${date.year}년 ${date.month.number}월", fontWeight = DesignWeight.Bold)
            IconButton(onClick = { shift(1) }, enabled = month != "9999-12") {
                DesignIcon("chevron", Modifier.size(Space.S18), Palette.Muted, Copy.AttendanceNextMonth)
            }
        }
    }
}

@Composable
private fun AttendanceRow(row: StudentAttendanceRow, compact: Boolean, narrow: Boolean, edit: () -> Unit) {
    val badge: @Composable () -> Unit = {
        val (ink, tint) = statusColors(row.status)
        AttendancePill(statusLabels.getValue(row.status), ink, tint)
    }
    val editButton: @Composable () -> Unit = {
        Surface(onClick = edit, modifier = Modifier.heightIn(min = Space.S36).semantics {
            contentDescription = "${row.lessonTitle} ${Copy.AttendanceEdit}"
        }, color = Palette.White, border = BorderStroke(Space.S1, Palette.Line), shape = RoundedCornerShape(Component.StatusCardRadius)) {
            Box(Modifier.padding(horizontal = Space.S12), contentAlignment = Alignment.Center) {
                Text(Copy.AttendanceEditAction, color = Brand, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
            }
        }
    }
    val lesson: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.S4)) {
            Text(attendanceDate(row.startsAt), fontSize = Type.Body, fontWeight = DesignWeight.Bold)
            AttendancePill(row.lessonTitle, Brand, Palette.Selection)
        }
    }
    val duration = if (row.firstJoinedAt == null) "—" else "${(row.durationSeconds / 60.0).roundToInt()}분"
    val durationText: @Composable (Modifier) -> Unit = { modifier ->
        Text(if (narrow) "${Copy.AttendanceDuration} $duration" else duration, modifier, fontSize = Type.Support, color = Palette.Muted)
    }
    val times: @Composable (Modifier) -> Unit = { modifier ->
        Text("${attendanceTime(row.firstJoinedAt)} ${Copy.AttendanceJoined} · ${attendanceTime(row.lastLeftAt)} ${Copy.AttendanceLeft}",
            modifier, fontSize = Type.Support)
    }

    if (compact) {
        Column(Modifier.fillMaxWidth().padding(vertical = Space.S12), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                lesson(Modifier.weight(1f)); badge()
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                if (narrow) {
                    Column(Modifier.weight(1f)) { times(Modifier); durationText(Modifier) }
                } else {
                    times(Modifier.weight(1f)); durationText(Modifier)
                }
                editButton()
            }
        }
    } else Row(Modifier.fillMaxWidth().padding(vertical = Space.S12),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S16)) {
        lesson(Modifier.weight(2f))
        times(Modifier.weight(2.35f))
        durationText(Modifier.weight(.8f))
        badge()
        editButton()
    }
}

@Composable
private fun AttendancePill(label: String, ink: Color, tint: Color) {
    Surface(color = tint, shape = RoundedCornerShape(Component.StatusCardRadius)) {
        Text(label, Modifier.padding(horizontal = Space.S10, vertical = Space.S3),
            fontSize = Type.Caption, lineHeight = 19.5.sp, color = ink, fontWeight = DesignWeight.SemiBold)
    }
}

@Composable
private fun AttendanceEditor(
    row: StudentAttendanceRow, dismiss: () -> Unit, save: suspend (StudentAttendanceInput) -> StudentAttendanceMonth,
    saved: (StudentAttendanceMonth) -> Unit,
) {
    var status by rememberSaveable { mutableStateOf(row.status) }
    var reason by rememberSaveable { mutableStateOf(row.reason) }
    var memo by rememberSaveable { mutableStateOf(row.memo.orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Dialog(onDismissRequest = { if (!busy) dismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth().imePadding().padding(Space.S20), contentAlignment = Alignment.Center) {
            val dialogHeight = maxHeight
            Surface(Modifier.widthIn(max = Layout.AttendanceDialogWidth).fillMaxWidth().heightIn(max = dialogHeight),
                color = Palette.White, shape = RoundedCornerShape(Component.StatusCardRadius)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(if (maxWidth < Layout.AttendanceDialogWidth) Space.S20 else Space.S28),
                    verticalArrangement = Arrangement.spacedBy(Space.S16)) {
                    Column {
                        Text(Copy.AttendanceEdit, Modifier.semantics { heading() },
                            fontSize = Type.Heading, lineHeight = Leading.Heading, fontWeight = DesignWeight.Bold)
                        Text("${attendanceDate(row.startsAt)} · ${row.lessonTitle}", fontSize = Type.Support, color = Palette.Muted)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                        EditLabel(Copy.AttendanceTitle)
                        Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                            statusLabels.forEach { (value, label) ->
                                val selected = status == value
                                Surface(Modifier.weight(1f), color = if (selected) Brand else Palette.AttendanceCanvas,
                                    shape = RoundedCornerShape(Component.CardRadius)) {
                                    Box(Modifier.heightIn(min = Component.InputHeight).selectable(selected, enabled = !busy,
                                        role = Role.RadioButton, onClick = { status = value }), contentAlignment = Alignment.Center) {
                                        Text(label, color = if (selected) Palette.White else Palette.Ink, fontWeight = DesignWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                        EditLabel(Copy.AttendanceReason)
                        @OptIn(ExperimentalLayoutApi::class)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                            reasonLabels.forEach { (value, label) ->
                                val active = reason == value
                                Surface(onClick = { reason = if (active) null else value }, enabled = !busy,
                                    modifier = Modifier.semantics { selected = active },
                                    color = if (active) Palette.Selection else Palette.White,
                                    border = BorderStroke(Space.S1, if (active) Brand else Palette.Line),
                                    shape = RoundedCornerShape(Component.StatusCardRadius)) {
                                    Text(label, Modifier.padding(horizontal = Space.S12, vertical = Space.S8),
                                        fontSize = Type.Support, color = if (active) Brand else Palette.Ink)
                                }
                            }
                        }
                    }
                    androidx.compose.foundation.text.BasicTextField(
                        value = memo, onValueChange = { if (it.length <= 500) memo = it }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = Copy.AttendanceMemo },
                        minLines = 2, maxLines = 4,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = Palette.Ink),
                        decorationBox = { field ->
                            Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                                EditLabel(Copy.AttendanceMemo)
                                Surface(color = Palette.AttendanceCanvas, shape = RoundedCornerShape(Component.CardRadius)) {
                                    Box(Modifier.fillMaxWidth().padding(Space.S12)) { field() }
                                }
                            }
                        },
                    )
                    error?.let { Text(it, color = Palette.DangerText) }
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                        DesignButton(Copy.AttendanceCancel, dismiss, Modifier.weight(1f), enabled = !busy, secondary = true)
                        DesignButton(if (busy) Copy.AttendanceSaving else Copy.AttendanceSave, {
                            if (!busy) {
                                busy = true
                                error = null
                                scope.launch {
                                    try {
                                        saved(save(StudentAttendanceInput(status = status, reason = reason, memo = memo)))
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (failure: Exception) {
                                        error = failure.message ?: Copy.AttendanceSaveError
                                    } finally {
                                        busy = false
                                    }
                                }
                            }
                        }, Modifier.weight(1f), enabled = !busy)
                    }
                }
            }
        }
    }
}

@Composable
private fun EditLabel(label: String) {
    Text(label, color = Palette.Muted, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
}
