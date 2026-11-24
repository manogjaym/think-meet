package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.background
import com.woongjin.thinkmeet.data.LessonRecording
import com.woongjin.thinkmeet.design.Brand
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent as Copy
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.platform.RecordingPlayerDialog
import kotlinx.datetime.number
import kotlin.time.Clock
import kotlin.time.Instant

internal fun recordingDuration(ms: Long): String {
    val seconds = (ms / 1000).coerceAtLeast(0)
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val rest = (seconds % 60).toString().padStart(2, '0')
    return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:$rest" else "$minutes:$rest"
}

internal fun recordingSize(bytes: Long): String =
    if (bytes >= 1024L * 1024 * 1024) "${(bytes * 10 / (1024L * 1024 * 1024)) / 10.0}GB" else "${(bytes / (1024 * 1024)).coerceAtLeast(1)}MB"

/** Whole days until the server removes the recording, rounded up. */
internal fun recordingDaysLeft(expiresAt: String, now: Instant = Clock.System.now()): Long =
    runCatching { ((Instant.parse(expiresAt) - now).inWholeMilliseconds + 86_399_999) / 86_400_000 }.getOrDefault(0).coerceAtLeast(0)

private fun recordingTime(value: String): String = localDateTime(value)?.let {
    "${it.month.number}월 ${it.day}일 ${if (it.hour >= 12) "오후" else "오전"} ${(it.hour % 12).takeIf { hour -> hour != 0 } ?: 12}:${it.minute.toString().padStart(2, '0')}"
} ?: value

@Composable
private fun RecordingPill(text: String, done: Boolean) {
    val status = if (done) Palette.Success else Palette.Pending
    Text(text, Modifier.background(lerp(Palette.White, status, .12f), RoundedCornerShape(percent = 50)).padding(horizontal = Space.S8, vertical = Space.S2),
        style = MaterialTheme.typography.labelMedium, fontWeight = DesignWeight.SemiBold, color = lerp(Palette.Ink, status, .7f))
}

/** Teacher lesson detail: recordings kept on the server for 30 days, plus uploads still on this device. */
@Composable
internal fun TeacherRecordings(controller: AppState, lessonId: String) {
    val api = controller.api
    val uploads by controller.recordings.uploads.collectAsState()
    val local = uploads.filter { it.lessonId == lessonId }
    var retry by remember(lessonId) { mutableIntStateOf(0) }
    // Reload when a local upload for this lesson finishes so the new row becomes playable.
    val finished = local.count { it.finished && it.error == null }
    val list = loadNote(lessonId to finished, retry) { api.recordings(lessonId) }
    var playing by remember(lessonId) { mutableStateOf<LessonRecording?>(null) }
    var cookie by remember(lessonId) { mutableStateOf<String?>(null) }
    val phone = LocalLessonWidth.current <= Layout.RootNavigationMobile
    NoteCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignIcon("video", Modifier.size(Space.S20), Brand)
            Text(Copy.RecordingListTitle, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, color = Palette.Ink)
        }
        local.filter { !it.finished || it.error != null }.forEach { upload -> RecordingUploadRow(controller, upload) }
        val rows = list.value
        if (rows == null) NoteLoadStatus(list.error) { retry++ }
        else if (rows.isEmpty() && local.none { !it.finished }) Text(Copy.RecordingEmpty, color = Palette.Muted)
        else Column(verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            rows.forEach { row ->
                val ready = row.status == "ready"
                NoteRow("video", "${recordingTime(row.startedAt)} · ${recordingDuration(row.durationMs)}", enabled = ready, onClick = { playing = row }) {
                    if (!phone) Text("${recordingSize(row.size)} · ${recordingDaysLeft(row.expiresAt)}일 후 삭제", style = MaterialTheme.typography.labelMedium, color = Palette.Muted)
                    RecordingPill(if (ready) Copy.RecordingPlay else "${Copy.RecordingUploading} ${(row.uploadedBytes * 100 / row.size.coerceAtLeast(1))}%", ready)
                }
            }
        }
    }
    val selected = playing
    if (selected != null) {
        LaunchedEffect(selected.id) { cookie = api.cookieHeader() }
        cookie?.let { RecordingPlayerDialog(api.recordingContentUrl(selected.id), it) { playing = null } }
    }
}

/** One local upload: progress, or the failure with a retry button. */
@Composable
internal fun RecordingUploadRow(controller: AppState, upload: RecordingUpload) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S6)) {
        when {
            upload.finished && upload.error == null ->
                Text("녹화 영상을 올렸어요. 수업 상세에서 30일 동안 다시 볼 수 있어요.", style = MaterialTheme.typography.bodyMedium, color = Palette.Success)
            upload.finished -> Text("${Copy.RecordingUploadFailed}: ${upload.error}", style = MaterialTheme.typography.bodyMedium, color = Palette.DangerText)
            else -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                    Text("녹화 영상 ${Copy.RecordingUploading}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = Palette.TextSecondary)
                    Text("${upload.percent}% · ${recordingSize(upload.size)}", style = MaterialTheme.typography.labelMedium, color = Palette.Muted)
                }
                LinearProgressIndicator(progress = { upload.percent / 100f }, Modifier.fillMaxWidth(), color = Brand, trackColor = Palette.Line)
                upload.error?.let { error ->
                    Text("$error 자동으로 다시 시도해요.", style = MaterialTheme.typography.labelMedium, color = Palette.DangerText)
                    DesignButton(Copy.RecordingUploadRetry, controller.recordings::retry, secondary = true)
                }
            }
        }
    }
}

/** End screen: the recording that was just made keeps uploading while the teacher reads the summary. */
@Composable
internal fun EndedRecordingUploads(controller: AppState, lessonId: String) {
    val uploads by controller.recordings.uploads.collectAsState()
    val local = uploads.filter { it.lessonId == lessonId }
    if (local.isEmpty()) return
    Spacer(Modifier.height(Space.S16))
    NoteCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignIcon("video", Modifier.size(Space.S20), Brand)
            Text(Copy.RecordingListTitle, style = MaterialTheme.typography.titleMedium, fontWeight = DesignWeight.Bold, color = Palette.TextSecondary)
        }
        local.forEach { RecordingUploadRow(controller, it) }
    }
}
