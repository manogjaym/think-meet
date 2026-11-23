@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Spacing as Space
import com.woongjin.thinkmeet.design.generated.DesignTokens.Radius as Corner
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas as ImageCanvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import com.woongjin.thinkmeet.data.*
import com.woongjin.thinkmeet.platform.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlin.math.min
import kotlin.time.Clock
import kotlin.time.Instant

private data class DraftStroke(val tool: String, val color: String, val points: List<Point>)
private data class CachedStroke(val tool: String, val color: Color, val path: Path)
// Annotation colors are persisted classroom content, independent of the app brand palette.
private val penColors = listOf("#1f2937", "#ef6461", "#f2b84b", "#4f9d76", "#4386d8", "#8b6bc1")

@Composable
internal fun SharedStage(
    api: ThinkMeetApi,
    snapshot: MeetingSnapshot,
    user: User,
    media: MediaController,
    realtime: MeetingRealtime,
    modifier: Modifier,
    report: (Throwable) -> Unit,
    onStopShare: (String) -> Unit,
    captureEnabled: Boolean = false,
    onCapture: (String, Int, ByteArray) -> Unit = { _, _, _ -> },
    textbookLayout: Boolean = false,
    dockedParticipants: Boolean = false,
) {
    val share = snapshot.share ?: return
    val owner = snapshot.lesson.teacher.id == user.id
    // A missing value comes from an older server, which lets everyone annotate.
    val canAnnotate = owner || snapshot.participants.firstOrNull { it.user.id == user.id }?.annotationAllowed != false
    val noteFrame = remember(share.id, share.page) { NoteFrameSource() }
    val captureSource = noteFrame.takeIf { captureEnabled && share.assistanceId == null }
    var captureSize by remember(share.id) { mutableStateOf(IntSize.Zero) }
    var readingFrame by remember(share.id) { mutableStateOf(false) }
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val mediaState by media.state.collectAsState()
    val capabilities by api.capabilities.collectAsState()
    val socketConnected by realtime.connected.collectAsState()
    val assistance = snapshot.assistance?.takeIf { it.status == "active" && it.shareId == share.id && share.type == "screen" && share.assistanceId == it.id }
    val assistanceEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance)
    val scope = rememberCoroutineScope()
    var annotating by remember(share.id) { mutableStateOf(false) }
    // Classroom and mirroring modes keep annotation on; legacy rooms still start and stop it explicitly.
    val alwaysAnnotate = snapshot.instruction?.phase == "classroom" || snapshot.instruction?.phase == "mirroring"
    // Students in lesson modes still need the teacher's annotation permission; the owner always has it.
    val annotationOn = (annotating || alwaysAnnotate) && canAnnotate
    var tool by remember { mutableStateOf("pen") }
    var color by remember { mutableStateOf(penColors[1]) }
    var aspect by remember(share.id) { mutableFloatStateOf(if (share.type == "document") .7071f else 16f / 9f) }
    var zoom by remember(share.id, share.page) { mutableFloatStateOf(1f) }
    var draft by remember(share.id, share.page) { mutableStateOf<DraftStroke?>(null) }
    var clearConfirm by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var optimistic by remember(share.id, share.page) { mutableStateOf<Map<String, DraftStroke>>(emptyMap()) }
    val strokes = remember(snapshot.strokes, share.id, share.page) { snapshot.strokes.filter { it.shareId == share.id && it.page == share.page && !it.deleted } }
    val screenAspect = mediaState.participants.firstOrNull { it.identity == share.ownerId }?.screenAspectRatio
    var guideReady by remember { mutableStateOf(false) }
    var pulse by remember(share.id, assistance?.geometry?.version) { mutableStateOf<AssistancePointer?>(null) }
    LaunchedEffect(assistance?.id, assistance?.geometry?.version, screenAspect, socketConnected, assistanceEnabled) {
        guideReady = false
        pulse = null
        if (assistanceEnabled && socketConnected && owner && assistanceAspectMatches(assistance?.geometry, screenAspect)) {
            delay(500)
            guideReady = true
        }
    }
    LaunchedEffect(assistance?.id) { if (assistance != null) { annotating = false; draft = null } }
    LaunchedEffect(canAnnotate) { if (!canAnnotate) { annotating = false; draft = null } }
    LaunchedEffect(pulse) { if (pulse != null) { delay(1_500); pulse = null } }
    LaunchedEffect(share.id, screenAspect) { if (share.type == "screen" && screenAspect != null && screenAspect in .05f..20f) aspect = screenAspect }
    // Remote stroke previews are transient and never treated as persisted annotations.
    var previews by remember(share.id, share.page) { mutableStateOf<Map<String, Pair<StrokePreview, Long>>>(emptyMap()) }
    LaunchedEffect(realtime, share.id, share.page) {
        realtime.previews.collect { preview ->
            if (preview.shareId == share.id && preview.page == share.page && preview.authorId != user.id) {
                val author = preview.authorId ?: "remote"
                previews = if (preview.points.isEmpty()) previews - author else previews + (author to (preview to Clock.System.now().toEpochMilliseconds()))
            }
        }
    }
    LaunchedEffect(share.id, share.page) {
        while (true) { delay(1000); val cutoff = Clock.System.now().toEpochMilliseconds() - 2000; previews = previews.filterValues { it.second > cutoff } }
    }
    LaunchedEffect(snapshot.seq) { optimistic = optimistic.filterKeys { id -> strokes.none { it.id == id } } }
    fun <P> command(command: ContractCommand<P>, payload: P) {
        scope.launch { pending = true; try { realtime.send(command, payload) } catch (error: Throwable) { report(error) } finally { pending = false } }
    }
    fun addStroke(value: DraftStroke) {
        val id = uniqueId()
        val points = if (value.points.size == 1) value.points + value.points[0].copy(x = min(1.0, value.points[0].x + .0001)) else value.points
        val finalStroke = value.copy(points = points)
        optimistic = optimistic + (id to finalStroke)
        scope.launch {
            try {
                realtime.send(ContractProtocol.Commands.StrokeAdd, StrokeAddPayload(id, share.id, share.page, value.tool, value.color, points))
            } catch (error: Throwable) { optimistic = optimistic - id; report(error) }
            finally { runCatching { realtime.preview(share.id, share.page, value.tool, value.color, emptyList()) } }
        }
    }
    val compact = LocalMeetingCompact.current
    val captureControl: @Composable () -> Unit = {
        if (captureEnabled) Surface(onClick = {
            val read = captureSource?.read ?: return@Surface
            if (readingFrame || !socketConnected || !mediaState.connected || captureSize.width <= 0) return@Surface
            readingFrame = true
            val visibleWidth = captureSize.width
            scope.launch {
                try {
                    val frame = read() ?: error("공유 화면을 불러오는 중이에요.")
                    val bytes = withContext(Dispatchers.Default) {
                        val image = ImageBitmap(frame.width, frame.height)
                        val bounds = Size(frame.width.toFloat(), frame.height.toFloat())
                        CanvasDrawScope().draw(density, direction, ImageCanvas(image), bounds) {
                            drawRect(Color.White)
                            drawImage(frame)
                            strokes.forEach { stroke ->
                                val path = annotationPath(stroke.points, size.width, size.height)
                                drawAnnotationPath(stroke.tool, hexColor(stroke.color), path, widthScale = size.width / visibleWidth)
                            }
                        }
                        encodeNoteImage(image) ?: error("공유 화면의 이미지를 만들지 못했어요.")
                    }
                    onCapture(share.id, share.page, bytes)
                } catch (error: Throwable) { report(error) }
                finally { readingFrame = false }
            }
        }, enabled = !readingFrame && socketConnected && mediaState.connected && captureSource?.read != null && captureSize.width > 0,
            color = Palette.MeetingShareText, contentColor = Palette.MeetingShareInk, shape = RoundedCornerShape(Corner.R6)) {
            Box(Modifier.heightIn(min = Space.S36).padding(horizontal = if (compact) Space.S8 else Space.S12), contentAlignment = Alignment.Center) {
                Text(DesignContent.NotesCapture, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
            }
        }
    }
    val documentControls: @Composable (Modifier) -> Unit = { controlsModifier ->
        Surface(controlsModifier, shape = RoundedCornerShape(Corner.R8), color = Palette.MeetingTile) {
            // Zoom and page controls wrap as groups, so 이전·쪽·다음 never split across lines (same as web).
            FlowRow(Modifier.padding(Space.S5), horizontalArrangement = Arrangement.spacedBy(Space.S4, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Space.S4), verticalAlignment = Alignment.CenterVertically) {
                    StageButton("− 축소", enabled = zoom > .5f, description = "PDF 축소") { zoom = (zoom - .25f).coerceAtLeast(.5f) }
                    Text("${(zoom * 100).toInt()}%", Modifier.padding(horizontal = Space.S6), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingMuted)
                    StageButton("＋ 확대", enabled = zoom < 4f, description = "PDF 확대") { zoom = (zoom + .25f).coerceAtMost(4f) }
                    StageButton("화면에 맞추기") { zoom = 1f }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.S4), verticalAlignment = Alignment.CenterVertically) {
                    StageButton("이전", enabled = owner && !pending && share.page > 1, description = "PDF 이전 페이지") { command(ContractProtocol.Commands.DocumentPage, DocumentPagePayload(share.page - 1)) }
                    Text("${share.page} / ${share.material?.pages ?: 1}쪽", Modifier.padding(horizontal = Space.S6), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingMuted)
                    StageButton("다음", enabled = owner && !pending && share.page < (share.material?.pages ?: 1), description = "PDF 다음 페이지") { command(ContractProtocol.Commands.DocumentPage, DocumentPagePayload(share.page + 1)) }
                }
                if (textbookLayout) captureControl()
            }
        }
    }
    val annotationControls: @Composable (Modifier) -> Unit = { controlsModifier ->
        if (!canAnnotate) Unit
        else if (!annotationOn) Surface(onClick = { annotating = true }, modifier = controlsModifier, color = Palette.Selection,
            contentColor = Palette.PrimaryPressed, shape = RoundedCornerShape(Corner.R8)) {
            Row(Modifier.heightIn(min = Space.S44).padding(horizontal = Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S7)) {
                DesignIcon("pen", Modifier.size(Space.S20), Palette.PrimaryPressed)
                Text("판서 시작", style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
            }
        } else Surface(controlsModifier, shape = RoundedCornerShape(Corner.R9), color = Palette.MeetingTile) {
            // Icon-only tools keep page controls and annotation on one footer row; names stay in content descriptions.
            // Wider screens keep the bar on one line so the footer moves it whole to the next line (web behaviour).
            val tools: @Composable () -> Unit = {
                listOf("pen" to "펜", "highlighter" to "형광펜", "eraser" to "지우개").forEach { (value, label) ->
                    StageButton(null, icon = value, description = label, selected = tool == value, minHeight = if (compact) Space.S36 else Space.S44) { tool = value }
                }
                Row(Modifier.heightIn(min = if (compact) Space.S36 else Space.S44), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compact) Space.S2 else Space.S4)) {
                    penColors.forEach { penColor ->
                        Box(Modifier.size(if (compact) Space.S22 else Space.S28).clip(CircleShape).background(hexColor(penColor))
                            .border(Space.S2, if (color == penColor) Palette.White else Color.Transparent, CircleShape).clickable { color = penColor }
                            .semantics { contentDescription = "색상 $penColor" }, contentAlignment = Alignment.Center) {
                            if (color == penColor) DesignIcon("check", Modifier.size(Space.S12), Palette.White)
                        }
                    }
                }
                StageButton(null, icon = "undo", description = "실행 취소", enabled = !pending, minHeight = if (compact) Space.S36 else Space.S44) { command(ContractProtocol.Commands.AnnotationUndo, EmptyPayload()) }
                StageButton(null, icon = "redo", description = "다시 실행", enabled = !pending, minHeight = if (compact) Space.S36 else Space.S44) { command(ContractProtocol.Commands.AnnotationRedo, EmptyPayload()) }
                StageButton(null, icon = "trash", description = if (owner) "전체 지우기" else "내 판서 지우기", enabled = strokes.any { owner || it.authorId == user.id }, minHeight = if (compact) Space.S36 else Space.S44) { clearConfirm = true }
                if (!alwaysAnnotate) StageButton("판서 종료", icon = "close", minHeight = if (compact) Space.S36 else Space.S44) { annotating = false; draft = null }
            }
            if (compact) FlowRow(Modifier.padding(Space.S4), horizontalArrangement = Arrangement.spacedBy(Space.S4, Alignment.End), verticalArrangement = Arrangement.spacedBy(Space.S4)) { tools() }
            else Row(Modifier.padding(Space.S4), horizontalArrangement = Arrangement.spacedBy(Space.S4), verticalAlignment = Alignment.CenterVertically) { tools() }
        }
    }
    val renderContent: @Composable (Modifier) -> Unit = { contentModifier ->
        BoxWithConstraints(contentModifier.clip(RoundedCornerShape(Corner.R10)).background(Palette.MeetingSharedBackground)) {
            BoxWithConstraints(Modifier.fillMaxSize().padding(start = if (compact) Space.S8 else Space.S12, end = if (compact) Space.S8 else Space.S12,
                top = Space.S8, bottom = Space.S8), contentAlignment = Alignment.Center) {
                val fitWidth = min(maxWidth.value, maxHeight.value * aspect).coerceAtLeast(1f).dp
                val fitHeight = (fitWidth.value / aspect).dp
                // The PDF/video and annotation overlay retain the exact same fitted coordinate bounds.
                Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
                Box(Modifier.size(fitWidth * zoom, fitHeight * zoom).background(if (share.type == "document") Palette.White else Palette.MeetingSharedBackground)) {
                    if (share.type == "screen") {
                        if (LocalMeetingVideoRendering.current) VideoSurface(media, share.ownerId, screen = true, modifier = Modifier.fillMaxSize(), noteFrame = captureSource)
                    } else MaterialSurface(api, share, snapshot.lessonId, Modifier.fillMaxSize(), noteFrame = captureSource, onAspectRatio = { if (it > .05f && it < 20f) aspect = it })
                var erasedThisGesture by remember { mutableStateOf<Set<String>>(emptySet()) }
                var previewAt by remember { mutableLongStateOf(0L) }
                var surfaceSize by remember { mutableStateOf(IntSize.Zero) }
                // Persisted paths are rebuilt only when their geometry or viewport changes.
                val cachedStrokes = remember(strokes, surfaceSize) {
                    strokes.map { CachedStroke(it.tool, hexColor(it.color), annotationPath(it.points, surfaceSize.width.toFloat(), surfaceSize.height.toFloat())) }
                }
                val currentStrokes by rememberUpdatedState(strokes)
                val guideModifier = if (!guideReady || assistance == null) Modifier else Modifier.pointerInput(assistance.id, assistance.geometry?.version) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        down.consume()
                        val geometry = assistance.geometry ?: return@awaitEachGesture
                        val point = AssistancePointer(snapshot.lessonId, assistance.id, share.id, geometry.version,
                            (down.position.x / size.width).toDouble().coerceIn(0.0, 1.0), (down.position.y / size.height).toDouble().coerceIn(0.0, 1.0))
                        pulse = point
                        scope.launch { realtime.assistancePointer(point) }
                    }
                }
                val drawModifier = if (!annotationOn || assistance != null) Modifier else Modifier.pointerInput(share.id, share.page, tool, color) {
                    fun pointAt(offset: Offset): Point = Point((offset.x / size.width).toDouble().coerceIn(0.0, 1.0), (offset.y / size.height).toDouble().coerceIn(0.0, 1.0))
                    fun erase(point: Point) {
                        val ids = currentStrokes.filter { stroke ->
                            (owner || stroke.authorId == user.id) && stroke.id !in erasedThisGesture && hitsStroke(point, stroke.points, size.width.toFloat(), size.height.toFloat())
                        }.map { it.id }
                        if (ids.isNotEmpty()) {
                            erasedThisGesture += ids
                            ids.chunked(500).forEach { batch -> command(ContractProtocol.Commands.StrokeErase, StrokeErasePayload(batch)) }
                        }
                    }
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        down.consume()
                        erasedThisGesture = emptySet()
                        val first = pointAt(down.position)
                        if (tool == "eraser") erase(first) else draft = DraftStroke(tool, color, listOf(first))
                        try {
                            while (true) {
                                val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                                change.consume()
                                if (!change.pressed) break
                                val point = pointAt(change.position)
                                if (tool == "eraser") erase(point)
                                else {
                                    val previous = draft
                                    if (previous != null && previous.points.size < 2048) {
                                        val last = previous.points.last()
                                        if (kotlin.math.abs(last.x - point.x) + kotlin.math.abs(last.y - point.y) > .001) {
                                            val next = previous.copy(points = previous.points + point)
                                            draft = next
                                            val now = Clock.System.now().toEpochMilliseconds()
                                            if (now - previewAt > 100) {
                                                previewAt = now
                                                scope.launch { runCatching { realtime.preview(share.id, share.page, next.tool, next.color, next.points.takeLast(256)) } }
                                            }
                                        }
                                    }
                                }
                            }
                            draft?.let(::addStroke)
                        } finally { draft = null }
                    }
                }
                Canvas(Modifier.fillMaxSize().onSizeChanged { surfaceSize = it; captureSize = it }.then(if (assistance != null) guideModifier else drawModifier).semantics { contentDescription = if (guideReady) DesignContent.RemoteAssistActive else "수업 판서 영역" }) {
                    cachedStrokes.forEach { drawAnnotationPath(it.tool, it.color, it.path) }
                    previews.values.forEach { (preview, _) -> drawAnnotation(preview.tool, preview.color, preview.points) }
                    optimistic.values.forEach { drawAnnotation(it.tool, it.color, it.points) }
                    draft?.let { drawAnnotation(it.tool, it.color, it.points) }
                    if (guideReady) pulse?.let { point ->
                        val center = Offset((point.x * size.width).toFloat(), (point.y * size.height).toFloat())
                        drawCircle(Palette.Danger, (Component.RemotePointerSize - Component.RemotePointerRingWidth).toPx() / 2, center, style = DrawStroke(Component.RemotePointerRingWidth.toPx()))
                        drawCircle(Palette.Danger, Component.RemotePointerCoreSize.toPx() / 2, center)
                    }
                }
                }
                }
            }
            if (assistance != null) Surface(Modifier.align(Alignment.TopStart).padding(Space.S12), color = Palette.MeetingTile, shape = RoundedCornerShape(Corner.R8)) {
                Text(if (guideReady) DesignContent.RemoteAssistActive else if (owner) DesignContent.RemoteAssistGeometryWaiting else DesignContent.RemoteAssistActiveStudent,
                    Modifier.padding(Space.S10), style = MaterialTheme.typography.bodySmall, color = Palette.MeetingText)
            }
        }
    }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(bottom = Space.S12).heightIn(min = Space.S48).background(Palette.MeetingShareBackground, RoundedCornerShape(Corner.R8))
            .padding(horizontal = if (compact) Space.S8 else Space.S16, vertical = Space.S4), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
            DesignIcon("screen", Modifier.size(Space.S17), Palette.MeetingShareText)
            val ownerName = snapshot.participants.firstOrNull { it.user.id == share.ownerId }?.user?.name ?: "참여자"
            Text(if (share.type == "screen") "$ownerName 님의 화면 공유 중" else "${share.material?.name ?: "수업 자료"} 공유 중", Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingShareText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!textbookLayout) captureControl()
            if (owner || share.ownerId == user.id) Surface(onClick = { onStopShare(share.id) },
                enabled = !pending, color = Palette.MeetingShareText, contentColor = Palette.MeetingShareInk, shape = RoundedCornerShape(Corner.R6)) {
                Box(Modifier.heightIn(min = Space.S36).padding(horizontal = if (compact) Space.S8 else Space.S12), contentAlignment = Alignment.Center) { Text("공유 중지", style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f)) }
            }
        }
        val renderStage: @Composable (Modifier) -> Unit = { stageModifier ->
            // Page or playback controls on the left and annotation tools on the right, always under the shared content (web: .stage-footer).
            Column(stageModifier, verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                renderContent(Modifier.weight(1f).fillMaxWidth())
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S4), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                    // Without annotation tools (e.g. a student) the page controls take the whole line instead of leaving a gap.
                    if (share.type == "document") documentControls(Modifier.align(Alignment.CenterVertically).then(if (canAnnotate) Modifier else Modifier.weight(1f)))
                    if (share.type == "media") Surface(Modifier.align(Alignment.CenterVertically), shape = RoundedCornerShape(Corner.R8), color = Palette.MeetingTile) {
                        MediaTransport(share, snapshot.serverTime, owner, pending) { command(ContractProtocol.Commands.MediaUpdate, it) }
                    }
                    // Fills the rest of its line so the tools stay right-aligned even after wrapping (web: margin-inline-start:auto).
                    if (assistance == null && canAnnotate) Box(Modifier.weight(1f).align(Alignment.CenterVertically), contentAlignment = Alignment.CenterEnd) {
                        annotationControls(Modifier)
                    }
                }
            }
        }
        if (compact) Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            renderStage(Modifier.weight(1f).fillMaxWidth())
            SharedParticipants(snapshot, user, media, mediaState,
                Modifier.fillMaxWidth().height(if (textbookLayout) Space.S96 else 142.dp), horizontal = true)
        } else Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
            renderStage(Modifier.weight(1f).fillMaxHeight())
            if (!dockedParticipants) {
                SharedParticipants(snapshot, user, media, mediaState,
                    Modifier.width(if (LocalMeetingViewportWidth.current <= com.woongjin.thinkmeet.design.generated.DesignTokens.Layout.MeetingMediumBreakpoint) 130.dp else 160.dp).fillMaxHeight(),
                    horizontal = false)
            }
        }
    }
    if (clearConfirm) MeetingLightTheme {
        AlertDialog(onDismissRequest = { clearConfirm = false }, shape = RoundedCornerShape(Corner.R14), containerColor = Palette.White,
            title = { Text(if (owner) "판서를 모두 지울까요?" else "내 판서를 지울까요?", style = MaterialTheme.typography.titleLarge.copy(fontSize = Type.Dialog, lineHeight = Type.Dialog * 1.4091f), fontWeight = DesignWeight.Bold, color = Palette.Ink) },
            text = { Text("현재 페이지의 판서를 삭제합니다. 이 작업은 되돌릴 수 없습니다.", color = Palette.Muted) },
            confirmButton = { DesignButton("지우기", onClick = { clearConfirm = false; command(ContractProtocol.Commands.AnnotationClear, EmptyPayload()) }) },
            dismissButton = { DesignButton("취소", onClick = { clearConfirm = false }, secondary = true) })
    }
}

