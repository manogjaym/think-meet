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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
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
import kotlinx.datetime.toLocalDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*


internal enum class Panel(val title: String) { Chat(DesignContent.MeetingChatPanel), People(DesignContent.MeetingPeoplePanel), Materials("콘텐츠 공유"), Settings("설정"), More("더보기"), Invite("참여 링크 공유") }

@Stable
private class MeetingChatDraft {
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
    val modeReady = subscribed && mediaState.connected &&
        snapshot?.participants?.any { it.user.id == user.id && it.online } == true
    var modeConfirm by remember { mutableStateOf<LessonModeSetPayload?>(null) }
    var modeBusy by remember { mutableStateOf(false) }
    val assistanceEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance)
    val snackbar = remember { SnackbarHostState() }
    var panel by remember { mutableStateOf<Panel?>(null) }
    var confirmLeave by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(true) }
    var knownMessages by remember { mutableStateOf<Set<String>?>(null) }
    var unread by remember { mutableIntStateOf(0) }
    var notification by remember { mutableStateOf<ChatMessage?>(null) }
    var miniPreference by remember(lesson.id) { mutableStateOf<Boolean?>(null) }
    val miniPosition = remember(lesson.id) { MiniVideoPosition() }
    val chatDraft = remember(lesson.id) { MeetingChatDraft() }
    val pipTarget = remember(mediaState.participants, currentLesson.teacher.id, snapshot?.share, assistance) {
        if (assistance?.let { it.studentId == user.id && it.status == "active" } == true) PipVideoTarget(currentLesson.teacher.id)
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
    val command: (String, JsonObject) -> Unit = { type, payload -> execute { realtime.command(type, payload) } }

    fun updateInstruction(change: LessonModeSetPayload? = null) {
        if (!modeReady || modeBusy) return
        modeBusy = true
        execute {
            try {
                val updated = if (change == null) realtime.command("lesson.start")
                else realtime.command("lesson.mode.set", ThinkMeetJson.encodeToJsonElement(change).jsonObject)
                if (change?.mode == "mirroring" && updated.instruction?.phase == "mirroring") panel = Panel.People
            } finally { modeBusy = false }
        }
    }

    fun selectMode(mode: String) {
        if (phase != "classroom" && phase != "mirroring") return
        if (phase == mode) {
            if (mode == "mirroring") panel = Panel.People
            return
        }
        val change = LessonModeSetPayload(mode, phase, snapshot.share?.id, assistance?.id)
        if (change.expectedShareId != null || change.expectedAssistanceId != null) modeConfirm = change
        else updateInstruction(change)
    }

    LaunchedEffect(showMaterials, panel) {
        if (!showMaterials && panel == Panel.Materials) panel = null
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

    BackHandler { confirmLeave = true }
    LaunchedEffect(realtime) {
        realtime.errors.collectLatest { snackbar.showSnackbar(it) }
    }
    LaunchedEffect(snapshot?.messages?.lastOrNull()?.id, panel) {
        val messages = snapshot?.messages.orEmpty()
        val known = knownMessages
        if (panel == Panel.Chat) { unread = 0; notification = null }
        else if (known != null) {
            val incoming = messages.filter { it.id !in known && it.userId != user.id }
            if (incoming.isNotEmpty()) { unread += incoming.size; notification = incoming.last() }
        }
        if (snapshot != null) knownMessages = known.orEmpty() + messages.map { it.id }
    }
    LaunchedEffect(notification?.id) {
        val id = notification?.id ?: return@LaunchedEffect
        delay(8_000)
        if (notification?.id == id) notification = null
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
            val sideWidth = if (overlayPanel) LayoutToken.MeetingPanelWidth else if (maxWidth <= LayoutToken.MeetingMediumBreakpoint) LayoutToken.MeetingPanelNarrowWidth else LayoutToken.MeetingPanelWidth
            val bodyPadding = if (compact) Space.S10 else if (maxWidth <= LayoutToken.MeetingMediumBreakpoint) Space.S16 else Space.S20
            CompositionLocalProvider(LocalMeetingCompact provides compact, LocalMeetingViewportWidth provides maxWidth, LocalMeetingShort provides (maxHeight <= LayoutToken.MeetingShortHeight && !compact)) {
            Column(Modifier.fillMaxSize()) {
                MeetingHeader(currentLesson, mediaState, socketConnected, snapshot?.serverTime, grid, compact, windowWidth,
                    instructionPhase = phase, instructionStartedAt = snapshot?.instruction?.startedAt, onLayout = { grid = !grid })
                if (owner && lessonModes && phase != null && !compactSystemPip) {
                    MeetingLessonModes(phase, modeReady && !modeBusy && !busy, assistanceEnabled,
                        onStart = { updateInstruction() }, onMode = ::selectMode)
                }
                if (assistanceEnabled && assistance != null && (owner || assistance.studentId == user.id)) {
                    RemoteAssistanceControls(assistance, user, remoteState.supported && pipState.supported, assistanceBusy,
                        Modifier.fillMaxWidth().padding(horizontal = bodyPadding, vertical = Space.S4),
                        onApprove = { assistanceSession.approve(assistance.id) },
                        onDecline = { execute { realtime.command("assistance.respond", ThinkMeetJson.encodeToJsonElement(AssistanceRespondPayload(assistance.id, false)).jsonObject) } },
                        onStop = { execute { assistanceSession.stop(assistance.id) } },
                        requestCancel = owner && phase != null && assistance.status == "pending",
                        studentName = people.firstOrNull { it.id == assistance.studentId }?.name)
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
                            if (current?.share != null) SharedStage(api, current, user, media, realtime, Modifier.fillMaxSize(), report, screenShare::stop)
                            else ParticipantGallery(current, currentLesson, user, media, mediaState, grid, Modifier.fillMaxSize())
                            if (miniVisible && miniTarget != null && !pipState.active && !pipState.transitioning && fatalError == null && !exited && !busy) {
                                FloatingMiniVideo(media, mediaState, miniTarget, videoName(miniTarget), !compact, miniPosition,
                                    onClose = { miniPreference = false }, modifier = Modifier.fillMaxSize())
                            }
                        }
                        if (!overlayPanel && panel != null) {
                            MeetingLightPanel(Modifier.width(sideWidth).fillMaxHeight()) {
                                MeetingPanel(panel!!, api, currentLesson, user, snapshot, realtime, onClose = { panel = null }, report = report,
                                    chatDraft = chatDraft, media = media, mediaState = mediaState, onPanel = { panel = it }, unread = unread,
                                    miniVisible = miniVisible, onMini = { miniPreference = !miniVisible }, pipState = pipState, pipEnabled = pipEnabled,
                                    onPip = { execute { api.requireFeature(ContractProtocol.FeatureIds.MeetingPip); try { pip.enter() } catch (error: Throwable) { if (error is CancellationException || pip.state.value.error == null) throw error } } })
                            }
                        }
                    }
                    if (!compactSystemPip && overlayPanel && panel != null) {
                        // Match the web's side overlay; no separate native dialog covers system PiP.
                        Box(Modifier.fillMaxSize().background(Palette.Black.copy(alpha = .33f)).clickable { panel = null })
                        MeetingLightPanel(Modifier.align(Alignment.CenterEnd).width(sideWidth.coerceAtMost(windowWidth - Space.S32)).fillMaxHeight(), overlay = true) {
                            MeetingPanel(panel!!, api, currentLesson, user, snapshot, realtime, onClose = { panel = null }, report = report,
                                chatDraft = chatDraft, media = media, mediaState = mediaState, onPanel = { panel = it }, unread = unread,
                                miniVisible = miniVisible, onMini = { miniPreference = !miniVisible }, pipState = pipState, pipEnabled = pipEnabled,
                                onPip = { execute { api.requireFeature(ContractProtocol.FeatureIds.MeetingPip); try { pip.enter() } catch (error: Throwable) { if (error is CancellationException || pip.state.value.error == null) throw error } } })
                        }
                    }
                }
                MeetingControls(
                    compact = compact, owner = owner, microphone = mediaState.microphone, camera = mediaState.camera,
                    sharing = ownScreen != null || mediaState.screenCaptureId != 0L || (assistance?.studentId == user.id && mediaState.screenSharing),
                    raised = snapshot?.participants?.find { it.user.id == user.id }?.raised == true,
                    count = mediaState.participants.size.coerceAtLeast(1), panel = panel, unread = unread, busy = busy,
                    showShare = canShare || ownScreen != null || mediaState.screenCaptureId != 0L ||
                        (assistance?.studentId == user.id && mediaState.screenSharing), showMaterials = showMaterials,
                    onMicrophone = { execute { media.setMicrophone(!mediaState.microphone) } },
                    onCamera = { execute { media.setCamera(!mediaState.camera) } },
                    onHand = { command("hand.set", buildJsonObject { put("raised", snapshot?.participants?.find { it.user.id == user.id }?.raised != true) }) },
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
                MeetingChatNotification(notification!!, onOpen = { panel = Panel.Chat }, onDismiss = { notification = null },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(horizontal = if (compact) Space.S12 else Space.S24).padding(bottom = if (compact) 100.dp else 112.dp).widthIn(max = 360.dp).fillMaxWidth())
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = Space.S96))
            }
        }
        }
        if (compactSystemPip) CompactVideo(media, mediaState, pipTarget, videoName(pipTarget), Modifier.fillMaxSize())
    }
    }
    modeConfirm?.takeUnless { compactSystemPip }?.let { change ->
        MeetingLightTheme {
            AlertDialog(onDismissRequest = { modeConfirm = null },
                title = { Text(DesignContent.MeetingLessonSwitchTitle) },
                text = { Text(DesignContent.MeetingLessonSwitchCopy) },
                confirmButton = { TextButton(enabled = modeReady && !modeBusy, onClick = {
                    modeConfirm = null
                    updateInstruction(change)
                }) { Text(DesignContent.MeetingLessonSwitchAction) } },
                dismissButton = { TextButton(onClick = { modeConfirm = null }) { Text("취소") } })
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

@Composable
private fun ParticipantGallery(snapshot: MeetingSnapshot?, lesson: Lesson, user: User, media: MediaController, mediaState: MediaState, grid: Boolean, modifier: Modifier) {
    val roster = (snapshot?.participants.orEmpty().map { it.user } + lesson.students + lesson.teacher + user).associateBy { it.id }
    val people = mediaState.participants.map { participant -> roster[participant.identity]
        ?: User(participant.identity, participant.identity, participant.name.ifBlank { "참여자" }, "student") }
        .ifEmpty { listOf(user) }
    BoxWithConstraints(modifier) {
        val narrow = maxWidth < LayoutToken.MeetingCompactBreakpoint
        val gap = if (narrow) Space.S8 else Space.S12
        val tileAreaHeight = (maxHeight.value - 52).coerceAtLeast(1f)
        val stacked = maxWidth.value <= tileAreaHeight
        val columns = kotlin.math.floor((maxWidth.value + gap.value) / ((if (narrow) 160 else 240) + gap.value)).toInt().coerceIn(1, if (narrow) 2 else 3)
        val rows = kotlin.math.floor((maxHeight.value - 52 + gap.value) / (170 + gap.value)).toInt().coerceIn(1, if (narrow) 2 else 3)
        val featuredId = mediaState.participants.firstOrNull { it.speaking && it.identity != user.id }?.identity
            ?: people.firstOrNull { it.id == lesson.teacher.id }?.id ?: people.first().id
        val featured = people.firstOrNull { it.id == featuredId } ?: people.first()
        val paginated = if (grid) people else people.filter { it.id != featured.id }
        val pageSize = if (grid) columns * rows else 3
        var page by remember(pageSize, grid) { mutableIntStateOf(0) }
        val pages = ((paginated.size + pageSize - 1) / pageSize).coerceAtLeast(1)
        val safePage = page.coerceIn(0, pages - 1)
        LaunchedEffect(pageSize, pages) { page = safePage }
        val displayed = paginated.drop(safePage * pageSize).take(pageSize)
        val preferredColumns = kotlin.math.floor(kotlin.math.sqrt(displayed.size.toDouble() * maxWidth.value / tileAreaHeight) + .5).toInt()
        val visibleColumns = if (grid) preferredColumns.coerceIn(
            kotlin.math.ceil(displayed.size.toDouble() / rows).toInt().coerceAtLeast(1), minOf(columns, displayed.size.coerceAtLeast(1)),
        ) else 1
        fun raised(person: User) = snapshot?.participants?.find { it.user.id == person.id }?.raised == true
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(gap)) {
            if (grid) {
                Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    displayed.chunked(visibleColumns).forEach { row ->
                        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                            row.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxHeight()) }
                            repeat(visibleColumns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            } else if (displayed.isEmpty()) {
                ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(1f).fillMaxWidth())
            } else if (stacked) {
                Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
                    ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(3f).fillMaxWidth())
                    Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                        displayed.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxHeight(), small = true, speakerThumbnail = true) }
                    }
                }
            } else {
                Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    ParticipantTile(featured, featured.id == lesson.teacher.id, raised(featured), media, mediaState, Modifier.weight(3f).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                        displayed.forEach { person -> ParticipantTile(person, person.id == lesson.teacher.id, raised(person), media, mediaState, Modifier.weight(1f).fillMaxWidth(), small = true, speakerThumbnail = true) }
                    }
                }
            }
            if (pages > 1) MeetingPagination(safePage, pages, safePage * pageSize + 1, kotlin.math.min((safePage + 1) * pageSize, paginated.size), paginated.size,
                onPrevious = { page = (safePage - 1).coerceAtLeast(0) }, onNext = { page = (safePage + 1).coerceAtMost(pages - 1) })
        }
    }
}

