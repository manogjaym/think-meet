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


// Side panels of the meeting screen: chat, people, materials, invite, settings and more.
@Composable
internal fun MeetingPanel(
    panel: Panel, api: ThinkMeetApi, lesson: Lesson, user: User, snapshot: MeetingSnapshot?, realtime: MeetingRealtime,
    onClose: () -> Unit, report: (Throwable) -> Unit, chatDraft: MeetingChatDraft, media: MediaController, mediaState: MediaState,
    onPanel: (Panel) -> Unit, unread: Int, miniVisible: Boolean, onMini: () -> Unit,
    pipState: PictureInPictureState, pipEnabled: Boolean, onPip: () -> Unit,
    textbookEnabled: Boolean, textbookConnected: Boolean, closeAfterTextbook: Boolean,
    /** classroom.subject-switch: opens the subject picker from the more menu (phone width has no materials rail). */
    onSubject: (() -> Unit)? = null,
) {
    var textbookTab by remember(panel, textbookEnabled) { mutableStateOf(textbookEnabled) }
    val textbookHeader = panel == Panel.Materials && textbookTab
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().heightIn(min = if (textbookHeader) Space.S56 else LayoutToken.MeetingHeader)
            .padding(horizontal = Space.S24, vertical = if (textbookHeader) Space.S4 else Space.S12),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                val title = when {
                    panel == Panel.Invite && !lesson.isOpen -> "다른 참석자 추가"
                    textbookHeader -> DesignContent.TextbookPicker
                    else -> panel.title
                }
                Text(title,
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
                MaterialsPanel(api, lesson, user, snapshot, realtime, report, onClose, textbookEnabled, textbookConnected,
                    onTextbookTab = { textbookTab = it },
                    onTextbookOpened = { if (closeAfterTextbook) onClose() })
            }
            Panel.Settings -> DevicePanel(media, mediaState, report)
            Panel.Invite -> InvitePanel(api, lesson, report)
            Panel.More -> MorePanel(lesson, user, snapshot, realtime, report, onPanel, unread, miniVisible, onMini, pipState, pipEnabled, onPip, onSubject)
        }
    }
}

