package com.woongjin.thinkmeet

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.config.ServerConfig
import com.woongjin.thinkmeet.design.*
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens.Colors as Palette
import com.woongjin.thinkmeet.design.generated.DesignTokens.Component as Component
import com.woongjin.thinkmeet.design.generated.DesignTokens.Layout as LayoutToken
import com.woongjin.thinkmeet.design.generated.DesignTokens.Typography as Type
import com.woongjin.thinkmeet.design.generated.DesignTokens.LineHeight as Leading
import com.woongjin.thinkmeet.meeting.MeetingScreen
import com.woongjin.thinkmeet.platform.*
import com.woongjin.thinkmeet.ui.*

@Composable
fun App() {
    ThinkMeetTheme {
        val client = remember { createHttpClient() }
        val api = remember { ThinkMeetApi(client, ServerConfig.ORIGIN) }
        val scope = rememberCoroutineScope()
        val controller = remember(api) { AppState(api, scope) }
        val state = controller.state.collectAsState().value
        val capabilities = api.capabilities.collectAsState().value
        val prejoinEnabled = capabilities.supports("classroom.prejoin")
        val user = state.user
        val attendanceEnabled = user?.isTeacher == true && capabilities.supports("classroom.attendance")
        val openStudents = (controller::attendanceStudents).takeIf { attendanceEnabled }
        val route = state.route
        val inMeeting = route is Route.Meeting
        val pendingLink = AppLinks.code.collectAsState().value
        val snackbar = remember { SnackbarHostState() }
        val savedScreens = rememberSaveableStateHolder()
        ConfigureSystemAppearance(inMeeting && user != null)
        DisposableEffect(controller) { onDispose { controller.close(); client.close() } }
        LaunchedEffect(pendingLink, user, state.busy, inMeeting) {
            if (pendingLink != null && user != null && !state.busy && !inMeeting) {
                controller.joinCode(pendingLink); AppLinks.consume()
            }
        }
        LaunchedEffect(state.error) {
            if (state.error != null && user != null) snackbar.showSnackbar(state.error, actionLabel = "닫기", withDismissAction = true)
        }
        BackHandler(user != null && route != Route.Home && !inMeeting) {
            when {
                route is Route.Prejoin || route is Route.Edit -> controller.detail()
                route is Route.Attendance && openStudents != null -> openStudents()
                else -> controller.home()
            }
        }
        Surface(Modifier.fillMaxSize(), color = Canvas) {
            when {
                state.loading -> Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        BrandMark(); CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
                        Text("수업을 준비하고 있어요", color = Muted)
                    }
                }
                user == null -> LoginScreen(state.busy, state.error, controller::login)
                route is Route.Meeting ->
                    MeetingScreen(api, route.lesson, user, route.admission, state.camera, state.microphone, controller::meetingExit)
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val mobile = maxWidth <= LayoutToken.RootNavigationMobile
                    val compact = maxWidth <= LayoutToken.RootHeaderCompact
                    val rootRoute = route == Route.Home || route == Route.Create || (route == Route.Students && attendanceEnabled)
                    val rootTabs = rootRoute && mobile && user.isTeacher
                    Scaffold(containerColor = Canvas, contentWindowInsets = WindowInsets(0, 0, 0, 0),
                        snackbarHost = { SnackbarHost(snackbar) },
                        topBar = {
                            if (route is Route.Attendance && openStudents != null) AttendanceHeader(route.student.name, mobile, openStudents)
                            else AppHeader(state, mobile, compact, maxWidth, controller::home, controller::form, controller::logout, controller::detail, openStudents, prejoinEnabled)
                        },
                        bottomBar = { if (rootTabs) RootNavigation(route, true, controller::home, controller::form, openStudents) },
                    ) { padding ->
                        Box(Modifier.fillMaxSize().padding(padding).then(if (rootTabs) Modifier else Modifier.navigationBarsPadding())) {
                            when (route) {
                                Route.Home -> savedScreens.SaveableStateProvider("home:${user.id}") { HomeScreen(state, controller) }
                                Route.Students -> if (attendanceEnabled) key(user.id) { AttendanceStudentsScreen(api, controller::studentAttendance) }
                                    else PageColumn { ErrorCard(DesignContent.AttendanceUnavailable) }
                                is Route.Attendance -> if (attendanceEnabled) key(user.id, route.student.id) { StudentAttendanceScreen(api, route.student.id) }
                                    else PageColumn { ErrorCard(DesignContent.AttendanceUnavailable) }
                                Route.Create -> LessonForm(state, controller, existing = null)
                                is Route.Edit -> LessonForm(state, controller, existing = route.lesson)
                                is Route.Detail -> LessonDetail(route.lesson, state, controller, api.origin)
                                is Route.Created -> CreatedLesson(route.lesson, controller, api.origin)
                                is Route.Prejoin -> PrejoinScreen(route.lesson, user, state, controller)
                                is Route.Waiting -> WaitingScreen(route.lesson, user, state, controller)
                                is Route.Ended -> EndedScreen(route.lesson, user, state, controller)
                                is Route.Meeting -> Unit
                            }
                            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
                        }
                    }
                }
            }
        }
    }
}