@Composable
internal fun MeetingPagination(page: Int, pages: Int, start: Int, end: Int, total: Int, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(Space.S52), horizontalArrangement = Arrangement.spacedBy(Space.S12, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        OutlinedIconButton(onClick = onPrevious, enabled = page > 0, border = BorderStroke(Space.S1, Palette.MeetingBorder), modifier = Modifier.size(Space.S40)) {
            DesignIcon("chevron", Modifier.size(Space.S18).graphicsLayer { rotationZ = 180f }, if (page > 0) Palette.MeetingText else Palette.MeetingWeak, "이전 참가자 페이지")
        }
        Text("${page + 1} / $pages", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingText)
        if (!LocalMeetingCompact.current) Text("$start–$end / ${total}명", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingDim)
        OutlinedIconButton(onClick = onNext, enabled = page < pages - 1, border = BorderStroke(Space.S1, Palette.MeetingBorder), modifier = Modifier.size(Space.S40)) {
            DesignIcon("chevron", Modifier.size(Space.S18), if (page < pages - 1) Palette.MeetingText else Palette.MeetingWeak, "다음 참가자 페이지")
        }
    }
}

@Composable
internal fun ParticipantTile(person: User, teacher: Boolean, raised: Boolean, media: MediaController, state: MediaState, modifier: Modifier = Modifier, small: Boolean = false, speakerThumbnail: Boolean = false) {
    val participant = state.participants.firstOrNull { it.identity == person.id }
    val compact = LocalMeetingCompact.current
    val short = LocalMeetingShort.current
    val name = person.name.removeSuffix(" 선생님")
    val cameraVisible = participant?.camera == true && LocalMeetingVideoRendering.current
    val speaking = participant?.speaking == true
    val avatar = if (teacher) Palette.MeetingAvatarBlue else Palette.MeetingAvatarSage
    val avatarInk = if (teacher) Palette.MeetingAvatarBlueText else Palette.MeetingAvatarSageText
    val strip = small && !speakerThumbnail
    val tileRadius = if (strip) Corner.R8 else if (compact) Corner.R9 else Corner.R12
    val avatarSize = when { small && speakerThumbnail -> if (compact) FontSize.S18 else FontSize.S24; strip -> if (compact) FontSize.S17 else FontSize.S21; compact || short -> FontSize.S25; else -> (LocalMeetingViewportWidth.current.value * .03f).coerceIn(27f, 38f).sp }
    val avatarDiameter = when { small && speakerThumbnail -> if (compact) Space.S40 else Space.S64; strip -> if (compact) 38.dp else Space.S52; compact -> 66.dp; short -> 68.dp; else -> (LocalMeetingViewportWidth.current * .09f).coerceIn(76.dp, 112.dp) }
    val tagSize = if (strip) Type.Caption else Type.Support
    val tagInset = if (strip) Space.S8 else if (compact) Space.S10 else Space.S16
    Box(modifier.clip(RoundedCornerShape(tileRadius))
        .background(Palette.MeetingTile).border(Space.S2, if (speaking) Palette.PrimaryOnDark else androidx.compose.ui.graphics.Color.Transparent,
            RoundedCornerShape(tileRadius)), contentAlignment = Alignment.Center) {
        if (cameraVisible) VideoSurface(media, person.id, modifier = Modifier.fillMaxSize())
        else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.S12)) {
            Surface(Modifier.size(avatarDiameter), shape = CircleShape, color = avatar) {
                Box(contentAlignment = Alignment.Center) { Text(if (name.length > 1) name.takeLast(2) else name, color = avatarInk,
                    style = MaterialTheme.typography.headlineMedium.copy(fontSize = avatarSize, lineHeight = avatarSize * 1.5f), fontWeight = DesignWeight.SemiBold) }
            }
            if (!small && !short) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                DesignIcon(if (participant?.camera == true) "video" else "videoOff", Modifier.size(Space.S14), Palette.MeetingCameraStatus)
                Text(if (participant?.camera == true) "영상 연결 중" else "카메라 꺼짐", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingCameraStatus)
            }
        }
        Row(Modifier.align(Alignment.BottomStart).padding(start = tagInset, end = tagInset, bottom = if (small && speakerThumbnail && compact) Space.S7 else tagInset)
            .then(if (cameraVisible) Modifier.background(Palette.Black.copy(alpha = .53f), RoundedCornerShape(Corner.R6)).padding(horizontal = Space.S8, vertical = Space.S4) else Modifier),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
            if (teacher) Text("선생님", Modifier.border(Space.S1, Palette.MeetingAvatarBorder, RoundedCornerShape(Corner.R4)).padding(horizontal = Space.S5, vertical = Space.S2),
                color = Palette.MeetingMuted, style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S12, lineHeight = FontSize.S12 * 1.5f))
            Text(name + if (participant?.local == true) " (나)" else "", color = Palette.MeetingSubtle,
                style = MaterialTheme.typography.labelMedium.copy(fontSize = tagSize, lineHeight = tagSize * 1.5f), fontWeight = DesignWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (raised) Row(Modifier.align(Alignment.TopStart).padding(Space.S12).background(Palette.MeetingHandBackground, RoundedCornerShape(Corner.R7)).padding(horizontal = Space.S10, vertical = Space.S7),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
            DesignIcon("hand", Modifier.size(Space.S17), Palette.MeetingHandText, "손듦")
            Text("손들기", color = Palette.MeetingHandText, style = MaterialTheme.typography.labelSmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
        if (!(small && compact)) Box(Modifier.align(Alignment.TopEnd).padding(if (compact || strip) Space.S7 else Space.S12)
            .size(if (strip) Space.S24 else if (compact) Space.S26 else Space.S32)
            .background(if (participant?.microphone == true) Palette.MeetingMicBackground else Palette.MeetingMicOffBackground, CircleShape), contentAlignment = Alignment.Center) {
            DesignIcon(if (participant?.microphone == true) "mic" else "micOff", Modifier.size(Space.S16),
                if (participant?.microphone == true) Palette.MeetingMuted else Palette.MicMuted, if (participant?.microphone == true) "마이크 켜짐" else "마이크 꺼짐")
        }
    }
}

@OptIn(kotlin.uuid.ExperimentalUuidApi::class)
internal fun uniqueId(prefix: String = ""): String {
    val uuid = kotlin.uuid.Uuid.random().toString()
    return if (prefix.isEmpty()) uuid else "$prefix-$uuid"
}

@Composable
private fun MeetingPanel(
    panel: Panel, api: ThinkMeetApi, lesson: Lesson, user: User, snapshot: MeetingSnapshot?, realtime: MeetingRealtime,
    onClose: () -> Unit, report: (Throwable) -> Unit, chatDraft: MeetingChatDraft, media: MediaController, mediaState: MediaState,
    onPanel: (Panel) -> Unit, unread: Int, miniVisible: Boolean, onMini: () -> Unit,
    pipState: PictureInPictureState, pipEnabled: Boolean, onPip: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().heightIn(min = LayoutToken.MeetingHeader).padding(horizontal = Space.S24, vertical = Space.S12), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (panel == Panel.Invite && !lesson.isOpen) "다른 참석자 추가" else panel.title,
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = Type.Heading, lineHeight = Type.Heading * 1.45f), fontWeight = DesignWeight.Bold, color = Palette.Ink)
                if (panel == Panel.People) Text("${snapshot?.participants?.count { it.online } ?: 1}명 입장", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
            }
            IconButton(onClick = onClose) { DesignIcon("close", Modifier.size(Space.S24), Palette.MeetingSecondary, "패널 닫기") }
        }
        if (panel == Panel.Chat || panel == Panel.People) {
            Column {
            Row(Modifier.fillMaxWidth().padding(horizontal = Space.S24)) {
                listOf(Panel.People to "users", Panel.Chat to "chat").forEach { (target, icon) ->
                    val selected = target == panel
                    Column(Modifier.weight(1f).clickable { onPanel(target) }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Row(Modifier.height(46.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) {
                            DesignIcon(icon, Modifier.size(Space.S17), if (selected) Palette.Primary else Palette.Muted)
                            Text(if (target == Panel.People) DesignContent.MeetingPeoplePanel else "채팅", style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = if (selected) Palette.Primary else Palette.Muted)
                            val count = if (target == Panel.People) snapshot?.participants?.count { it.online } ?: 1 else unread
                            if (count > 0) Text("$count", Modifier.background(if (target == Panel.Chat) Palette.Danger else Palette.Selection, RoundedCornerShape(if (target == Panel.Chat) Corner.R10 else Corner.R4)).padding(horizontal = Space.S5), color = if (target == Panel.Chat) Palette.White else Palette.PrimaryPressed, style = MaterialTheme.typography.labelSmall)
                        }
                        Box(Modifier.fillMaxWidth().height(Space.S2).background(if (selected) Palette.Primary else androidx.compose.ui.graphics.Color.Transparent))
                    }
                }
            }
            HorizontalDivider(color = Palette.MeetingText)
            }
        }
        when (panel) {
            Panel.Chat -> ChatPanel(snapshot, user, realtime, report, chatDraft)
            Panel.People -> PeoplePanel(api, lesson, user, snapshot, mediaState, realtime, report)
            Panel.Materials -> if (snapshot?.instruction?.phase.let { it == null || it == "classroom" }) {
                MaterialsPanel(api, lesson, snapshot, realtime, report, onClose)
            }
            Panel.Settings -> DevicePanel(media, mediaState, report)
            Panel.Invite -> InvitePanel(api, lesson, report)
            Panel.More -> MorePanel(lesson, user, snapshot, realtime, report, onPanel, unread, miniVisible, onMini, pipState, pipEnabled, onPip)
        }
    }
}