@Composable
private fun StageButton(label: String?, icon: String? = null, description: String? = label, enabled: Boolean = true, selected: Boolean = false, media: Boolean = false, minHeight: androidx.compose.ui.unit.Dp = Space.S40, onClick: () -> Unit) {
    val ink = if (selected) { if (media) Palette.PrimaryOnDark else Palette.PrimaryPressed } else Palette.MeetingText
    Surface(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(Corner.R6), color = if (selected) { if (media) Palette.MeetingMediaActive else Palette.Selection } else Palette.MeetingControl,
        modifier = Modifier.alpha(if (enabled) 1f else .4f).semantics { if (description != null) contentDescription = description }) {
        Row(Modifier.heightIn(min = minHeight).padding(horizontal = if (label == null) Space.S8 else Space.S10), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S5)) {
            if (icon != null) DesignIcon(icon, Modifier.size(if (label == null) Space.S20 else Space.S17), ink)
            if (label != null) Text(label, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = ink)
        }
    }
}

@Composable
internal fun SharedParticipants(snapshot: MeetingSnapshot, user: User, media: MediaController, state: MediaState, modifier: Modifier, horizontal: Boolean, docked: Boolean = false, rail: Boolean = false) {
    val owner = snapshot.lesson.teacher.id == user.id
    val participants = snapshot.participants.filter { it.online && if (owner) docked || it.user.id != snapshot.lesson.teacher.id else it.user.id == snapshot.lesson.teacher.id }
    // The textbook dock lists the owner first; the owner rail lists students first, as in the lesson design.
    val people = if (docked && rail) participants.sortedBy { it.user.id == user.id } else if (docked) participants.sortedByDescending { it.user.id == user.id } else participants
    BoxWithConstraints(modifier) {
        val tileHeight = (maxHeight - 92.dp).coerceIn(Space.S56, if (LocalMeetingViewportWidth.current <= com.woongjin.thinkmeet.design.generated.DesignTokens.Layout.MeetingMediumBreakpoint) 115.dp else 132.dp)
        val stripHeight = if (horizontal && LocalMeetingCompact.current && maxHeight <= Space.S96) Space.S64 else 90.dp
        val size = if (docked) 2 else if (horizontal) kotlin.math.floor((maxWidth.value + 8) / 120).toInt().coerceIn(1, 4)
            else kotlin.math.floor((maxHeight.value - 40 - 52 + 12) / (tileHeight.value + 12)).toInt().coerceIn(1, 4)
        var page by remember(size) { mutableIntStateOf(0) }
        val pages = ((people.size + size - 1) / size).coerceAtLeast(1)
        val safePage = page.coerceIn(0, pages - 1)
        val visible = people.drop(safePage * size).take(size)
        // Tiles keep their size; a controls row below them adds its own height.
        val controls = LocalParticipantControls.current
        val compact = LocalMeetingCompact.current
        fun extra(id: String) = if (controls?.visibleFor(id, id == user.id) == true) participantControlsHeight(compact) + (if (compact) Space.S4 else Space.S8) else 0.dp
        val stripExtra = visible.maxOfOrNull { extra(it.user.id) } ?: 0.dp
        Column(if (docked && !rail) Modifier.fillMaxWidth() else Modifier.fillMaxSize()) {
            if (!horizontal && !docked) Row(Modifier.padding(bottom = Space.S12), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S6)) { DesignIcon("users", Modifier.size(Space.S14), Palette.MeetingDim); Text(if (owner) "참여자 ${people.size}명" else "선생님", style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingDim) }
            if (people.isEmpty()) Box(Modifier.fillMaxWidth().height(Space.S96), contentAlignment = Alignment.Center) { Text("입장 대기 중", color = Palette.MeetingDim, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f)) }
            else if (horizontal) Row(Modifier.fillMaxWidth().height(stripHeight + stripExtra), horizontalArrangement = Arrangement.spacedBy(Space.S8)) {
                visible.forEach { entry -> ParticipantTile(entry.user, entry.user.id == snapshot.lesson.teacher.id, entry.raised, media, state, Modifier.weight(1f).fillMaxHeight(), small = true) }
            // Rail cells (tile + any controls row) split the given height equally; the tile shrinks first, like the web rail.
            } else if (rail) Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
                visible.forEach { entry -> ParticipantTile(entry.user, entry.user.id == snapshot.lesson.teacher.id, entry.raised, media, state, Modifier.fillMaxWidth().weight(1f), small = true, cameraStatus = true) }
            } else Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.S12)) {
                visible.forEach { entry -> ParticipantTile(entry.user, entry.user.id == snapshot.lesson.teacher.id, entry.raised, media, state, Modifier.fillMaxWidth().height(tileHeight + extra(entry.user.id)), small = true) }
            }
            if (pages > 1) MeetingPagination(safePage, pages, safePage * size + 1, kotlin.math.min((safePage + 1) * size, people.size), people.size,
                onPrevious = { page = (safePage - 1).coerceAtLeast(0) }, onNext = { page = (safePage + 1).coerceAtMost(pages - 1) })
        }
    }
}

