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


internal enum class Panel(val title: String) { Chat(DesignContent.MeetingChatPanel), People(DesignContent.MeetingPeoplePanel), Materials("콘텐츠 공유"), Settings("설정"), More("더보기"), Invite("참여 링크 공유") }

@Stable
internal class MeetingChatDraft {
    var text by mutableStateOf("")
    var pendingId by mutableStateOf<String?>(null)
}

/** Uses the same authenticated HTTP and Socket.IO session as the existing web client. */
@Composable
fun MeetingScreen(
    api: ThinkMeetApi,
    lesson: Lesson,
    user: User,
    admission: JoinResult,
    camera: Boolean,
    microphone: Boolean,
    onExit: (ended: Boolean) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val media = rememberMediaController()
    val mediaState by media.state.collectAsState()
    val pip = rememberPictureInPictureController(media)
    val pipState by pip.state.collectAsState()
    val remote = rememberRemoteAssistanceController(media)
    val remoteState by remote.state.collectAsState()
    val capabilities by api.capabilities.collectAsState()
    val realtime = remember(api, lesson.id) { MeetingRealtime(api, scope, lesson.id) }
    val liveSnapshot by realtime.snapshot.collectAsState()
    val socketConnected by realtime.connected.collectAsState()
    val subscribed by realtime.subscribed.collectAsState()
    val snapshot = liveSnapshot
    val currentLesson = snapshot?.lesson ?: lesson
    val owner = currentLesson.teacher.id == user.id
    val assistance = snapshot?.assistance
    val phase = snapshot?.instruction?.phase
    val lessonModes = capabilities.supports(ContractProtocol.FeatureIds.ClassroomLessonModes)
    val canShare = snapshot != null && (phase == null || (owner && phase == "classroom"))
    val showMaterials = owner && canShare
    val textbookEnabled = showMaterials && capabilities.supports(ContractProtocol.FeatureIds.ClassroomTextbookPicker)
    val textbookLayout = textbookEnabled && snapshot.share?.type == "document"
    val modeReady = subscribed && mediaState.connected &&
        snapshot?.participants?.any { it.user.id == user.id && it.online } == true
    var showMirroringStudents by remember { mutableStateOf(false) }
    val notesEnabled = capabilities.supports(ContractProtocol.FeatureIds.ClassroomNotes) && (owner || user.role == "student")
    val capture = remember(api, lesson.id) { NoteCaptureController(api, lesson.id, scope) }
    val assistanceEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance)
    val snackbar = remember { SnackbarHostState() }
    var panel by remember { mutableStateOf<Panel?>(null) }
    var confirmLeave by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(true) }
    val chat = remember(user.id) { ChatUnreadTracker(user.id) }
    val unread = chat.unread
    val notification = chat.notification
    var miniPreference by remember(lesson.id) { mutableStateOf<Boolean?>(null) }
    val miniPosition = remember(lesson.id) { MiniVideoPosition() }
    val chatDraft = remember(lesson.id) { MeetingChatDraft() }
    val pipTarget = remember(mediaState.participants, currentLesson.teacher.id, snapshot?.share, assistance, remote) {
        if (assistance?.let { it.studentId == user.id && it.status == "active" } == true)
            assistancePipTarget(remote, user.id, currentLesson.teacher.id, assistance.geometry)
        else selectPipTarget(mediaState.participants, user.id, currentLesson.teacher.id,
            sharedScreenOwner = snapshot?.share?.takeIf { it.type == "screen" }?.ownerId)
    }
    val miniTarget = remember(mediaState.participants, currentLesson.teacher.id) {
        selectMiniVideoTarget(mediaState.participants, user.id, currentLesson.teacher.id)
    }
    val miniVisible = miniPreference ?: false
    val people = (snapshot?.participants.orEmpty().map { it.user } + currentLesson.students + currentLesson.teacher + user).distinctBy { it.id }
    fun videoName(target: PipVideoTarget?): String = people.firstOrNull { it.id == target?.identity }?.name
        ?: mediaState.participants.firstOrNull { it.identity == target?.identity }?.name?.takeIf { it.isNotBlank() }
        ?: "수업 영상"
    val latestExit by rememberUpdatedState(onExit)
    val showMessage: (String) -> Unit = { message -> scope.launch { snackbar.showSnackbar(message) } }
    val report: (Throwable) -> Unit = { error ->
        if (error is CancellationException) throw error
        showMessage(error.message ?: "요청을 처리하지 못했어요.")
    }
    val latestReport by rememberUpdatedState(report)
    val session = remember(realtime, media, pip, remote) {
        MeetingSession(ApiMeetingSessionTransport(api, realtime, lesson.id), media, pip, remote,
            onExit = { latestExit(it) }, report = showMessage)
    }
    val sessionState by session.state.collectAsState()
    val (busy, exited, fatalError) = sessionState
    val screenShare = remember(api, realtime, media, user.id) {
        ScreenShareSession(media, RealtimeScreenShareTransport(api, realtime), user.id, scope) { latestReport(it) }
    }
    val ownScreen = snapshot?.share?.takeIf { it.type == "screen" && it.ownerId == user.id && it.assistanceId == null }
    val compactSystemPip = platformName() == "Android" && (pipState.active || pipState.transitioning) && !exited && fatalError == null
    val assistanceSession = remember(api, realtime, remote, pip, user.id) {
        RemoteAssistanceSession(api, realtime, remote, pip, user.id, scope) { latestReport(it) }
    }
    val assistanceBusy by assistanceSession.busy.collectAsState()
    val pipEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingPip) && pipState.supported &&
        mediaState.connected && !exited && !busy && fatalError == null && currentLesson.canJoin && pipTarget != null &&
        (!assistanceBusy || assistance?.status == "active")
    DisposableEffect(assistanceSession) { onDispose { assistanceSession.close() } }
    fun execute(block: suspend () -> Unit) { scope.launch { try { block() } catch (e: Throwable) { report(e) } } }

    fun openMode(mode: String) {
        panel = null
        if (mode == "mirroring") showMirroringStudents = true
        else if (ownScreen == null || phase != "classroom") screenShare.startCapture()
    }
    val latestOpenMode by rememberUpdatedState(::openMode)
    val modes = remember(realtime) {
        LessonModeController(RealtimeLessonModeTransport(realtime), scope, { latestReport(it) }, openMaterials = { panel = Panel.Materials }) { latestOpenMode(it) }
    }
    val modeBusy = modes.busy
    /** `materials` opens the textbook panel instead of the mode's own popup once the mode is entered. */
    fun selectMode(mode: String, materials: Boolean = false) = modes.select(mode, phase, modeReady, snapshot?.share?.id, assistance?.id, materials)

    LaunchedEffect(showMaterials, panel) {
        if (!showMaterials && panel == Panel.Materials) panel = null
    }
    LaunchedEffect(phase) {
        if (phase != "mirroring") showMirroringStudents = false
    }

    DisposableEffect(session) {
        session.start(admission, camera, microphone)
        onDispose { session.close() }
    }
    DisposableEffect(screenShare) {
        screenShare.observe()
        onDispose { screenShare.close() }
    }

    SideEffect {
        // The native close event is sticky until consumed; do not clear it during disconnection.
        if (!pipState.closedByUser) pip.update(pipEnabled, pipTarget.takeIf { pipEnabled })
    }
    LaunchedEffect(pipState.error) { pipState.error?.let { snackbar.showSnackbar(it) } }

    // A mirroring student gets lesson actions in the system PiP menu (and an Android text button bar); the OS supplies expand/close.
    val ownMirror = snapshot?.share?.takeIf { share ->
        assistance?.let { it.studentId == user.id && it.status == "active" && share.assistanceId == it.id } == true &&
            share.type == "screen" && share.ownerId == user.id
    }
    val pipActions = if (ownMirror == null) emptyList() else listOfNotNull(
        PipAction.CaptureScreen.takeIf { notesEnabled && admission.admissionId != null }, PipAction.StopMirroring)
    SideEffect { pip.setActions(pipActions) }
    val latestMirror by rememberUpdatedState(ownMirror)
    val latestCompactPip by rememberUpdatedState(compactSystemPip)
    var mirrorCaptureBusy by remember { mutableStateOf(false) }
    LaunchedEffect(pip) {
        // The app's own UI is hidden in PiP, so results there use a system notice.
        fun notice(message: String) { if (latestCompactPip) pip.showNotice(message) else showMessage(message) }
        pip.actions.collect { action ->
            val share = latestMirror ?: return@collect
            when (action) {
                PipAction.StopMirroring -> {
                    // Sharing ends with the student back in the full-screen classroom, not in a leftover PiP.
                    pip.restore()
                    share.assistanceId?.let { id -> execute { assistanceSession.stop(id) } }
                }
                PipAction.CaptureScreen -> if (!mirrorCaptureBusy) {
                    mirrorCaptureBusy = true
                    scope.launch {
                        try {
                            val admissionId = admission.admissionId ?: error(DesignContent.MirroringCaptureFailed)
                            val image = remote.captureScreenFrame() ?: error(DesignContent.MirroringCaptureFailed)
                            api.saveNoteCapture(lesson.id, image, uniqueId(), share.id, share.page, admissionId)
                            notice(DesignContent.NotesCaptureSaved)
                        } catch (error: CancellationException) { throw error }
                        catch (error: Throwable) { notice(error.message ?: DesignContent.MirroringCaptureFailed) }
                        finally { mirrorCaptureBusy = false }
                    }
                }
            }
        }
    }

    BackHandler { confirmLeave = true }
    LaunchedEffect(realtime) {
        realtime.errors.collectLatest { snackbar.showSnackbar(it) }
    }
    // Teacher requests reach only this student's socket; the server has already checked the teacher.
    LaunchedEffect(realtime, user.id) {
        realtime.mediaRequests.collect { request ->
            if (request.userId != user.id) return@collect
            val notices = mutableListOf<String>()
            request.microphone?.let { notices += if (it) DesignContent.ParticipantNoticeMicOn else DesignContent.ParticipantNoticeMicOff }
            request.camera?.let { notices += if (it) DesignContent.ParticipantNoticeCameraOn else DesignContent.ParticipantNoticeCameraOff }
            showMessage(notices.joinToString(" "))
            execute {
                request.microphone?.let { media.setMicrophone(it) }
                request.camera?.let { media.setCamera(it) }
            }
        }
    }
    val ownAnnotation = snapshot?.participants?.firstOrNull { it.user.id == user.id }?.annotationAllowed
    var previousAnnotation by remember(lesson.id) { mutableStateOf(ownAnnotation) }
    LaunchedEffect(ownAnnotation) {
        val previous = previousAnnotation
        previousAnnotation = ownAnnotation
        if (!owner && phase != null && previous != null && ownAnnotation != null && previous != ownAnnotation) {
            showMessage(if (ownAnnotation) DesignContent.ParticipantAnnotationAllowed else DesignContent.ParticipantAnnotationRevoked)
        }
    }
    val participantControls = if (capabilities.supports(ContractProtocol.FeatureIds.MeetingParticipantControls) && snapshot != null) {
        ParticipantControlState(user.id, currentLesson.teacher.id, phase != null, snapshot.participants,
            control = { payload -> realtime.send(ContractProtocol.Commands.ParticipantControl, payload) },
            setMicrophone = { media.setMicrophone(it) }, setCamera = { media.setCamera(it) }, report = report)
    } else null
    LaunchedEffect(snapshot?.messages?.lastOrNull()?.id, panel) { chat.update(snapshot?.messages, panel == Panel.Chat) }
    LaunchedEffect(notification?.id) {
        val id = notification?.id ?: return@LaunchedEffect
        delay(8_000)
        chat.dismiss(id)
    }

    // One panel body for both the docked column and the narrow-screen overlay.
    val panelContent: @Composable (closeAfterTextbook: Boolean) -> Unit = { closeAfterTextbook ->
        panel?.let { current ->
            MeetingPanel(current, api, currentLesson, user, snapshot, realtime, onClose = { panel = null }, report = report,
                chatDraft = chatDraft, media = media, mediaState = mediaState, onPanel = { panel = it }, unread = unread,
                miniVisible = miniVisible, onMini = { miniPreference = !miniVisible }, pipState = pipState, pipEnabled = pipEnabled,
                textbookEnabled = textbookEnabled, textbookConnected = modeReady, closeAfterTextbook = closeAfterTextbook,
                onPip = { execute { api.requireFeature(ContractProtocol.FeatureIds.MeetingPip); try { pip.enter() } catch (error: Throwable) { if (error is CancellationException || pip.state.value.error == null) throw error } } })
        }
    }

    MeetingStageTheme {
    BoxWithConstraints(Modifier.fillMaxSize().background(Palette.MeetingCanvas)) {
        var retainedSize by remember { mutableStateOf<DpSize?>(null) }
        val currentSize = DpSize(maxWidth, maxHeight)
        SideEffect { if (!compactSystemPip) retainedSize = currentSize }
        val frozenSize = retainedSize.takeIf { compactSystemPip }
        val mainSize = if (frozenSize != null) Modifier.requiredSize(frozenSize.width, frozenSize.height) else Modifier.fillMaxSize()
        // Preserve document/annotation/chat state while only the compact native renderer is visible.
        val presentation = if (compactSystemPip) Modifier.alpha(0f).clearAndSetSemantics {} else Modifier
        CompositionLocalProvider(LocalMeetingVideoRendering provides !compactSystemPip) {
        BoxWithConstraints(mainSize.then(presentation).background(Palette.MeetingCanvas).safeDrawingPadding()) {
            val windowWidth = maxWidth
            val compact = windowWidth <= LayoutToken.MeetingCompactBreakpoint
            val overlayPanel = maxWidth <= LayoutToken.MeetingOverlayBreakpoint
            val dockedTextbook = !overlayPanel && textbookLayout && panel == Panel.Materials
            // Wide owner screens keep participant videos and the materials card in a right rail; a panel replaces the card.
            val teacherRail = owner && lessonModes && phase != null && !overlayPanel && !compactSystemPip
            val sideWidth = if (overlayPanel) LayoutToken.MeetingPanelWidth else if (maxWidth <= LayoutToken.MeetingMediumBreakpoint) LayoutToken.MeetingPanelNarrowWidth else LayoutToken.MeetingPanelWidth
            val bodyPadding = if (compact) Space.S10 else if (maxWidth <= LayoutToken.MeetingMediumBreakpoint) Space.S16 else Space.S20
            CompositionLocalProvider(LocalMeetingCompact provides compact, LocalMeetingViewportWidth provides maxWidth, LocalMeetingShort provides (maxHeight <= LayoutToken.MeetingShortHeight && !compact),
                LocalParticipantControls provides participantControls) {
            Column(Modifier.fillMaxSize()) {
                MeetingHeader(currentLesson, mediaState, socketConnected, snapshot?.serverTime, grid, compact, windowWidth,
                    instructionPhase = phase, instructionStartedAt = snapshot?.instruction?.startedAt,
                    subjectName = currentLesson.subject?.name.takeIf { capabilities.supports(ContractProtocol.FeatureIds.ClassroomSubjects) },
                    showLayout = !teacherRail, onLayout = { grid = !grid })
                if (owner && lessonModes && phase != null && !compactSystemPip) {
                    MeetingLessonModes(activeLessonMode(phase, snapshot?.share, assistance), modeReady && !modeBusy && !busy, assistanceEnabled, onMode = ::selectMode)
                }
                // The owner rail's stage guide shows a pending/preparing request and its cancel button itself.
                if (assistanceEnabled && assistance != null && (owner || assistance.studentId == user.id) && !(teacherRail && snapshot?.share == null)) {
                    RemoteAssistanceControls(assistance, user, remoteState.supported && (pipState.supported || !remote.showsPointerOverOtherApps), assistanceBusy,
                        Modifier.fillMaxWidth().padding(horizontal = bodyPadding, vertical = Space.S4),
                        onApprove = { assistanceSession.approve(assistance.id) },
                        onDecline = { execute { realtime.send(ContractProtocol.Commands.AssistanceRespond, AssistanceRespondPayload(assistance.id, false)) } },
                        onStop = { execute { assistanceSession.stop(assistance.id) } },
                        requestCancel = owner && phase != null && assistance.status == "pending",
                        studentName = people.firstOrNull { it.id == assistance.studentId }?.name, pointer = remote.showsPointerOverOtherApps)
                }
                if (!socketConnected && snapshot != null) {
                    Text("실시간 상태를 다시 연결하고 있어요. 연결 후 자동으로 복원됩니다.",
                        Modifier.fillMaxWidth().padding(horizontal = bodyPadding).background(Palette.WarningSurface, RoundedCornerShape(Corner.R8)).padding(Space.S10),
                        style = MaterialTheme.typography.bodySmall, color = Palette.Ink)
                }
                Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = bodyPadding).padding(bottom = Space.S12)) {
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(Space.S16)) {
                        Box(Modifier.weight(1f).fillMaxHeight()) {
                            val current = snapshot
                            if (current?.share != null) SharedStage(api, current, user, media, realtime, Modifier.fillMaxSize(), report, screenShare::stop,
                                captureEnabled = notesEnabled && admission.admissionId != null && !compactSystemPip,
                                onCapture = capture::capture,
                                textbookLayout = textbookLayout, dockedParticipants = dockedTextbook || teacherRail)
                            else if (teacherRail) TeacherStageGuide(current, enabled = modeReady && !modeBusy && !busy,
                                onShare = { selectMode("classroom") }, onPickStudent = { selectMode("mirroring") },
                                onCancelRequest = { assistance?.let { current -> execute { assistanceSession.stop(current.id) } } }, cancelEnabled = !assistanceBusy,
                                modifier = Modifier.fillMaxSize())
                            else ParticipantGallery(current, currentLesson, user, media, mediaState, grid, Modifier.fillMaxSize())
                            if (miniVisible && miniTarget != null && !pipState.active && !pipState.transitioning && fatalError == null && !exited && !busy) {
                                FloatingMiniVideo(media, mediaState, miniTarget, videoName(miniTarget), !compact, miniPosition,
                                    onClose = { miniPreference = false }, modifier = Modifier.fillMaxSize())
                            }
                        }
                        if (teacherRail || (!overlayPanel && panel != null)) {
                            BoxWithConstraints(Modifier.width(sideWidth).fillMaxHeight()) {
                            // Spare height goes to the rail videos first (two tiles up to 200dp), then to the materials card.
                            val railVideos = (maxHeight - 300.dp).coerceIn(184.dp, 408.dp)
                            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(if (teacherRail) Space.S12 else Space.S8)) {
                                val current = snapshot
                                if (current != null && teacherRail && panel == null) {
                                    SharedParticipants(current, user, media, mediaState, Modifier.fillMaxWidth().height(railVideos), horizontal = false, docked = true, rail = true)
                                } else if (current != null && (dockedTextbook || teacherRail)) {
                                    SharedParticipants(current, user, media, mediaState, Modifier.fillMaxWidth(), horizontal = true, docked = true)
                                }
                                if (panel != null) MeetingLightPanel(Modifier.weight(1f).fillMaxWidth()) {
                                    panelContent(false)
                                } else MaterialsCard(textbookEnabled = modeReady && !modeBusy && !busy, onTextbook = { selectMode("classroom", materials = true) },
                                    modifier = Modifier.weight(1f).fillMaxWidth())
                            }
                            }
                        }
                    }
                    if (!compactSystemPip && overlayPanel && panel != null) {
                        // Match the web's side overlay; no separate native dialog covers system PiP.
                        Box(Modifier.fillMaxSize().background(Palette.Black.copy(alpha = .33f)).clickable { panel = null })
                        MeetingLightPanel(Modifier.align(Alignment.CenterEnd).width(sideWidth.coerceAtMost(windowWidth - Space.S32)).fillMaxHeight(), overlay = true) {
                            panelContent(true)
                        }
                    }
                }
                MeetingControls(
                    compact = compact, owner = owner, microphone = mediaState.microphone, camera = mediaState.camera,
                    sharing = ownScreen != null || mediaState.screenCaptureId != 0L || (assistance?.studentId == user.id && mediaState.screenSharing),
                    raised = snapshot?.participants?.find { it.user.id == user.id }?.raised == true,
                    count = mediaState.participants.size.coerceAtLeast(1), panel = panel, unread = unread, busy = busy,
                    showShare = phase == null && (canShare || ownScreen != null || mediaState.screenCaptureId != 0L ||
                        (assistance?.studentId == user.id && mediaState.screenSharing)), showMaterials = showMaterials && !teacherRail,
                    onMicrophone = { execute { media.setMicrophone(!mediaState.microphone) } },
                    onCamera = { execute { media.setCamera(!mediaState.camera) } },
                    onHand = { execute { realtime.send(ContractProtocol.Commands.HandSet, HandSetPayload(snapshot?.participants?.find { it.user.id == user.id }?.raised != true)) } },
                    onPanel = { next -> panel = if (panel == next) null else next },
                    onShare = {
                        if (assistance?.studentId == user.id) execute {
                            if (mediaState.screenSharing) assistanceSession.stop(assistance.id)
                            else error(DesignContent.RemoteAssistUseApproval)
                        } else if (ownScreen != null) screenShare.stop(ownScreen.id)
                        else if (mediaState.screenCaptureId != 0L) screenShare.stopCapture()
                        else screenShare.startCapture()
                    },
                    onExit = { confirmLeave = true },
                )
            }
            if (!compactSystemPip && notification != null && panel != Panel.Chat) {
                MeetingChatNotification(notification, onOpen = { panel = Panel.Chat }, onDismiss = { chat.dismiss() },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(horizontal = if (compact) Space.S12 else Space.S24).padding(bottom = if (compact) 100.dp else 112.dp).widthIn(max = 360.dp).fillMaxWidth())
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = Space.S96))
            }
        }
        }
        if (compactSystemPip) CompactVideo(media, mediaState, pipTarget, videoName(pipTarget), Modifier.fillMaxSize())
    }
    }
    if (notesEnabled && !compactSystemPip) capture.preview?.let { preview ->
        val share = snapshot?.share
        val changed = share == null || share.id != preview.shareId || share.page != preview.page || share.assistanceId != null
        MeetingLightTheme {
            NoteDialog(DesignContent.NotesCapture, capture.busy, onClose = capture::close) {
                NotePreview(preview.draft.bytes, "저장할 수업 화면")
                if (owner) Text(DesignContent.NotesShareNotice)
                (if (changed) DesignContent.NotesShareChanged else capture.error)?.let { Text(it, color = Palette.DangerText) }
                DesignButton(if (capture.busy) "저장 중…" else "저장하기", {
                    val id = admission.admissionId ?: return@DesignButton
                    if (!changed) capture.save(id) { showMessage(DesignContent.NotesCaptureSaved) }
                }, enabled = !changed && !capture.busy && socketConnected && mediaState.connected)
            }
        }
    }
    modes.confirm?.takeUnless { compactSystemPip }?.let {
        MeetingLightTheme {
            AlertDialog(onDismissRequest = modes::dismiss,
                title = { Text(DesignContent.MeetingLessonSwitchTitle) },
                text = { Text(DesignContent.MeetingLessonSwitchCopy) },
                confirmButton = { TextButton(enabled = modeReady && !modeBusy, onClick = { modes.confirmChange(modeReady) }) { Text(DesignContent.MeetingLessonSwitchAction) } },
                dismissButton = { TextButton(onClick = modes::dismiss) { Text("취소") } })
        }
    }
    if (showMirroringStudents && owner && phase == "mirroring" && !compactSystemPip) {
        MeetingLightTheme {
            MirroringStudentDialog(
                students = snapshot.participants.filter { it.online && it.user.role == "student" && it.user.id != user.id }.map { it.user },
                connected = modeReady,
                blocked = when {
                    assistance != null -> DesignContent.MeetingMirroringRequestInProgress
                    snapshot.share != null -> DesignContent.RemoteAssistStopShareFirst
                    else -> null
                },
                onClose = { showMirroringStudents = false },
                onRequest = { studentId ->
                    realtime.send(ContractProtocol.Commands.AssistanceRequest, AssistanceRequestPayload(studentId))
                },
            )
        }
    }
    if (confirmLeave && !compactSystemPip) AlertDialog(
        onDismissRequest = { if (!busy) confirmLeave = false },
        title = { Text(if (owner) "수업에서 나갈까요?" else "수업을 나갈까요?") },
        text = { Text(if (owner) "혼자 나가면 수업이 계속됩니다. 모두 종료하면 참여자의 연결이 종료됩니다." else "수업이 진행 중이면 다시 입장할 수 있어요.") },
        confirmButton = {
            if (owner) TextButton(enabled = !busy, onClick = { session.leave(true) }) { Text("모두 종료", color = MaterialTheme.colorScheme.error) }
            else TextButton(enabled = !busy, onClick = { session.leave(false) }) { Text("나가기") }
        },
        dismissButton = {
            Row {
                TextButton(enabled = !busy, onClick = { confirmLeave = false }) { Text("취소") }
                if (owner) TextButton(enabled = !busy, onClick = { session.leave(false) }) { Text("나만 나가기") }
            }
        },
    )
    if (fatalError != null && !compactSystemPip) AlertDialog(
        onDismissRequest = {}, title = { Text("수업 연결을 확인해 주세요") }, text = { Text(fatalError) },
        confirmButton = { TextButton(onClick = session::returnToLessons) { Text("수업으로 돌아가기") } },
    )
}