@Composable
private fun ColumnScope.MorePanel(
    lesson: Lesson, user: User, snapshot: MeetingSnapshot?, realtime: MeetingRealtime, report: (Throwable) -> Unit,
    onPanel: (Panel) -> Unit, unread: Int, miniVisible: Boolean, onMini: () -> Unit,
    pipState: PictureInPictureState, pipEnabled: Boolean, onPip: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        item { MeetingMenuItem("chat", "수업 채팅", "함께 이야기 나누기", badge = unread) { onPanel(Panel.Chat) } }
        if (lesson.isOwner(user)) {
            item { MeetingMenuItem(if (lesson.isOpen) "link" else "users", if (lesson.isOpen) "참여 링크 공유" else "다른 참석자 추가", if (lesson.isOpen) "누구나 참여할 수 있는 공개 수업" else "초대 학생과 참여 링크 관리") { onPanel(Panel.Invite) } }
            if (snapshot?.instruction?.phase.let { it == null || it == "classroom" }) {
                item { MeetingMenuItem("folder", "수업 자료", "영상과 PDF를 함께 보기") { onPanel(Panel.Materials) } }
            }
        }
        item { MeetingMenuItem("settings", "카메라·마이크 설정", "입력·출력 장치 설정") { onPanel(Panel.Settings) } }
        item { MeetingMenuItem("pip", "화면 속 화면", if (!pipState.supported) "기기에서 지원하지 않아요" else "다른 앱을 보면서 수업 계속하기", enabled = pipState.supported && pipEnabled && !pipState.active && !pipState.transitioning) { onPip() } }
        item { MeetingMenuItem("video", "미니 영상", if (miniVisible) "영상창 숨기기" else "앱 안에서 이동 가능한 영상창 보기", selected = miniVisible, onClick = onMini) }
        if (lesson.isOwner(user)) item {
            val raised = snapshot?.participants?.firstOrNull { it.user.id == user.id }?.raised == true
            MeetingMenuItem("hand", if (raised) "손 내리기" else "손들기", "참석자에게 손들기 상태 표시", selected = raised) {
                scope.launch { try { realtime.command("hand.set", buildJsonObject { put("raised", !raised) }) } catch (error: Throwable) { report(error) } }
            }
        }
    }
}