@Composable
private fun MediaTransport(share: Share, serverTime: String, owner: Boolean, pending: Boolean, update: (MediaUpdatePayload) -> Unit) {
    var now by remember { mutableStateOf(Clock.System.now()) }
    val receivedAt = remember(serverTime) { Clock.System.now() }
    val serverAt = remember(serverTime) { runCatching { Instant.parse(serverTime) }.getOrDefault(receivedAt) }
    val anchor = remember(share.updatedAt) { runCatching { Instant.parse(share.updatedAt) }.getOrDefault(serverAt) }
    LaunchedEffect(share.id) { while (true) { delay(500); now = Clock.System.now() } }
    val elapsed = if (share.playing) ((now - receivedAt) + (serverAt - anchor)).inWholeMilliseconds / 1000.0 else 0.0
    val duration = (share.material?.duration ?: 0.0).toDouble().coerceAtLeast(0.0)
    val position = (share.position.toDouble() + elapsed).coerceIn(0.0, if (duration > 0) duration else Double.MAX_VALUE)
    var seeking by remember { mutableStateOf<Float?>(null) }
    FlowRow(Modifier.padding(Space.S5), horizontalArrangement = Arrangement.spacedBy(Space.S4, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(Space.S4)) {
        StageButton("재생", "play", "영상 재생", enabled = owner && !pending, selected = share.playing, media = true) { update(MediaUpdatePayload(playing = true, position = position)) }
        StageButton("정지", "pause", "영상 정지", enabled = owner && !pending, selected = !share.playing, media = true) { update(MediaUpdatePayload(playing = false, position = position)) }
        Slider(value = seeking ?: position.toFloat(), onValueChange = { seeking = it }, onValueChangeFinished = {
            seeking?.let { target -> update(MediaUpdatePayload(playing = share.playing, position = target.toDouble())) }; seeking = null
        }, valueRange = 0f..duration.toFloat().coerceAtLeast(.1f), enabled = owner && duration > 0 && !pending,
            colors = SliderDefaults.colors(thumbColor = Palette.PrimaryOnDark, activeTrackColor = Palette.PrimaryOnDark, inactiveTrackColor = Palette.MeetingBorder),
            modifier = Modifier.width(130.dp).height(Space.S40).semantics { contentDescription = "영상 재생 위치" })
        Text("${timeLabel(position)} / ${timeLabel(duration)}", Modifier.padding(horizontal = Space.S6, vertical = Space.S10), style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f), color = Palette.MeetingMuted)
    }
}

