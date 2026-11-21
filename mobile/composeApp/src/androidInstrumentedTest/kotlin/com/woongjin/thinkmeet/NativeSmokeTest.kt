package com.woongjin.thinkmeet

import com.woongjin.thinkmeet.config.ServerConfig

import android.Manifest
import android.graphics.Bitmap
import android.os.Bundle
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.woongjin.thinkmeet.data.MeetingSnapshot
import com.woongjin.thinkmeet.data.Stroke
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.AppLinks
import com.woongjin.thinkmeet.platform.createHttpClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** One real-server smoke flow. Text is entered through semantics without starting an IME. */
@RunWith(AndroidJUnit4::class)
class NativeSmokeTest {
    @get:Rule(order = 0)
    val permissions: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
    )

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun loginAndJoinRealLesson() {
        try { runSmoke() }
        catch (error: Throwable) { runCatching { screenshot("99-failure") }; throw error }
    }

    @Test
    fun teacherSharesTextbookAndAnnotates() {
        val arguments = InstrumentationRegistry.getArguments()
        val filename = arguments.getString("textbookName").orEmpty()
        assumeTrue("The textbook fixture was not supplied", filename.isNotEmpty())
        val lessonCode = requireNotNull(arguments.getString("lessonCode"))
        val lessonId = requireNotNull(arguments.getString("lessonId"))
        val tablet = arguments.getString("textbookTablet") == "true"
        val client = createHttpClient()
        val api = ThinkMeetApi(client, ServerConfig.ORIGIN)
        try {
            waitFor("login screen or restored dashboard") {
                exists(hasText("로그인")) || exists(hasText("내 수업"))
            }
            if (exists(hasText("로그인"))) {
                val fields = compose.onAllNodes(hasSetTextAction())
                fields[0].performTextReplacement(arguments.getString("username") ?: "teacher1")
                fields[1].performTextReplacement(arguments.getString("password") ?: "test123")
                compose.onNodeWithText("로그인").performClick()
            }
            waitFor("signed in as the teacher") { exists(hasText("내 수업")) }
            val teacher = runBlocking { withTimeout(15_000) { api.me() } }
            compose.runOnIdle { AppLinks.receive("thinkmeet://join/$lessonCode") }
            val join = hasText("화상미팅 입장") or hasText("지금 참여하기")
            waitFor("prejoin") { exists(join) }
            for (label in listOf("카메라 끄기", "마이크 끄기")) {
                val switch = hasContentDescription(label) and hasClickAction()
                if (exists(switch)) compose.onNode(switch).performClick()
            }
            compose.onNode(join).performScrollTo().performClick()
            waitFor("joined lesson screen") {
                exists(hasContentDescription("발표자 보기로 전환")) || exists(hasContentDescription("바둑판 보기로 전환"))
            }
            waitForSnapshot(api, lessonId) { it.participants.any { row -> row.user.id == teacher.id && row.online } }
            val classroom = hasText("수업방 모드") and hasClickAction()
            waitFor("classroom mode is ready") { exists(classroom and isEnabled()) }
            compose.onNode(classroom).performClick()
            dismissScreenCapturePrompt(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()))
            waitForSnapshot(api, lessonId) { it.instruction?.phase == "classroom" }

            val materials = hasContentDescription("수업 자료") and hasClickAction()
            waitFor("materials button") { exists(materials) }
            compose.onNode(materials).performClick()
            val grid = compose.onNodeWithTag("textbook-pages")
            waitFor("loaded textbook previews") { exists(hasTestTag("textbook-pages")) }
            compose.onNodeWithText(filename).assertIsDisplayed()
            grid.performScrollToIndex(2)
            compose.onNode(hasText("3쪽") and hasClickAction()).performClick().assertIsSelected()
            screenshot("textbook-picker")

            compose.onNodeWithText("3쪽 화면에 불러오기").assertIsEnabled().performClick()
            val shared = waitForSnapshot(api, lessonId) { it.share?.page == 3 && it.share.material?.name == filename }
            val shareId = checkNotNull(shared.share).id
            val existingStrokeIds = shared.strokes.map { it.id }.toSet()
            val pdf = hasContentDescription("$filename 3페이지")
            waitFor("native PDF page 3") { exists(pdf) }
            val panel = compose.onNodeWithText("교재 불러오기")
            if (tablet) panel.assertIsDisplayed() else panel.assertDoesNotExist()
            val stage = compose.onNodeWithContentDescription("수업 판서 영역")
            val pen = compose.onNodeWithText("판서 시작")
            check(pen.getUnclippedBoundsInRoot().top >= stage.getUnclippedBoundsInRoot().bottom)
            screenshot("textbook-shared")

            pen.performClick()
            stage.performTouchInput {
                swipe(Offset(width * .2f, height * .35f), Offset(width * .7f, height * .6f), 600)
            }
            val newTeacherStroke: (Stroke) -> Boolean = {
                it.id !in existingStrokeIds && it.shareId == shareId && it.authorId == teacher.id && it.page == 3 && !it.deleted
            }
            val drawn = waitForSnapshot(api, lessonId) { it.strokes.any(newTeacherStroke) }
            val stroke = drawn.strokes.first(newTeacherStroke)
            check(stroke.points.size >= 2 && stroke.points.all { it.x in 0.0..1.0 && it.y in 0.0..1.0 })
            val clear = hasContentDescription("전체 지우기") and hasClickAction()
            waitFor("teacher canvas updated after the stroke") { exists(clear and isEnabled()) }
            screenshot("textbook-annotation")

            compose.onNode(hasContentDescription("실행 취소") and hasClickAction()).performClick()
            waitFor("teacher canvas updated after undo") { exists(clear and isNotEnabled()) }
            compose.onNode(hasContentDescription("다시 실행") and hasClickAction()).performClick()
            waitFor("teacher canvas updated after redo") { exists(clear and isEnabled()) }
        } catch (error: Throwable) {
            runCatching { screenshot("textbook-failure") }
            throw error
        } finally {
            runBlocking { runCatching { withTimeout(10_000) { api.leave(lessonId) } } }
            client.close()
        }
    }

    private fun runSmoke() {
        val arguments = InstrumentationRegistry.getArguments()
        val lessonCode = arguments.getString("lessonCode")?.trim().orEmpty()

        waitFor("login screen or restored dashboard") {
            exists(hasText("로그인", substring = false)) || exists(hasText("오늘도 함께 배우는 시간"))
        }
        if (exists(hasText("로그인", substring = false))) {
            val fields = compose.onAllNodes(hasSetTextAction())
            fields[0].performTextReplacement(arguments.getString("username") ?: "teacher1")
            fields[1].performTextReplacement(arguments.getString("password") ?: "test123")
            compose.onNodeWithText("로그인").performScrollTo().performClick()
        }
        waitFor("authenticated dashboard") { exists(hasText("오늘도 함께 배우는 시간")) }
        compose.onNodeWithText("오늘도 함께 배우는 시간").assertIsDisplayed()
        screenshot("01-dashboard")

        // The tablet layout run stops here; the phone media run supplies the fixture code.
        if (lessonCode.isEmpty()) return
        require(Regex("[A-Za-z0-9_-]{1,100}").matches(lessonCode)) { "Invalid lessonCode argument" }
        compose.runOnIdle { AppLinks.receive("thinkmeet://join/$lessonCode") }
        waitFor("lesson prejoin") { exists(hasText("입장 전 장치 점검")) || exists(hasText("입장 준비")) }
        screenshot("02-prejoin")

        val join = hasText("화상미팅 입장") or hasText("수업 시작하기") or hasText("수업 참여하기")
        compose.onNode(join).performScrollTo().performClick()
        waitFor("native LiveKit and authenticated Socket.IO connection") { exists(hasText("실시간 수업", substring = false)) }
        compose.onNodeWithText("실시간 수업").assertIsDisplayed()
        val mirroring = hasText("미러링 모드") and hasClickAction()
        if (exists(mirroring)) {
            compose.onNodeWithText("수업 시작", substring = false).assertDoesNotExist()
            compose.onNodeWithContentDescription("화면 공유").assertDoesNotExist()
            waitFor("mirroring mode is ready") { exists(mirroring and isEnabled()) }
            compose.onNode(mirroring).performClick()
            waitFor("mirroring student dialog") { exists(hasText("공유를 요청할 학생 선택")) }
            compose.onNodeWithText("공유 요청").assertIsNotEnabled()
            compose.onNodeWithText("취소").performClick()
            compose.onNodeWithText("수업방 모드").performClick()
            dismissScreenCapturePrompt(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()))
        }
        screenshot("03-native-meeting")

        if (arguments.getString("mediaOnly") == "true") {
            waitFor("remote student in tablet gallery") { exists(hasText("김민준")) }
            // Let actual RTC statistics and the native renderer settle before the visual check.
            Thread.sleep(8_000)
            screenshot("03-tablet-remote-video")
            return
        }

        compose.onNode(hasContentDescription("채팅", substring = true) and hasClickAction()).performClick()
        waitFor("chat input") { exists(hasSetTextAction()) }
        val message = "모바일 앱 연결 확인"
        val previousCount = compose.onAllNodesWithText(message).fetchSemanticsNodes().size
        compose.onAllNodes(hasSetTextAction())[0].performTextReplacement(message)
        compose.onNodeWithContentDescription("메시지 보내기").performClick()
        waitFor("server-acknowledged chat message") {
            val draft = compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().first().config[SemanticsProperties.EditableText].text
            draft.isEmpty() && compose.onAllNodesWithText(message).fetchSemanticsNodes().size > previousCount
        }
        screenshot("04-chat-confirmed")
        compose.onNodeWithContentDescription("패널 닫기").performClick()
        compose.onNode(hasContentDescription("손들기") and hasClickAction()).performClick()
        // The gallery/people indicator only appears after the authoritative snapshot returns.
        compose.onNode(hasContentDescription("참여자") and hasClickAction()).performClick()
        waitFor("server-acknowledged raised hand") { exists(hasContentDescription("손듦")) }
        screenshot("05-hand-confirmed")
        compose.onNodeWithContentDescription("패널 닫기").performClick()
        exerciseNativePdf(
            requireNotNull(arguments.getString("lessonId")) { "lessonId fixture argument is required" },
            requireNotNull(arguments.getString("materialId")) { "materialId fixture argument is required" },
        )
    }

    /** A second real connection shares the fixture; page, drawing and history use the actual UI. */
    private fun exerciseNativePdf(lessonId: String, materialId: String) {
        val client = createHttpClient()
        val api = ThinkMeetApi(client, ServerConfig.ORIGIN)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val realtime = api.realtime(scope, lessonId)
        var shareId: String? = null
        try {
            val shared = runBlocking {
                withTimeout(30_000) { realtime.connected.first { it } }
                realtime.command("share.start", buildJsonObject { put("type", "document"); put("materialId", materialId) })
            }
            val share = checkNotNull(shared.share)
            shareId = share.id
            check((share.material?.pages ?: 0) >= 2) { "PDF fixture must contain at least two pages" }
            val filename = share.material?.name ?: "mobile-smoke.pdf"
            waitFor("native PdfRenderer first page") { exists(hasContentDescription("$filename 1페이지")) }
            screenshot("06-native-pdf-page1")

            compose.onNodeWithContentDescription("다음 페이지").performClick()
            waitForSnapshot(api, lessonId) { it.share?.id == shareId && it.share?.page == 2 }
            waitFor("native PdfRenderer second page") { exists(hasContentDescription("$filename 2페이지")) }
            screenshot("07-native-pdf-page2")

            val author = runBlocking { api.me() }.id
            val baseline = runBlocking { api.snapshot(lessonId) }.strokes.map { it.id }.toSet()
            compose.onNodeWithText("판서 시작").performClick()
            compose.onNodeWithContentDescription("수업 판서 영역").performTouchInput {
                swipe(
                    start = Offset(width * .2f, height * .35f),
                    end = Offset(width * .75f, height * .6f),
                    durationMillis = 600,
                )
            }
            val drawn = waitForSnapshot(api, lessonId) { snapshot ->
                snapshot.strokes.any { it.id !in baseline && it.shareId == shareId && it.page == 2 && it.authorId == author && !it.deleted }
            }
            val stroke = drawn.strokes.first { it.id !in baseline && it.shareId == shareId && it.page == 2 && it.authorId == author && !it.deleted }
            check(stroke.points.size >= 2 && stroke.points.all { it.x in 0.0..1.0 && it.y in 0.0..1.0 })
            screenshot("08-native-pdf-drawn")

            compose.onNodeWithContentDescription("내 판서 실행 취소").performScrollTo().performClick()
            waitForSnapshot(api, lessonId) { snapshot -> snapshot.strokes.any { it.id == stroke.id && it.deleted } }
            screenshot("09-native-pdf-undo")
            compose.onNodeWithContentDescription("내 판서 다시 실행").performScrollTo().performClick()
            waitForSnapshot(api, lessonId) { snapshot -> snapshot.strokes.any { it.id == stroke.id && !it.deleted } }
            screenshot("10-native-pdf-redo")
        } finally {
            runCatching { screenshot("11-material-final") }
            runBlocking {
                runCatching {
                    withTimeout(10_000) {
                        if (shareId != null && api.snapshot(lessonId).share?.id == shareId) realtime.command("share.stop")
                    }
                }
            }
            realtime.close()
            scope.cancel()
            client.close()
        }
    }

    private fun waitForSnapshot(api: ThinkMeetApi, lessonId: String, condition: (MeetingSnapshot) -> Boolean): MeetingSnapshot = runBlocking {
        withTimeout(90_000) {
            var snapshot = api.snapshot(lessonId)
            while (!condition(snapshot)) { delay(250); snapshot = api.snapshot(lessonId) }
            snapshot
        }
    }

    private fun exists(matcher: SemanticsMatcher): Boolean =
        compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    private fun waitFor(description: String, condition: () -> Boolean) {
        try {
            compose.waitUntil(timeoutMillis = 90_000) { runCatching(condition).getOrDefault(false) }
        } catch (error: ComposeTimeoutException) {
            throw AssertionError("Timed out waiting for $description", error)
        }
    }

    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?.let(::File) ?: File(instrumentation.targetContext.getExternalFilesDir(null), "smoke")
        val output = File(directory, "$name.png")
        output.parentFile!!.mkdirs()
        // UiAutomation also captures the native video renderer, which Compose-only captures omit.
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot()) { "Cannot capture $name" }
        try { output.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
        instrumentation.sendStatus(0, Bundle().apply { putString("screenshot", output.absolutePath) })
    }
}

internal fun dismissScreenCapturePrompt(device: UiDevice) {
    val dialog = device.wait(Until.findObject(By.pkg("com.android.systemui").res("android:id/button2")), 8_000)
    if (dialog != null) dialog.click()
    else if (device.currentPackageName == "com.android.systemui") device.pressBack()
    else error("Android screen capture prompt did not appear")
}