@Composable
private fun MeetingMenuItem(icon: String, title: String, detail: String, badge: Int = 0, selected: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 76.dp).clip(RoundedCornerShape(Corner.R8)).background(if (selected) Palette.Selection else Palette.Canvas)
        .clickable(enabled = enabled, onClick = onClick).padding(Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S16)) {
        Box(Modifier.size(38.dp).background(Palette.Selection, RoundedCornerShape(Corner.R8)), contentAlignment = Alignment.Center) { DesignIcon(icon, Modifier.size(Space.S22), if (enabled) Palette.Primary else Palette.Muted) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
            Text(title, style = MaterialTheme.typography.labelLarge.copy(fontSize = Type.Label, lineHeight = Type.Label * 1.5f), fontWeight = DesignWeight.SemiBold, color = if (enabled) Palette.TextSecondary else Palette.Muted)
            Text(detail, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
        }
        if (badge > 0) Box(Modifier.height(Space.S20).widthIn(min = Space.S20).background(Palette.Danger, RoundedCornerShape(Corner.R10)).padding(horizontal = Space.S6), contentAlignment = Alignment.Center) { Text(if (badge > 99) "99+" else "$badge", color = Palette.White, style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S11, lineHeight = FontSize.S11)) }
    }
}

@Composable
private fun ColumnScope.InvitePanel(api: ThinkMeetApi, lesson: Lesson, report: (Throwable) -> Unit) {
    val scope = rememberCoroutineScope()
    var students by remember { mutableStateOf<List<User>>(emptyList()) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var query by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    LaunchedEffect(lesson.id) { if (!lesson.isOpen) try { students = api.students() } catch (error: Throwable) { report(error) } }
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
        if (lesson.isOpen) item { Text("누구나 함께할 수 있는 공개 수업이에요.\n학생을 따로 초대할 필요 없이, 로그인한 누구나 수업 목록이나 참여 링크로 입장할 수 있어요.", Modifier.background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8)).padding(Space.S16), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted) }
        else {
            item { DesignTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = "학생 이름 검색", leadingIcon = { DesignIcon("search", Modifier.size(Space.S17), Palette.MeetingWeak) }) }
            items(students.filter { it.name.contains(query.trim(), true) }, key = { it.id }) { person ->
                val invited = lesson.students.any { it.id == person.id }
                Row(Modifier.fillMaxWidth().heightIn(min = 68.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S10)) {
                    MeetingPersonAvatar(person, Space.S32)
                    Column(Modifier.weight(1f)) { Text(person.name, style = MaterialTheme.typography.bodyMedium); Text(if (invited) "이미 초대됨" else "초대 가능", style = MaterialTheme.typography.bodySmall, color = Palette.Muted) }
                    TextButton(enabled = !invited && !pending, onClick = { selected = if (person.id in selected) selected - person.id else selected + person.id }) { Text(if (invited) "초대됨" else if (person.id in selected) "선택됨" else "선택") }
                }
            }
            item { Row(verticalAlignment = Alignment.CenterVertically) { Text("${selected.size}명 선택", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = Palette.Muted); DesignButton("초대하기", enabled = selected.isNotEmpty() && !pending, onClick = {
                pending = true; scope.launch { try { api.invite(lesson.id, selected.toList()); selected = emptySet() } catch (error: Throwable) { report(error) } finally { pending = false } }
            }) } }
        }
        item { DesignButton("참여 링크 복사", onClick = { copyText("${api.origin}/join/${lesson.code}") }, modifier = Modifier.fillMaxWidth(), secondary = true, icon = { DesignIcon("copy", Modifier.size(Space.S17), Palette.Primary) }) }
        item { DesignButton("참여 링크 공유", onClick = { shareLink("${api.origin}/join/${lesson.code}") }, modifier = Modifier.fillMaxWidth(), secondary = true, icon = { DesignIcon("link", Modifier.size(Space.S17), Palette.Primary) }) }
        item { Text("${api.origin}/join/${lesson.code}", Modifier.background(Palette.Canvas, RoundedCornerShape(Corner.R8)).padding(Space.S12), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted) }
    }
}