private fun timeLabel(seconds: Double): String { val total = seconds.toLong().coerceAtLeast(0); return "${total / 60}:${(total % 60).toString().padStart(2, '0')}" }
private fun hexColor(value: String): Color = Color((0xff000000L or (value.removePrefix("#").toLongOrNull(16) ?: 0L)).toInt())
// Pen geometry stays local so theme changes never alter shared annotation rendering.
private fun DrawScope.drawAnnotation(tool: String, color: String, points: List<Point>) {
    if (points.isEmpty()) return
    val path = annotationPath(points, size.width, size.height)
    val ink = hexColor(color)
    if (points.size == 1) drawCircle(ink, 2.dp.toPx(), Offset((points[0].x * size.width).toFloat(), (points[0].y * size.height).toFloat()))
    else drawAnnotationPath(tool, ink, path)
}
private fun annotationPath(points: List<Point>, width: Float, height: Float): Path = Path().apply { points.forEachIndexed { index, point -> if (index == 0) moveTo((point.x * width).toFloat(), (point.y * height).toFloat()) else lineTo((point.x * width).toFloat(), (point.y * height).toFloat()) } }
private fun DrawScope.drawAnnotationPath(tool: String, ink: Color, path: Path, widthScale: Float = 1f) = drawPath(path, ink, alpha = if (tool == "highlighter") .38f else 1f, style = DrawStroke((if (tool == "highlighter") 18.dp else 4.dp).toPx() * widthScale, cap = StrokeCap.Round, join = StrokeJoin.Round))
/** Segment distance, rather than only point distance, also erases quickly drawn sparse strokes. */
private fun hitsStroke(point: Point, points: List<Point>, width: Float, height: Float): Boolean {
    val px = point.x * width; val py = point.y * height
    val tolerance = 14.0
    if (points.size == 1) { val dx = points[0].x * width - px; val dy = points[0].y * height - py; return dx * dx + dy * dy <= tolerance * tolerance }
    for (index in 1 until points.size) {
        val a = points[index - 1]; val b = points[index]
        val ax = a.x * width; val ay = a.y * height; val dx = (b.x - a.x) * width; val dy = (b.y - a.y) * height
        val denominator = dx * dx + dy * dy
        val t = if (denominator == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / denominator).coerceIn(0.0, 1.0)
        val ex = px - ax - t * dx; val ey = py - ay - t * dy
        if (ex * ex + ey * ey <= tolerance * tolerance) return true
    }
    return false
}