/** Canonical book/wordmark, without a native-only icon tile or extra tagline. */
@Composable
fun BrandMark(compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BrandSymbol(Modifier.size(28.dp))
        if (!compact) Text(DesignContent.BrandName, fontSize = 22.sp, lineHeight = 33.sp, letterSpacing = (-.03).em, fontWeight = DesignWeight.Bold, color = Ink)
    }
}

@Composable
private fun AppHeader(state: AppUiState, mobile: Boolean, compact: Boolean, width: androidx.compose.ui.unit.Dp,
    home: () -> Unit, form: () -> Unit, logout: () -> Unit, detail: () -> Unit, students: (() -> Unit)?,
    prejoinEnabled: Boolean,
) {
    val route = state.route
    val rootRoute = route == Route.Home || route == Route.Create || (route == Route.Students && students != null)
    val height = if (if (rootRoute) compact else mobile) LayoutToken.RootHeaderCompactHeight else LayoutToken.RootHeaderHeight
    Surface(color = Palette.White) {
        Column(Modifier.statusBarsPadding()) {
            if (rootRoute) {
                val gutter = when { compact -> 20.dp; width <= LayoutToken.DashboardFeatureWide -> 24.dp; width <= LayoutToken.DashboardIntermediate -> 28.dp; else -> 36.dp }
                Row(Modifier.fillMaxWidth().height(height).padding(horizontal = gutter), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.clickable(onClick = home).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BrandSymbol(Modifier.size(28.dp))
                        Text(DesignContent.BrandName, fontSize = if (mobile) 21.sp else 22.sp, lineHeight = 33.sp, letterSpacing = (-.03).em, fontWeight = DesignWeight.Bold)
                        if (width > LayoutToken.DashboardFeatureWide) {
                            VerticalDivider(Modifier.padding(start = 3.dp).height(20.dp), color = Palette.Line)
                            Text(DesignContent.BrandProduct, Modifier.padding(start = 3.dp), color = Muted, fontSize = Type.Support, lineHeight = 22.5.sp)
                        }
                    }
                    if (!mobile) {
                        val gap = when { width <= LayoutToken.DashboardFeatureWide -> 24.dp; width <= LayoutToken.DashboardIntermediate -> 32.dp; else -> 48.dp }
                        Spacer(Modifier.width(gap))
                        RootNavigation(route, false, home, form, students, state.user!!.isTeacher)
                    }
                    Spacer(Modifier.weight(1f))
                    AccountMenu(state, width <= LayoutToken.HeaderProfileCompact, logout)
                }
            } else {
                val backToDetail = route is Route.Prejoin || route is Route.Edit
                val canBack = backToDetail || route is Route.Detail
                val title = when (route) {
                    Route.Students -> DesignContent.AttendanceStudents
                    is Route.Attendance -> DesignContent.AttendanceTitle
                    is Route.Detail -> "수업 상세"
                    is Route.Prejoin -> if (prejoinEnabled) DesignContent.PrejoinTitle else "입장 준비"
                    is Route.Edit -> "수업 일정 수정"
                    is Route.Waiting -> "입장 대기"
                    is Route.Created -> "예약 완료"
                    is Route.Ended -> "수업 종료"
                    else -> "안내"
                }
                Row(Modifier.fillMaxWidth().height(height).padding(horizontal = if (mobile) 8.dp else 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (canBack) IconButton(onClick = if (backToDetail) detail else home) { DesignIcon("back", Modifier.size(24.dp), Palette.TextSecondary, "이전 화면으로 돌아가기") }
                    Text(title, Modifier.weight(1f).padding(horizontal = 8.dp), fontSize = if (mobile) 18.sp else Type.Heading, lineHeight = if (mobile) 27.sp else Leading.Heading, fontWeight = DesignWeight.SemiBold)
                    if (!canBack) IconButton(onClick = home) { DesignIcon("close", Modifier.size(23.dp), Palette.TextSecondary, "닫고 내 수업으로 이동") }
                }
            }
            HorizontalDivider(color = Palette.Line, thickness = 1.dp)
        }
    }
}

@Composable
private fun RootNavigation(route: Route, mobile: Boolean, home: () -> Unit, form: () -> Unit, students: (() -> Unit)?, teacher: Boolean = true) {
    val tabs: @Composable RowScope.() -> Unit = {
        val destinations = buildList {
            add(Triple(DesignContent.RootHomeTab, "calendar", home) to Route.Home)
            if (teacher) add(Triple(DesignContent.RootBookingTab, "plus", form) to Route.Create)
            if (students != null) add(Triple(DesignContent.AttendanceStudents, "users", students) to Route.Students)
        }
        destinations.forEach { (tab, destination) ->
            val (label, icon, action) = tab
            val selected = route == destination
            val color = if (selected) Brand else Muted
            if (mobile) Column(Modifier.weight(1f).fillMaxHeight().clickable(onClick = action).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                DesignIcon(icon, Modifier.size(22.dp), color)
                Spacer(Modifier.height(3.dp))
                Text(label, fontSize = Type.Caption, lineHeight = 19.5.sp, color = color, fontWeight = if (selected) DesignWeight.SemiBold else DesignWeight.Medium)
            } else {
                TextButton(action, shape = RoundedCornerShape(7.dp), colors = ButtonDefaults.textButtonColors(contentColor = if (selected) Palette.BrandDark else Muted),
                    modifier = Modifier.heightIn(min = 44.dp).background(if (selected) Palette.Selection else Palette.White, RoundedCornerShape(7.dp)), contentPadding = PaddingValues(horizontal = 16.dp)) {
                    Text(label, fontSize = Type.Label, lineHeight = 24.sp, fontWeight = DesignWeight.SemiBold)
                }
            }
        }
    }
    if (mobile) Surface(color = Palette.White) {
        Column { HorizontalDivider(color = Palette.Line); Row(Modifier.fillMaxWidth().navigationBarsPadding().height(LayoutToken.RootBottomNavigationHeight).padding(horizontal = 12.dp), content = tabs) }
    } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = tabs)
}