@Composable
private fun ColumnScope.ChatPanel(snapshot: MeetingSnapshot?, user: User, realtime: MeetingRealtime, report: (Throwable) -> Unit, draftState: MeetingChatDraft) {
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val messages = snapshot?.messages.orEmpty()
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(messages.lastOrNull()?.id) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }
    Column(Modifier.weight(1f).fillMaxWidth().padding(start = Space.S24, top = Space.S16, end = Space.S24, bottom = Space.S24), verticalArrangement = Arrangement.spacedBy(Space.S24)) {
        Text("이 수업의 참여자 모두에게 메시지가 전달됩니다.", Modifier.fillMaxWidth().background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8)).padding(horizontal = Space.S16, vertical = Space.S12),
            style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(Space.S24)) {
            items(messages, key = { it.id }) { message ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                    MeetingPersonAvatar(User(message.userId, message.userId, message.userName, "student"), Space.S32)
                    Column(Modifier.weight(1f)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                            Text(message.userName + if (message.userId == user.id) " (나)" else "", Modifier.weight(1f),
                                style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary)
                            Text(messageTime(message.createdAt), style = MaterialTheme.typography.labelSmall.copy(fontSize = FontSize.S12, lineHeight = FontSize.S12 * 1.5f), color = Palette.Muted)
                        }
                        Text(message.text, Modifier.padding(top = Space.S4), style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Body, lineHeight = Type.Body * 1.5f), color = Palette.TextSecondary)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().imePadding().heightIn(min = Space.S52).background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8))
            .padding(start = Space.S16, top = Space.S4, end = Space.S4, bottom = Space.S4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            BasicTextField(value = draftState.text, onValueChange = { if (it.length <= 2000) { draftState.text = it; draftState.pendingId = null } },
                modifier = Modifier.weight(1f).heightIn(min = Space.S44).semantics { contentDescription = "채팅 메시지" }, enabled = !sending,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, color = Palette.TextSecondary), minLines = 1, maxLines = 4,
                decorationBox = { input -> Box(contentAlignment = Alignment.CenterStart) { if (draftState.text.isEmpty()) Text("메시지 보내기", style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.Muted); input() } })
            IconButton(enabled = draftState.text.isNotBlank() && !sending, modifier = Modifier.size(Space.S44), onClick = {
                val text = draftState.text.trim()
                val id = draftState.pendingId ?: uniqueId("chat").also { draftState.pendingId = it }
                sending = true
                scope.launch {
                    try {
                        realtime.command("chat.send", buildJsonObject { put("text", text); put("clientId", id) })
                        if (draftState.text.trim() == text) draftState.text = ""
                        draftState.pendingId = null
                    } catch (error: Throwable) { report(error) } finally { sending = false }
                }
            }) {
                if (sending) CircularProgressIndicator(Modifier.size(Space.S21), strokeWidth = Space.S2)
                else DesignIcon("send", Modifier.size(Space.S21), if (draftState.text.isBlank()) Palette.Primary.copy(alpha = .45f) else Palette.Primary, "메시지 전송")
            }
        }
    }
}

