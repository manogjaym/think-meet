package com.woongjin.thinkmeet.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.woongjin.thinkmeet.ErrorCard
import com.woongjin.thinkmeet.data.ApiError
import com.woongjin.thinkmeet.data.ContractProtocol
import com.woongjin.thinkmeet.data.Lesson
import com.woongjin.thinkmeet.data.PrejoinStatus
import com.woongjin.thinkmeet.data.User
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.TimeSource

@Composable internal fun EnhancedPrejoinScreen(lesson: Lesson, user: User, state: AppUiState, controller: AppState) {
    val media = rememberMediaController()
    val previewAudio = media as PreviewAudio
    val mediaState by media.state.collectAsState()
    val foreground = prejoinInForeground()
    val scope = rememberCoroutineScope()
    var camera by remember { mutableStateOf(readPreference("devices.camera", "true") == "true") }
    var microphone by remember { mutableStateOf(readPreference("devices.microphone", "false") == "true") }
    var cameraRetry by remember { mutableIntStateOf(0) }
    var microphoneRetry by remember { mutableIntStateOf(0) }
    var probeRetry by remember { mutableIntStateOf(0) }
    var microphoneCheck by remember { mutableStateOf(PreviewDevice.Checking) }
    var level by remember { mutableFloatStateOf(0f) }
    var levelJob by remember { mutableStateOf<Job?>(null) }
    var sound by remember { mutableStateOf(DesignContent.PrejoinSoundReady) }
    var soundJob by remember { mutableStateOf<Job?>(null) }
    var probe by remember(lesson.id) { mutableStateOf<PrejoinStatus?>(null) }
    var latency by remember(lesson.id) { mutableStateOf<Long?>(null) }
    var probeFailed by remember(lesson.id) { mutableStateOf(false) }
    var handoff by remember { mutableStateOf(false) }
    val capture = foreground && !handoff
    val owner = lesson.teacher.id == user.id
    val lessonModes = controller.capabilities.collectAsState().value.supports(ContractProtocol.FeatureIds.ClassroomLessonModes)
    val status = probe?.status ?: lesson.status
    val scheduled = status == "SCHEDULED"

    LaunchedEffect(state.error) { if (state.error != null) handoff = false }
    LaunchedEffect(lesson.id, foreground, probeRetry) {
        if (!foreground) return@LaunchedEffect
        probeFailed = false
        while (true) {
            val start = TimeSource.Monotonic.markNow()
            val result = try { withTimeoutOrNull(4_000) { controller.api.prejoinStatus(lesson.id) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: ApiError) {
                if (error.status in listOf(403, 404)) {
                    controller.prejoinUnavailable(lesson.id, message = error.message)
                    return@LaunchedEffect
                }
                if (error.status == 401) return@LaunchedEffect
                null
            } catch (_: Exception) { null }
            probe = result
            probeFailed = result == null
            latency = result?.let { start.elapsedNow().inWholeMilliseconds }
            if (result?.status == "ENDED" || result?.status == "CANCELLED") {
                controller.prejoinUnavailable(lesson.id, status = result.status)
                return@LaunchedEffect
            }
            delay(5_000)
        }
    }
    DisposableEffect(previewAudio, capture, microphone, microphoneRetry) {
        level = 0f
        microphoneCheck = PreviewDevice.Checking
        val job = if (capture && microphone) scope.launch {
            try {
                previewAudio.checkPreviewMicrophone {
                    microphoneCheck = PreviewDevice.Connected
                    level = it
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                microphoneCheck = (error as? PreviewDeviceException)?.status ?: PreviewDevice.Failed
                level = 0f
            }
        } else null
        levelJob = job
        onDispose { job?.cancel() }
    }
    LaunchedEffect(capture) {
        if (!capture) {
            soundJob?.cancelAndJoin()
            sound = DesignContent.PrejoinSoundReady
        }
    }
    fun testSound() {
        if (soundJob?.isActive == true) return
        sound = DesignContent.PrejoinSoundPlaying
        soundJob = scope.launch {
            sound = try {
                previewAudio.playPreviewTone()
                DesignContent.PrejoinSoundPlayed
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { DesignContent.PrejoinSoundFailed }
        }
    }
    fun join() {
        if (state.busy || handoff) return
        handoff = true
        val microphoneJob = levelJob
        scope.launch {
            microphoneJob?.cancelAndJoin()
            soundJob?.cancelAndJoin()
            controller.devices(camera, microphone)
            controller.join()
        }
    }
    val heading: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            StatusBadge(status)
            LessonText(lesson.title, fontSize = Type.Title, lineHeight = Type.Title * 1.3462f, fontWeight = DesignWeight.Bold)
            LessonText("${lesson.teacher.name} 선생님 · ${lessonStartLabel(lesson.startsAt)}", color = Muted, fontSize = Type.Support)
        }
    }
    val account: @Composable () -> Unit = {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.S12), verticalAlignment = Alignment.CenterVertically) {
            DesignAvatar(user.name, user.id)
            Column(verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                LessonText("다음 계정으로 참여", fontSize = Type.Caption, color = Muted)
                LessonText("${user.name} ${if (user.isTeacher) "선생님" else "학생"}", fontSize = Type.Body,
                    fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary)
            }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        val viewport = maxWidth
        val phone = viewport <= LayoutToken.PrejoinPhone
        val wide = viewport > LayoutToken.PrejoinWide
        val compact = wide && viewport <= LayoutToken.PrejoinCompactBreakpoint
        val previewHeightLimit = if (!phone && !wide) maxHeight * .3f else Dp.Infinity
        val gutter = if (phone) Space.S24 else if (compact) Space.S28 else Space.S40
        val pageGap = if (compact) Space.S32 else if (wide) (viewport * .05f).coerceIn(Space.S40, Space.S64) else Space.S24
        val preview: @Composable (Modifier) -> Unit = { modifier ->
            Column(modifier) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val ratio = if (phone) 4f / 3f else if (wide) 16f / 10f else 16f / 9f
                    val previewStatus = mediaState.previewCamera
                    val visible = capture && camera && (previewStatus == PreviewDevice.Connected)
                    Surface(Modifier.fillMaxWidth().height((maxWidth / ratio).coerceAtMost(previewHeightLimit)),
                        color = if (visible) Palette.PrejoinBackground else Palette.PrejoinCameraOff,
                        shape = RoundedCornerShape(if (phone) Corner.R10 else Corner.R14)) {
                        Box(contentAlignment = Alignment.Center) {
                            if (capture && camera) key(cameraRetry) { CameraPreview(media, true, Modifier.fillMaxSize()) }
                            if (!visible) Column(Modifier.padding(bottom = Space.S24), horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(Space.S12)) {
                                DesignAvatar(user.name, user.id, size = if (phone) Space.S72 else ComponentToken.PrejoinAvatarSize)
                                LessonText(if (camera) previewLabel(previewStatus) else "카메라가 꺼져 있습니다", color = Palette.PrejoinHint, fontSize = Type.Support)
                            }
                            Surface(Modifier.align(Alignment.TopStart).padding(Space.S16), color = Palette.PrejoinBackground, shape = RoundedCornerShape(Corner.R8)) {
                                LessonText("${user.name} · 나", Modifier.padding(horizontal = Space.S12, vertical = Space.S4),
                                    fontSize = Type.Support, color = Palette.Line, fontWeight = DesignWeight.Medium)
                            }
                            Row(Modifier.align(Alignment.BottomCenter).padding(bottom = if (phone) Space.S12 else Space.S16),
                                horizontalArrangement = Arrangement.spacedBy(if (phone) Space.S8 else Space.S12)) {
                                PreviewControl(if (microphone) "mic" else "micOff", if (microphone) "마이크 끄기" else "마이크 켜기", microphone, phone) {
                                    microphone = !microphone
                                    writePreference("devices.microphone", microphone.toString())
                                }
                                PreviewControl(if (camera) "video" else "videoOff", if (camera) "카메라 끄기" else "카메라 켜기", camera, phone) {
                                    camera = !camera
                                    writePreference("devices.camera", camera.toString())
                                }
                                if (visible && mediaState.canFlipPreview)
                                    PreviewControl("cameraFlip", "카메라 전환", true, phone) {
                                        scope.launch {
                                            try { media.flipCamera() }
                                            catch (cancelled: CancellationException) { throw cancelled }
                                            catch (_: Exception) { cameraRetry++ }
                                        }
                                    }
                            }
                        }
                    }
                }
            }
        }
        val information: @Composable (Modifier) -> Unit = { modifier ->
            Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.S16)) {
                LessonCard(padding = Space.S16) {
                    LessonText(DesignContent.PrejoinDevices, fontSize = Type.Body, fontWeight = DesignWeight.SemiBold)
                    val cameraStatus = if (camera) previewLabel(mediaState.previewCamera) else DesignContent.PrejoinOff
                    val micStatus = if (microphone) previewLabel(microphoneCheck) else DesignContent.PrejoinOff
                    PrejoinDeviceRow("video", DesignContent.PrejoinCamera, cameraStatus, cameraStatus == DesignContent.PrejoinConnected) {
                        if (camera && mediaState.previewCamera in previewErrors) TextButton({ cameraRetry++ }) { Text(DesignContent.PrejoinRetry) }
                    }
                    PrejoinDeviceRow("mic", DesignContent.PrejoinMicrophone, micStatus, micStatus == DesignContent.PrejoinConnected) {
                        LinearProgressIndicator(progress = { level }, modifier = Modifier.fillMaxWidth())
                        if (microphone && microphoneCheck in previewErrors) TextButton({ microphoneRetry++ }) { Text(DesignContent.PrejoinRetry) }
                    }
                    PrejoinDeviceRow("speaker", DesignContent.PrejoinSpeaker, sound, sound == DesignContent.PrejoinSoundPlayed) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            LessonText(DesignContent.PrejoinSystemOutput, Modifier.weight(1f), color = Muted, fontSize = Type.Support)
                            TextButton(::testSound, enabled = capture && sound != DesignContent.PrejoinSoundPlaying) { Text(DesignContent.PrejoinSoundTest) }
                        }
                    }
                    val networkStatus = latency?.let { "$it ms" } ?: if (probeFailed) DesignContent.PrejoinFailed else DesignContent.PrejoinChecking
                    PrejoinDeviceRow("wifi", DesignContent.PrejoinNetwork, networkStatus, latency != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            LessonText(DesignContent.PrejoinServer, Modifier.weight(1f), color = Muted, fontSize = Type.Support)
                            if (probeFailed) TextButton({ probeRetry++ }) { Text(DesignContent.PrejoinRetry) }
                        }
                    }
                }
                if (owner && scheduled) {
                    val students = probe?.waitingStudents.orEmpty()
                    LessonCard(padding = Space.S16) {
                        val title = DesignContent.PrejoinWaitingStudents + if (students.size > 1) " · ${students.size}명" else ""
                        LessonText(title, fontSize = Type.Body, fontWeight = DesignWeight.SemiBold)
                        Spacer(Modifier.height(Space.S8))
                        LessonText(when {
                            probeFailed -> DesignContent.PrejoinWaitingFailed
                            probe == null -> DesignContent.PrejoinChecking
                            students.isEmpty() -> DesignContent.PrejoinWaitingEmpty
                            else -> students.joinToString(", ") { it.name }
                        }, color = Muted, fontSize = Type.Support)
                    }
                }
                if (lesson.isOpen) LessonText("공개 수업 · 로그인한 누구나 참여할 수 있어요.", color = Muted, fontSize = Type.Support)
                if (!scheduled) {
                    val participants = lesson.students.filter { person -> lesson.participants.any { it.userId == person.id } }
                    LessonText(if (participants.isNotEmpty()) "${participants.size}명이 먼저 참여하고 있어요" else "아직 참여 중인 사람이 없어요",
                        color = Muted, fontSize = Type.Support)
                }
                state.error?.let { ErrorCard(it) }
                DesignButton(when {
                    state.busy || handoff -> "입장 확인 중…"
                    owner && scheduled -> if (lessonModes) DesignContent.MeetingEnter else "수업 시작하기"
                    scheduled -> DesignContent.PrejoinWaitAction
                    else -> "지금 참여하기"
                }, ::join, Modifier.fillMaxWidth().heightIn(min = Space.S54), enabled = !state.busy && !handoff,
                    trailingIcon = { DesignIcon("chevron", Modifier.size(Space.S18), tint = Palette.White) },
                    textStyle = MaterialTheme.typography.bodyLarge)
            }
        }
        Column(Modifier.widthIn(max = if (wide) LayoutToken.PrejoinMaxWidth else LayoutToken.PrejoinSingleMaxWidth)
            .fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = gutter)
            .padding(top = if (phone) Space.S16 else if (wide) Space.S32 else Space.S24, bottom = if (phone) Space.S32 else Space.S48),
            verticalArrangement = Arrangement.spacedBy(pageGap)) {
            if (phone) Column(verticalArrangement = Arrangement.spacedBy(Space.S16)) { heading(); account() }
            else Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.S16)) {
                    Box(Modifier.weight(1f)) { heading() }
                    account()
                }
            if (wide) Row(horizontalArrangement = Arrangement.spacedBy(pageGap)) {
                preview(Modifier.weight(if (compact) 1.2f else 1.45f))
                information(if (compact) Modifier.width(LayoutToken.PrejoinInfoMinWidth) else Modifier.weight(.9f))
            }
            else Column(verticalArrangement = Arrangement.spacedBy(pageGap), horizontalAlignment = Alignment.CenterHorizontally) {
                preview(Modifier.fillMaxWidth())
                information(Modifier.fillMaxWidth())
            }
        }
    }
}

private val previewErrors = setOf(PreviewDevice.Permission, PreviewDevice.Unavailable, PreviewDevice.Failed)

private fun previewLabel(state: PreviewDevice) = when (state) {
    PreviewDevice.Checking -> DesignContent.PrejoinChecking
    PreviewDevice.Connected -> DesignContent.PrejoinConnected
    PreviewDevice.Permission -> DesignContent.PrejoinPermission
    PreviewDevice.Unavailable -> DesignContent.PrejoinUnavailable
    PreviewDevice.Failed -> DesignContent.PrejoinFailed
}

@Composable private fun PrejoinDeviceRow(icon: String, title: String, status: String, healthy: Boolean, content: @Composable () -> Unit) {
    Spacer(Modifier.height(Space.S12))
    HorizontalDivider(color = Palette.Line)
    Row(Modifier.fillMaxWidth().padding(top = Space.S12), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
        DesignIcon(icon, Modifier.size(Space.S20), tint = Brand)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                LessonText(title, Modifier.weight(1f), fontSize = Type.Support, fontWeight = DesignWeight.SemiBold)
                LessonText(status, color = if (healthy) Palette.Success else Muted, fontSize = Type.Caption)
            }
            content()
        }
    }
}
