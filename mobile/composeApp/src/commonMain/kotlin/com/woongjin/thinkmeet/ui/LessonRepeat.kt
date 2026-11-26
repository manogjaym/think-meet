package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.daysUntil
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.number
import kotlinx.datetime.plus

/** Same limit as server/src/lesson-series.ts. */
const val MaxSeriesLessons = 100

/** classroom.repeat-schedule choices; WEEKLY/BIWEEKLY match LessonRepeatFrequency. */
enum class LessonRepeatMode(val frequency: String?, val label: String) {
    None(null, DesignContent.LessonRepeatNone),
    Weekly("WEEKLY", DesignContent.LessonRepeatWeekly),
    Biweekly("BIWEEKLY", DesignContent.LessonRepeatBiweekly),
}

/** ISO weekday numbers (1 = Monday … 7 = Sunday) in display order. */
internal val RepeatWeekdays = listOf(1 to "월", 2 to "화", 3 to "수", 4 to "목", 5 to "금", 6 to "토", 7 to "일")

/**
 * Lesson dates (Asia/Seoul) from [start] through [until], matching the server rule.
 * BIWEEKLY keeps the first lesson's Monday-based week. Stops after [MaxSeriesLessons] + 1 dates so callers can report the limit.
 */
fun repeatDates(start: LocalDate, until: LocalDate, mode: LessonRepeatMode, weekdays: Set<Int>): List<LocalDate> {
    if (mode == LessonRepeatMode.None || until < start) return emptyList()
    val firstMonday = start.minus(start.dayOfWeek.isoDayNumber - 1, DateTimeUnit.DAY)
    val result = mutableListOf<LocalDate>()
    var day = start
    while (day <= until && result.size <= MaxSeriesLessons) {
        val evenWeek = (firstMonday.daysUntil(day) / 7) % 2 == 0
        if (day.dayOfWeek.isoDayNumber in weekdays && (mode == LessonRepeatMode.Weekly || evenWeek)) result += day
        day = day.plus(1, DateTimeUnit.DAY)
    }
    return result
}

/** Default end date: four weeks after the first lesson, minus a day. */
fun defaultRepeatUntil(start: LocalDate): LocalDate = start.plus(27, DateTimeUnit.DAY)

/** Validation message for the current rule, or null when it can be saved. */
fun repeatError(start: LocalDate?, until: LocalDate?, weekdays: Set<Int>, dates: List<LocalDate>): String? = when {
    weekdays.isEmpty() -> DesignContent.LessonRepeatWeekdaysError
    start == null || until == null || until < start -> DesignContent.LessonRepeatUntilError
    dates.isEmpty() -> DesignContent.LessonRepeatEmptyError
    dates.size > MaxSeriesLessons -> DesignContent.LessonRepeatLimitError.replace("{max}", MaxSeriesLessons.toString())
    else -> null
}

internal fun repeatShortDate(date: LocalDate): String =
    "${date.month.number}월 ${date.day}일 (${RepeatWeekdays.first { it.first == date.dayOfWeek.isoDayNumber }.second})"

/** Web LessonRepeatField: pill modes, round weekday toggles, end date and summary under the lesson time. */
@Composable
internal fun LessonRepeatField(
    mode: LessonRepeatMode, weekdays: Set<Int>, until: String, dates: List<LocalDate>, error: String?, enabled: Boolean,
    onMode: (LessonRepeatMode) -> Unit, onWeekdays: (Set<Int>) -> Unit, onUntil: (String) -> Unit, onPickUntil: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(top = Space.S24), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        LessonText(DesignContent.LessonRepeatLabel, color = Palette.TextSecondary, fontSize = Type.Support, fontWeight = DesignWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            LessonRepeatMode.entries.forEach { option ->
                val checked = mode == option
                RepeatChip(option.label, checked, enabled, CircleShape, Modifier.heightIn(min = Space.S44).semantics { role = Role.RadioButton }, { onMode(option) }) {
                    LessonText(option.label, Modifier.padding(horizontal = Space.S20), if (checked) Palette.White else Ink, Type.Support, DesignWeight.SemiBold)
                }
            }
        }
        if (mode != LessonRepeatMode.None) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                RepeatWeekdays.forEach { (day, label) ->
                    val checked = day in weekdays
                    RepeatChip("${label}요일", checked, enabled, CircleShape,
                        Modifier.weight(1f, fill = false).widthIn(max = Space.S44).aspectRatio(1f).semantics { role = Role.Checkbox },
                        { onWeekdays(if (checked) weekdays - day else weekdays + day) }) {
                        LessonText(label, color = if (checked) Palette.White else Ink, fontSize = Type.Support, fontWeight = DesignWeight.SemiBold, textAlign = TextAlign.Center)
                    }
                }
            }
            DesignTextField(until, { onUntil(it.take(10)) }, Modifier.fillMaxWidth().padding(top = Space.S8), label = DesignContent.LessonRepeatUntil,
                enabled = enabled, isError = error != null, placeholder = "YYYY-MM-DD",
                trailingIcon = { IconButton(onPickUntil, Modifier.size(Space.S24), enabled = enabled) { DesignIcon("calendar", Modifier.size(Space.S20), tint = Muted, contentDescription = DesignContent.LessonRepeatUntil) } })
            if (error == null && dates.isNotEmpty()) LessonText(
                DesignContent.LessonRepeatSummary.replace("{start}", repeatShortDate(dates.first()))
                    .replace("{until}", repeatShortDate(dates.last())).replace("{count}", dates.size.toString()),
                color = Muted, fontSize = Type.Support)
        }
        error?.let { LessonText(it, color = Palette.DangerText, fontSize = Type.Support) }
    }
}

@Composable
private fun RepeatChip(
    description: String, checked: Boolean, enabled: Boolean, shape: androidx.compose.ui.graphics.Shape, modifier: Modifier,
    onClick: () -> Unit, content: @Composable () -> Unit,
) {
    Surface(onClick = onClick, enabled = enabled, shape = shape,
        modifier = modifier.semantics { selected = checked; contentDescription = description },
        color = if (checked) Brand else Palette.White, border = BorderStroke(Space.S1, if (checked) Brand else Palette.Line)) {
        Box(contentAlignment = Alignment.Center) { content() }
    }
}