private fun messageTime(value: String): String = runCatching {
    val time = kotlin.time.Instant.parse(value).toLocalDateTime(kotlinx.datetime.TimeZone.of("Asia/Seoul"))
    "${if (time.hour < 12) "오전" else "오후"} ${((time.hour + 11) % 12) + 1}:${time.minute.toString().padStart(2, '0')}"
}.getOrDefault("")

@Composable
private fun MeetingPersonAvatar(person: User, size: androidx.compose.ui.unit.Dp) {
    DesignAvatar(person.name, person.id, size = size, small = size <= Space.S36)
}

@Composable
private fun ColumnScope.PeoplePanel(api: ThinkMeetApi, lesson: Lesson, user: User, snapshot: MeetingSnapshot?, media: MediaState, realtime: MeetingRealtime, report: (Throwable) -> Unit) {
    val owner = lesson.teacher.id == user.id
    val scope = rememberCoroutineScope()
    val capabilities by api.capabilities.collectAsState()
    val socketConnected by realtime.connected.collectAsState()
    val assistanceEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) &&
        snapshot?.instruction?.phase.let { it == null || it == "mirroring" }
    var search by remember { mutableStateOf("") }
    var kickPerson by remember { mutableStateOf<User?>(null) }
    var pending by remember { mutableStateOf(false) }
    val roster = snapshot?.participants ?: (listOf(lesson.teacher) + lesson.students + user).distinctBy { it.id }.map { MeetingParticipant(it) }
    val connected = media.participants.map { it.identity }.toSet()
    val groups = listOf("통화 중" to roster.filter { it.user.id in connected }, "입장 대기" to roster.filter { it.user.id !in connected })
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16)) {
        item { DesignTextField(search, { search = it }, Modifier.fillMaxWidth(), placeholder = "참석자 찾기", leadingIcon = { DesignIcon("search", Modifier.size(Space.S17), Palette.MeetingWeak) }) }
        groups.forEach { (label, entries) ->
            item { Text("$label · ${entries.size}", Modifier.padding(top = Space.S32, bottom = Space.S8), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted) }
            items(entries.filter { it.user.name.contains(search.trim(), true) }, key = { it.user.id }) { entry ->
                val person = entry.user
                val participant = media.participants.firstOrNull { it.identity == person.id }
                Row(Modifier.fillMaxWidth().heightIn(min = Space.S72), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                    MeetingPersonAvatar(person, Space.S36)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                        Text(person.name + if (person.id == user.id) " (나)" else "", style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Body, lineHeight = Type.Body * 1.5f), fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary)
                        Text(if (person.id == lesson.teacher.id) "선생님 · 호스트" else "${if (person.isTeacher) "선생님" else "학생"} · ${if (person.id in connected) "참여 중" else "아직 입장하지 않음"}",
                            color = Palette.Muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
                    }
                    if (entry.raised) Box(Modifier.size(Space.S28).background(Palette.MeetingRaisedBackground, CircleShape), contentAlignment = Alignment.Center) { DesignIcon("hand", Modifier.size(Space.S16), Palette.MeetingRaisedInk, "손들기") }
                    if (person.id in connected) {
                        DesignIcon(if (participant?.microphone == true) "mic" else "micOff", Modifier.size(Space.S15), if (participant?.microphone == true) Palette.MeetingWeak else Palette.MeetingDeviceOff)
                        DesignIcon(if (participant?.camera == true) "video" else "videoOff", Modifier.size(Space.S15), if (participant?.camera == true) Palette.MeetingWeak else Palette.MeetingDeviceOff)
                    }
                    if (owner && assistanceEnabled && person.role == "student" && person.id in connected) IconButton(
                        enabled = socketConnected && !pending && snapshot?.assistance == null && snapshot?.share == null,
                        onClick = { pending = true; scope.launch {
                            try { realtime.command("assistance.request", ThinkMeetJson.encodeToJsonElement(AssistanceRequestPayload(person.id)).jsonObject) }
                            catch (error: Throwable) { report(error) } finally { pending = false }
                        } }, modifier = Modifier.size(Space.S44)) {
                        DesignIcon("screen", Modifier.size(Space.S20), Palette.Primary, "${person.name} ${DesignContent.RemoteAssistRequest}")
                    }
                    if (owner && person.id != lesson.teacher.id) IconButton(onClick = { kickPerson = person }, modifier = Modifier.width(Space.S30).height(Space.S44)) { DesignIcon("more", Modifier.size(Space.S20), Palette.MeetingSecondary, "${person.name} 퇴장") }
                }
            }
        }
    }
    if (kickPerson != null) AlertDialog(onDismissRequest = { kickPerson = null }, title = { Text("${kickPerson!!.name} 님을 퇴장시킬까요?") }, text = { Text("이 참여자는 이 수업에 다시 입장할 수 없습니다.") },
        confirmButton = { TextButton(enabled = !pending, onClick = { val person = kickPerson!!; pending = true; scope.launch { try { api.kick(lesson.id, person.id); kickPerson = null } catch (error: Throwable) { report(error) } finally { pending = false } } }) { Text("퇴장시키기", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(enabled = !pending, onClick = { kickPerson = null }) { Text("취소") } })
}

@Composable
private fun ColumnScope.MaterialsPanel(api: ThinkMeetApi, lesson: Lesson, snapshot: MeetingSnapshot?, realtime: MeetingRealtime, report: (Throwable) -> Unit, onShared: () -> Unit) {
    val scope = rememberCoroutineScope()
    var materials by remember { mutableStateOf<List<Material>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var uploading by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Set<String>>(emptySet()) }
    var contentTab by remember { mutableStateOf("media") }
    suspend fun reload() { materials = api.materials() }
    LaunchedEffect(api) { try { reload() } catch (error: Throwable) { report(error) } finally { loading = false } }
    val picker = rememberFilePicker { file ->
        if (file != null) {
            val pdf = file.name.endsWith(".pdf", true)
            val mp4 = file.name.endsWith(".mp4", true)
            val limit = if (pdf) 50L * 1024 * 1024 else 500L * 1024 * 1024
            if ((!pdf && !mp4) || file.size > limit) { file.release(); report(IllegalArgumentException("PDF는 50MiB, MP4는 500MiB까지 업로드할 수 있어요.")) }
            else {
                uploading = true
                scope.launch {
                    try { api.upload(file.name, file.size, if (pdf) "application/pdf" else "video/mp4", file.openChannel); reload(); contentTab = if (pdf) "document" else "media" }
                    catch (error: Throwable) { report(error) } finally { file.release(); uploading = false }
                }
            }
        }
    }
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16)) {
        item {
            Row(Modifier.fillMaxWidth().padding(bottom = Space.S16)) {
                listOf("media" to "미디어", "document" to "문서").forEach { (value, label) ->
                    Column(Modifier.weight(1f).clickable { contentTab = value }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.height(Space.S48), contentAlignment = Alignment.Center) { Text(label, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = if (contentTab == value) Palette.Primary else Palette.MeetingSecondary) }
                        Box(Modifier.fillMaxWidth().height(Space.S2).background(if (contentTab == value) Palette.Primary else Palette.MeetingText))
                    }
                }
            }
            DesignButton(if (uploading) "업로드 중…" else if (contentTab == "media") "미디어 파일 업로드" else "문서 파일 업로드", onClick = picker,
                modifier = Modifier.fillMaxWidth(), enabled = !uploading, secondary = true, textStyle = MaterialTheme.typography.labelLarge.copy(color = Palette.Primary), icon = { if (uploading) CircularProgressIndicator(Modifier.size(Space.S18), strokeWidth = Space.S2) else DesignIcon("plus", Modifier.size(Space.S20), Palette.Primary) })
            Text("내 파일", Modifier.padding(top = Space.S32, bottom = Space.S8), color = Palette.Muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
        if (loading) item { Box(Modifier.fillMaxWidth().padding(Space.S24), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(Space.S28)) } }
        val shown = materials.filter { it.type == contentTab }
        if (!loading && shown.isEmpty()) item { Text("업로드한 자료가 없어요.", Modifier.fillMaxWidth().background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8)).padding(Space.S16), color = Palette.Muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f)) }
        items(shown, key = { it.id }) { material ->
            val active = snapshot?.share?.materialId == material.id
            Row(Modifier.fillMaxWidth().padding(vertical = Space.S8).heightIn(min = 76.dp)
                .border(Space.S1, if (active) Palette.PrimarySoft else Palette.MeetingText, RoundedCornerShape(Corner.R8))
                .background(if (active) Palette.Selection else Palette.White, RoundedCornerShape(Corner.R8)).padding(Space.S12),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                Box(Modifier.size(42.dp, Space.S44).background(Palette.Selection, RoundedCornerShape(Corner.R7)), contentAlignment = Alignment.Center) { DesignIcon(if (material.type == "document") "file" else "video", Modifier.size(Space.S22), Palette.Primary) }
                Column(Modifier.weight(1f).clickable { scope.launch { try { realtime.command("share.start", buildJsonObject { put("type", material.type); put("materialId", material.id) }); onShared() } catch (error: Throwable) { report(error) } } }, verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                    Text(material.name, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val detail = if (material.type == "document") "${material.pages ?: 0}페이지 · PDF" else "${meetingDuration(material.duration?.toDouble() ?: 0.0)} · MP4"
                    Text("$detail · ${(material.size / 1024 / 1024.0 * 10).toInt() / 10.0}MiB", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = if (active) Palette.PrimaryPressed else Palette.Muted)
                }
                IconButton(enabled = !active && material.id !in deleting, modifier = Modifier.width(38.dp).height(Space.S44), onClick = {
                    deleting = deleting + material.id
                    scope.launch { try { api.deleteMaterial(material.id); materials = materials.filterNot { it.id == material.id } } catch (error: Throwable) { report(error) } finally { deleting = deleting - material.id } }
                }) { DesignIcon("trash", Modifier.size(Space.S17), if (active) Palette.Line else Palette.MeetingWeak, "${material.name} 삭제") }
            }
        }
        item { Row(Modifier.fillMaxWidth().padding(top = Space.S24).background(Palette.Canvas, RoundedCornerShape(Corner.R8)).padding(horizontal = Space.S16, vertical = Space.S12), horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignIcon("alert", Modifier.size(Space.S17), Palette.Muted)
            Text("새 자료 또는 화면을 공유하면 기존 공유가 전환됩니다. PDF 50MiB, MP4 500MiB까지 지원합니다.", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
        } }
    }
}

