package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.woongjin.thinkmeet.data.ApiException
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.design.Brand
import com.woongjin.thinkmeet.design.DesignButton
import com.woongjin.thinkmeet.design.DesignIcon
import com.woongjin.thinkmeet.design.DesignWeight
import com.woongjin.thinkmeet.design.generated.DesignContent as Copy
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.platform.BackHandler
import com.woongjin.thinkmeet.platform.NoteDraft
import com.woongjin.thinkmeet.platform.WorksheetCameraAccess
import com.woongjin.thinkmeet.platform.WorksheetCameraPreview
import com.woongjin.thinkmeet.platform.decodeNoteImage
import com.woongjin.thinkmeet.platform.rememberWorksheetDraft
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WorksheetCameraScreen(
    api: ThinkMeetApi, studentId: String, initialLessonId: String, initialLabel: String,
    refreshKey: Any, featureEnabled: Boolean, onClose: () -> Unit, onSubmitted: () -> Unit,
) {
    var draft by rememberWorksheetDraft(studentId)
    var confirmedId by rememberSaveable(initialLessonId) { mutableStateOf<String?>(initialLessonId) }
    var confirmedLabel by rememberSaveable(initialLessonId) { mutableStateOf(initialLabel) }
    var retry by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var access by remember { mutableStateOf(WorksheetCameraAccess()) }
    var capturing by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val target = loadNote(refreshKey to featureEnabled, retry) { if (featureEnabled) api.noteTarget() else null }
    val lesson = target.value?.lesson
    val targetChanged = target.value != null && (confirmedId == null || confirmedId != lesson?.id)
    val photo = draft
    val preview = key(photo?.bytes) {
        val bitmap by produceState<ImageBitmap?>(null) {
            value = withContext(Dispatchers.Default) { photo?.let { decodeNoteImage(it.bytes) } }
        }
        bitmap
    }
    fun close() { draft = null; onClose() }
    BackHandler(enabled = true) { if (!submitting) close() }

    Surface(Modifier.fillMaxSize().testTag("worksheet-camera"), color = Palette.MeetingCanvas, contentColor = Palette.White) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
            val gutter = if (maxWidth <= Layout.DashboardCompact) Space.S12 else Space.S20
            Column(Modifier.fillMaxSize().padding(horizontal = gutter, vertical = Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                    IconButton(onClick = ::close, enabled = !submitting) { DesignIcon("close", Modifier.size(Space.S20), Palette.White, "닫기") }
                    FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(Space.S8), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                        Text(Copy.NotesCameraTitle, Modifier.align(Alignment.CenterVertically), style = MaterialTheme.typography.titleMedium, fontWeight = DesignWeight.Bold)
                        if (confirmedLabel.isNotEmpty()) Text(confirmedLabel, Modifier.align(Alignment.CenterVertically).clip(CircleShape).background(Brand).padding(horizontal = Space.S8, vertical = Space.S4),
                            style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(Corner.R14)).background(Palette.MeetingTile), contentAlignment = Alignment.Center) {
                    if (photo == null) {
                        WorksheetCameraPreview(Modifier.fillMaxSize(), onAccess = {
                            access = it
                            if (it.error != null) capturing = false
                        }, onPhoto = { bytes, failure ->
                            capturing = false
                            error = failure
                            if (bytes != null) draft = NoteDraft(bytes)
                        })
                        if (access.error == null && access.shutter != null) {
                            val guideWidth = minOf(maxWidth * .84f, maxHeight * .65f)
                            WorksheetGuide(Modifier.width(guideWidth).aspectRatio(.8f))
                        } else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                            Text(access.error ?: Copy.NotesCameraStarting, Modifier.padding(horizontal = Space.S16), textAlign = TextAlign.Center)
                            access.retry?.let { DesignButton("다시 시도", it, secondary = true) }
                        }
                    } else preview?.let { Image(it, Copy.NotesCameraPreview, Modifier.fillMaxSize().padding(Space.S8), contentScale = ContentScale.Fit) }
                }
                val notice = error ?: target.error ?: Copy.NotesTargetChanged.takeIf { photo != null && targetChanged }
                if (notice != null) Text(notice, style = MaterialTheme.typography.bodySmall)
                if (photo != null && targetChanged && lesson != null) {
                    DesignButton("${lesson.description()} 선택", {
                        confirmedId = lesson.id
                        confirmedLabel = lesson.description()
                        error = null
                        draft = NoteDraft(photo.bytes)
                    }, enabled = !submitting, secondary = true)
                } else if (target.error != null || (photo != null && targetChanged)) {
                    DesignButton("제출할 수업 다시 확인", { retry++ }, enabled = !submitting, secondary = true)
                }
                Row(Modifier.fillMaxWidth().heightIn(min = Space.S72), verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.weight(1f))
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        if (photo == null) {
                            val shutter = access.shutter
                            Surface(onClick = { if (shutter != null && !capturing) { capturing = true; error = null; shutter() } },
                                modifier = Modifier.size(Space.S64).testTag("worksheet-shutter"), enabled = shutter != null && !capturing,
                                shape = CircleShape, color = Palette.White, contentColor = Palette.Ink, border = BorderStroke(Space.S4, Palette.MeetingMuted)) {
                                Box(contentAlignment = Alignment.Center) {
                                    if (capturing) CircularProgressIndicator(Modifier.size(Space.S20), color = Brand, strokeWidth = Space.S2)
                                    else Text(Copy.NotesCameraShutter, style = MaterialTheme.typography.labelMedium, fontWeight = DesignWeight.Bold)
                                }
                            }
                        } else DesignButton(Copy.NotesCameraRetake, {
                            access = WorksheetCameraAccess()
                            error = null
                            draft = null
                        }, enabled = !submitting, secondary = true)
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                        if (photo != null) DesignButton(if (submitting) Copy.NotesCameraSubmitting else Copy.NotesCameraSubmit, {
                            val selected = confirmedId ?: return@DesignButton
                            if (submitting || !featureEnabled || targetChanged || lesson == null) return@DesignButton
                            submitting = true
                            error = null
                            scope.launch {
                                try {
                                    api.submitNoteWorksheet(selected, photo.bytes, photo.requestId)
                                    draft = null
                                    onSubmitted()
                                } catch (failure: Exception) {
                                    if (failure is CancellationException) throw failure
                                    error = failure.message ?: "학습지를 제출하지 못했어요."
                                    if (failure is ApiException && failure.code == "NOTE_TARGET_CHANGED") { confirmedId = null; retry++ }
                                } finally { submitting = false }
                            }
                        }, enabled = featureEnabled && lesson != null && !targetChanged && !submitting && preview != null)
                    }
                }
            }
        }
    }
}

@Composable
private fun WorksheetGuide(modifier: Modifier) {
    Box(modifier) {
        Canvas(Modifier.fillMaxSize()) {
            val inset = Space.S2.toPx()
            drawRoundRect(Palette.White, Offset(inset, inset), Size((size.width - 2 * inset).coerceAtLeast(0f), (size.height - 2 * inset).coerceAtLeast(0f)),
                CornerRadius(Corner.R10.toPx()), style = Stroke(inset, pathEffect = PathEffect.dashPathEffect(floatArrayOf(Space.S8.toPx(), Space.S4.toPx()))))
        }
        Text(Copy.NotesCameraGuide, Modifier.align(Alignment.BottomCenter).padding(Space.S8).clip(CircleShape)
            .background(Palette.Black.copy(alpha = .72f)).padding(horizontal = Space.S8, vertical = Space.S4),
            style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
    }
}