@Composable
private fun ColumnScope.MorePanel(
    lesson: Lesson, user: User, snapshot: MeetingSnapshot?, realtime: MeetingRealtime, report: (Throwable) -> Unit,
    onPanel: (Panel) -> Unit, unread: Int, miniVisible: Boolean, onMini: () -> Unit,
    pipState: PictureInPictureState, pipEnabled: Boolean, onPip: () -> Unit, onSubject: (() -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16), verticalArrangement = Arrangement.spacedBy(Space.S8)) {
        item { MeetingMenuItem("chat", "수업 채팅", "함께 이야기 나누기", badge = unread) { onPanel(Panel.Chat) } }
        if (lesson.isOwner(user)) {
            item { MeetingMenuItem(if (lesson.isOpen) "link" else "users", if (lesson.isOpen) "참여 링크 공유" else "다른 참석자 추가", if (lesson.isOpen) "누구나 참여할 수 있는 공개 수업" else "초대 학생과 참여 링크 관리") { onPanel(Panel.Invite) } }
            if (snapshot?.instruction?.phase.let { it == null || it == "classroom" }) {
                item { MeetingMenuItem("folder", "수업 자료", "영상과 PDF를 함께 보기") { onPanel(Panel.Materials) } }
            }
            if (onSubject != null) item {
                val subject = (snapshot?.lesson ?: lesson).subject?.name
                MeetingMenuItem("file", listOfNotNull(DesignContent.MeetingMaterialsSubject, subject).joinToString(" · "), DesignContent.MeetingSubjectSwitchMenuDetail, onClick = onSubject)
            }
        }
        item { MeetingMenuItem("settings", "카메라·마이크 설정", "입력·출력 장치 설정") { onPanel(Panel.Settings) } }
        item { MeetingMenuItem("pip", "화면 속 화면", if (!pipState.supported) "기기에서 지원하지 않아요" else "다른 앱을 보면서 수업 계속하기", enabled = pipState.supported && pipEnabled && !pipState.active && !pipState.transitioning) { onPip() } }
        item { MeetingMenuItem("video", "미니 영상", if (miniVisible) "영상창 숨기기" else "앱 안에서 이동 가능한 영상창 보기", selected = miniVisible, onClick = onMini) }
        if (lesson.isOwner(user)) item {
            val raised = snapshot?.participants?.firstOrNull { it.user.id == user.id }?.raised == true
            MeetingMenuItem("hand", if (raised) "손 내리기" else "손들기", "참석자에게 손들기 상태 표시", selected = raised) {
                scope.launch { try { realtime.send(ContractProtocol.Commands.HandSet, HandSetPayload(!raised)) } catch (error: Throwable) { report(error) } }
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
                        realtime.send(ContractProtocol.Commands.ChatSend, ChatSendPayload(text, id))
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
internal fun MirroringStudentDialog(
    students: List<User>, connected: Boolean, blocked: String?, onClose: () -> Unit, onRequest: suspend (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var selectedId by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val selected = students.firstOrNull { it.id == selectedId }
    AlertDialog(
        onDismissRequest = { if (!pending) onClose() },
        title = { Text(DesignContent.MeetingMirroringStudentTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.S12)) {
                Text(DesignContent.RemoteAssistRequestHelp)
                blocked?.let { Text(it) }
                if (students.isEmpty()) Text(DesignContent.MeetingMirroringNoStudents)
                else Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()).selectableGroup()) {
                    for (student in students) {
                        val checked = student.id == selected?.id
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = Space.S44)
                                .selectable(checked, enabled = !pending && blocked == null, role = Role.RadioButton) {
                                    selectedId = student.id
                                    error = null
                                }.padding(horizontal = Space.S8),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Space.S8),
                        ) {
                            MeetingPersonAvatar(student, Space.S32)
                            Text(student.name, Modifier.weight(1f))
                            RadioButton(checked, onClick = null)
                        }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        dismissButton = { TextButton(enabled = !pending, onClick = onClose) { Text("취소") } },
        confirmButton = {
            Button(enabled = selected != null && connected && !pending && blocked == null, onClick = {
                val student = selected ?: return@Button
                if (pending) return@Button
                pending = true
                error = null
                scope.launch {
                    try {
                        onRequest(student.id)
                        onClose()
                    } catch (failure: CancellationException) { throw failure }
                    catch (failure: Exception) { error = failure.message ?: "요청을 처리하지 못했어요." }
                    finally { pending = false }
                }
            }) { Text(DesignContent.MeetingMirroringRequest) }
        },
    )
}

@Composable
private fun ColumnScope.PeoplePanel(api: ThinkMeetApi, lesson: Lesson, user: User, snapshot: MeetingSnapshot?, media: MediaState, realtime: MeetingRealtime, report: (Throwable) -> Unit) {
    val owner = lesson.teacher.id == user.id
    val scope = rememberCoroutineScope()
    val capabilities by api.capabilities.collectAsState()
    val socketConnected by realtime.connected.collectAsState()
    val assistanceEnabled = capabilities.supports(ContractProtocol.FeatureIds.MeetingRemoteAssistance) &&
        snapshot?.instruction == null
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
                            try { realtime.send(ContractProtocol.Commands.AssistanceRequest, AssistanceRequestPayload(person.id)) }
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
private fun ColumnScope.MaterialsPanel(
    api: ThinkMeetApi, lesson: Lesson, user: User, snapshot: MeetingSnapshot?, realtime: MeetingRealtime, report: (Throwable) -> Unit,
    onShared: () -> Unit, textbookEnabled: Boolean, textbookConnected: Boolean,
    onTextbookTab: (Boolean) -> Unit, onTextbookOpened: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val capabilities by api.capabilities.collectAsState()
    // Subject storage scopes the list and new uploads to the lesson; the server files by the owner's subject only.
    val lessonId = lesson.id.takeIf { capabilities.supports(ContractProtocol.FeatureIds.ClassroomSubjectStorage) }
    val subject = lesson.subject.takeIf { lessonId != null && lesson.teacher.id == user.id }
    var materials by remember { mutableStateOf<List<Material>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var listFailed by remember { mutableStateOf(false) }
    var listAttempt by remember { mutableIntStateOf(0) }
    var uploading by remember { mutableStateOf(false) }
    var textbookBusy by remember { mutableStateOf(false) }
    var textbookError by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Set<String>>(emptySet()) }
    var contentTab by remember(textbookEnabled) { mutableStateOf(if (textbookEnabled) "document" else "media") }
    val textbookTab = textbookEnabled && contentTab == "document"
    val shown = materials.filter { it.type == contentTab }
    LaunchedEffect(textbookTab) { onTextbookTab(textbookTab); textbookError = null }
    LaunchedEffect(api, listAttempt, lessonId) {
        loading = true
        listFailed = false
        try { materials = api.materials(lessonId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { listFailed = true }
        finally { loading = false }
    }

    val picker = rememberFilePicker { file ->
        if (file != null) {
            val pdf = file.name.endsWith(".pdf", true)
            val mp4 = file.name.endsWith(".mp4", true)
            val limit = if (pdf) 50L * 1024 * 1024 else 500L * 1024 * 1024
            if ((!pdf && !mp4) || file.size > limit) {
                file.release()
                report(IllegalArgumentException("PDF는 50MiB, MP4는 500MiB까지 업로드할 수 있어요."))
            } else {
                uploading = true
                scope.launch {
                    try {
                        val material = api.upload(file.name, file.size, if (pdf) "application/pdf" else "video/mp4", lessonId, file.openChannel)
                        materials = listOf(material) + materials.filterNot { it.id == material.id }
                        contentTab = material.type
                    } catch (error: Exception) {
                        report(error)
                    } finally {
                        file.release()
                        uploading = false
                    }
                }
            }
        }
    }
    fun changeTextbook(action: suspend () -> Unit) {
        if (textbookBusy) return
        textbookBusy = true
        textbookError = null
        scope.launch {
            try { action() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { textbookError = error.message ?: "교재 요청을 처리하지 못했어요." }
            finally { textbookBusy = false }
        }
    }
    val tools: @Composable () -> Unit = {
        // Both tabs list only this lesson's subject (plus unclassified), so the heading sits above the tabs.
        subject?.let {
            Text(DesignContent.TextbookSubject.replace("{subject}", it.name), Modifier.fillMaxWidth().padding(bottom = Space.S4),
                style = MaterialTheme.typography.labelLarge.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f),
                fontWeight = DesignWeight.Bold, color = Palette.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val tabs = if (textbookEnabled) listOf("document" to DesignContent.TextbookTab, "media" to "미디어")
            else listOf("media" to "미디어", "document" to "문서")
        Row(Modifier.fillMaxWidth().padding(bottom = if (textbookTab) Space.S4 else Space.S16)) {
            tabs.forEach { (value, label) ->
                Column(Modifier.weight(1f).clickable(enabled = !textbookBusy && !uploading) { contentTab = value }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.height(Space.S44), contentAlignment = Alignment.Center) {
                        Text(label, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f),
                            color = if (contentTab == value) Palette.Primary else Palette.MeetingSecondary)
                    }
                    Box(Modifier.fillMaxWidth().height(Space.S2).background(if (contentTab == value) Palette.Primary else Palette.MeetingText))
                }
            }
        }
        DesignButton(
            if (uploading) "업로드 중…" else if (contentTab == "media") "미디어 파일 업로드" else if (textbookTab) DesignContent.TextbookAdd else "문서 파일 업로드",
            onClick = picker, modifier = Modifier.fillMaxWidth(), enabled = !uploading && !loading && !textbookBusy, secondary = true,
            textStyle = MaterialTheme.typography.labelLarge.copy(color = Palette.Primary),
            icon = { if (uploading) CircularProgressIndicator(Modifier.size(Space.S18), strokeWidth = Space.S2) else DesignIcon("plus", Modifier.size(Space.S20), Palette.Primary) },
        )
    }
    if (textbookTab) {
        Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = Space.S12, vertical = Space.S8),
            verticalArrangement = Arrangement.spacedBy(Space.S8)) {
            tools()
            textbookError?.let { Text(it, color = Palette.Danger, style = MaterialTheme.typography.bodySmall) }
            when {
                loading -> TextbookNotice("자료 목록을 불러오는 중이에요.")
                listFailed -> TextbookRetry(DesignContent.TextbookListError) { listAttempt++ }
                else -> TextbookPicker(api, shown, snapshot?.share, textbookBusy || uploading, textbookConnected, unclassifiedTag = subject != null,
                    onOpen = { material, page ->
                        changeTextbook {
                            realtime.send(ContractProtocol.Commands.DocumentOpen, DocumentOpenPayload(material.id, page))
                            onTextbookOpened()
                        }
                    },
                    onDelete = { material ->
                        changeTextbook {
                            api.deleteMaterial(material.id)
                            materials = materials.filterNot { it.id == material.id }
                        }
                    })
            }
        }
        return
    }

    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = Space.S24, vertical = Space.S16)) {
        item {
            tools()
            Text("내 파일", Modifier.padding(top = Space.S32, bottom = Space.S8), color = Palette.Muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = Type.Caption, lineHeight = Type.Caption * 1.5f))
        }
        when {
            loading -> item { Box(Modifier.fillMaxWidth().padding(Space.S24), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(Space.S28)) } }
            listFailed -> item { TextbookRetry("자료 목록을 불러오지 못했어요.") { listAttempt++ } }
            shown.isEmpty() -> item { TextbookNotice("업로드한 자료가 없어요.") }
        }
        items(if (loading || listFailed) emptyList() else shown, key = { it.id }) { material ->
            val active = snapshot?.share?.materialId == material.id
            Row(Modifier.fillMaxWidth().padding(vertical = Space.S8).heightIn(min = 76.dp)
                .border(Space.S1, if (active) Palette.PrimarySoft else Palette.MeetingText, RoundedCornerShape(Corner.R8))
                .background(if (active) Palette.Selection else Palette.White, RoundedCornerShape(Corner.R8)).padding(Space.S12),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.S12)) {
                Box(Modifier.size(42.dp, Space.S44).background(Palette.Selection, RoundedCornerShape(Corner.R7)), contentAlignment = Alignment.Center) { DesignIcon(if (material.type == "document") "file" else "video", Modifier.size(Space.S22), Palette.Primary) }
                Column(Modifier.weight(1f).clickable { scope.launch { try { realtime.send(ContractProtocol.Commands.ShareStart, ShareStartPayload(material.type, material.id)); onShared() } catch (error: Throwable) { report(error) } } }, verticalArrangement = Arrangement.spacedBy(Space.S4)) {
                    Text(material.name, style = MaterialTheme.typography.labelMedium.copy(fontSize = Type.Support, lineHeight = Type.Support * 1.5f), fontWeight = DesignWeight.SemiBold, color = Palette.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (subject != null && material.subject == null) SubjectUnclassifiedTag()
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