private fun meetingDuration(seconds: Double): String {
    val total = seconds.takeIf { it.isFinite() }?.toLong()?.coerceAtLeast(0) ?: 0L
    return "${(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}"
}

@Composable
private fun DevicePanel(media: MediaController, state: MediaState, report: (Throwable) -> Unit) {
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Space.S24, vertical = Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
        Row(Modifier.padding(bottom = Space.S16), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
            DesignIcon("settings", Modifier.size(Space.S22), Palette.Primary)
            Column(verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                Text("장치 설정", style = MaterialTheme.typography.labelLarge, color = Palette.TextSecondary)
                Text("현재 수업의 카메라와 소리를 조절합니다.", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
            }
        }
        Text("카메라", style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.Muted)
        DesignButton("전면 / 후면 카메라 전환", onClick = { scope.launch { try { media.flipCamera() } catch (error: Throwable) { report(error) } } }, modifier = Modifier.fillMaxWidth(), secondary = true, icon = { DesignIcon("video", Modifier.size(Space.S18), Palette.Primary) })
        Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(Corner.R8)).background(Palette.MeetingTile), contentAlignment = Alignment.Center) {
            val local = state.participants.firstOrNull { it.local }
            if (state.camera && local != null && LocalMeetingVideoRendering.current) VideoSurface(media, local.identity, modifier = Modifier.fillMaxSize())
            else Text("카메라 꺼짐", color = Palette.MeetingMuted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
        Text("마이크 입력", Modifier.padding(top = Space.S12), style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.Muted)
        Text("기기 기본 마이크", Modifier.fillMaxWidth().border(Space.S1, Palette.Line, RoundedCornerShape(Corner.R8)).padding(Space.S12), style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.TextSecondary)
        Text("상대방 소리 출력", Modifier.padding(top = Space.S12), style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.Muted)
        Row(Modifier.fillMaxWidth().heightIn(min = Space.S48).border(Space.S1, Palette.Line, RoundedCornerShape(Corner.R8)).padding(horizontal = Space.S12), verticalAlignment = Alignment.CenterVertically) {
            Text(if (state.speaker) "스피커" else "기기 기본 출력", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), color = Palette.TextSecondary)
            Switch(state.speaker, onCheckedChange = { enabled -> scope.launch { try { media.setSpeaker(enabled) } catch (error: Throwable) { report(error) } } })
        }
        Text("블루투스·유선 헤드셋은 기기의 오디오 경로 설정을 따릅니다.", Modifier.fillMaxWidth().background(Palette.MeetingSubtle, RoundedCornerShape(Corner.R8)).padding(Space.S12), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
        HorizontalDivider(Modifier.padding(top = Space.S4), color = Palette.MeetingText)
        Row(Modifier.fillMaxWidth().padding(vertical = Space.S4), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.S4)) { Text("노이즈 캔슬링", style = MaterialTheme.typography.labelLarge, color = Palette.TextSecondary); Text("기기의 기본 음성 처리 적용", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted) }
            Text("자동", Modifier.background(Palette.Selection, RoundedCornerShape(Corner.R4)).padding(horizontal = Space.S8, vertical = Space.S4), style = MaterialTheme.typography.labelSmall, color = Palette.Primary)
        }
        Text("권한이 꺼져 있다면 기기 설정에서 카메라와 마이크 접근을 허용해 주세요.", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.Muted)
    }
}