@Composable
private fun AccountMenu(state: AppUiState, mobile: Boolean, logout: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.heightIn(min = 48.dp).semantics { contentDescription = "계정 메뉴" }.clickable { expanded = !expanded }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            DesignAvatar(state.user!!.name, state.user.id, size = 30.dp)
            if (!mobile) {
                Text("${state.user.name} ${if (state.user.isTeacher) "선생님" else "학생"}", fontSize = Type.Support, lineHeight = 22.5.sp, color = Palette.TextSecondary)
                DesignIcon("chevron", Modifier.size(16.dp).rotate(90f), Muted)
            }
        }
        DropdownMenu(expanded, { expanded = false }, modifier = Modifier.width(264.dp), shape = RoundedCornerShape(12.dp), containerColor = Palette.White, border = BorderStroke(1.dp, Palette.Line), tonalElevation = 0.dp) {
            Text(state.user!!.username, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), fontSize = Type.Caption, lineHeight = 19.5.sp, color = Muted)
            DropdownMenuItem(text = { Text("로그아웃") }, onClick = { expanded = false; logout() }, enabled = !state.busy)
        }
    }
}

@Composable
private fun LoginScreen(busy: Boolean, error: String?, login: (String, String) -> Unit) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    fun submit() { if (!busy && username.isNotBlank() && password.isNotEmpty()) login(username, password) }
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        val phone = maxWidth <= LayoutToken.LoginPhoneBreakpoint
        val reservedHeader = if (maxWidth <= LayoutToken.RootNavigationMobile) LayoutToken.RootHeaderCompactHeight else LayoutToken.RootHeaderHeight
        Box(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = (maxHeight - reservedHeader).coerceAtLeast(0.dp)).padding(horizontal = if (phone) 18.dp else 24.dp, vertical = if (phone) 28.dp else 40.dp), contentAlignment = Alignment.Center) {
            Surface(Modifier.widthIn(max = LayoutToken.LoginCardMaxWidth).fillMaxWidth(), shape = RoundedCornerShape(Component.StatusCardRadius), color = Palette.White, border = BorderStroke(1.dp, Palette.Line)) {
                Column(Modifier.padding(horizontal = if (phone) Component.LoginPhoneCardPadding else Component.LoginCardPadding, vertical = if (phone) 28.dp else Component.LoginCardPadding)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BrandSymbol(Modifier.size(Component.LoginBrandSize), Ink)
                        Text(DesignContent.LoginBrand, fontSize = Type.Body, lineHeight = 25.5.sp, fontWeight = DesignWeight.SemiBold)
                    }
                    Spacer(Modifier.height(32.dp))
                    Text(DesignContent.LoginTitle, fontSize = Type.LoginHeading, lineHeight = Leading.LoginHeading, letterSpacing = (-.02).em, fontWeight = DesignWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    Text(DesignContent.LoginDescription, style = MaterialTheme.typography.bodyLarge, color = Muted)
                    Spacer(Modifier.height(28.dp))
                    DesignTextField(username, { username = it }, Modifier.fillMaxWidth(), label = "아이디", enabled = !busy, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                    Spacer(Modifier.height(20.dp))
                    DesignTextField(password, { password = it }, Modifier.fillMaxWidth(), label = "비밀번호", enabled = !busy, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }))
                    Spacer(Modifier.height(20.dp))
                    if (error != null) { ErrorCard(error); Spacer(Modifier.height(12.dp)) }
                    DesignButton(if (busy) "로그인 중…" else "로그인", { submit() }, Modifier.fillMaxWidth(), enabled = !busy && username.isNotBlank() && password.isNotEmpty())
                    Spacer(Modifier.height(10.dp))
                    Text(DesignContent.LoginHelp, color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                }
            }
        }
    }
}

@Composable
fun ErrorCard(message: String) {
    Surface(color = Palette.ServiceErrorBackground, shape = RoundedCornerShape(8.dp)) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            DesignIcon("alert", Modifier.size(17.dp), Palette.ServiceErrorText)
            Text(message, color = Palette.ServiceErrorText, fontSize = 14.sp, lineHeight = 21.sp)
        }
    }
}
