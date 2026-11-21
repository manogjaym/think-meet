package com.woongjin.thinkmeet

import com.woongjin.thinkmeet.config.ServerConfig

import android.Manifest
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import com.woongjin.thinkmeet.data.ThinkMeetApi
import com.woongjin.thinkmeet.platform.AppLinks
import com.woongjin.thinkmeet.platform.createHttpClient
import com.woongjin.thinkmeet.platform.readPreference
import com.woongjin.thinkmeet.platform.writePreference
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.regex.Pattern

/** Real native windows and fonts, without the synthetic Compose test frame clock. */
@RunWith(AndroidJUnit4::class)
class DesignParityCaptureTest {
    @get:Rule
    val permissions: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device by lazy { UiDevice.getInstance(instrumentation) }
    private val arguments get() = InstrumentationRegistry.getArguments()
    private val label by lazy { (arguments.getString("captureLabel") ?: "phone").also { require(it.matches(Regex("[A-Za-z0-9_-]+"))) } }
    private val output by lazy {
        File(arguments.getString("additionalTestOutputDir")
            ?: File(instrumentation.targetContext.getExternalFilesDir(null), "design-parity").absolutePath).apply { mkdirs() }
    }

    @Test
    fun captureWebMatchedNativeScreens() {
        val automation = Configurator.getInstance()
        val previousIdleTimeout = automation.waitForIdleTimeout
        automation.waitForIdleTimeout = 100
        // MainActivity initializes protected preference/cookie storage before the test API uses it.
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val client = createHttpClient()
        val api = ThinkMeetApi(client, ServerConfig.ORIGIN)
        val originalCamera = readPreference("devices.camera", "true")
        val originalMicrophone = readPreference("devices.microphone", "false")
        val lessonCode = arguments.getString("lessonCode")?.takeIf { it.isNotBlank() }
        val lessonId = arguments.getString("lessonId")?.takeIf { it.isNotBlank() }
        var fixtureJoinAttempted = false
        try {
            stage("preparing-fresh-login")
            runBlocking { runCatching { withTimeout(15_000) { api.logout() } } }
            scenario.recreate()
            eventually("login editors", 90_000) { visibleEditors().size >= 2 }
            capture("01-login", By.text("우리 수업을 시작해 볼까요?"))
            val editors = visibleEditors()
            editors[0].text = arguments.getString("username") ?: "teacher1"
            editors[1].text = arguments.getString("password") ?: "test123"
            revealAndClick("로그인")
            val dashboardAnchor = By.text(if (arguments.getString("captureUntil") == "prejoin") "내 수업" else "수업 일정")
            eventually("authenticated dashboard", 90_000) { visible(dashboardAnchor) != null }
            capture("02-dashboard", dashboardAnchor)
            if (arguments.getString("captureUntil") == "dashboard") { stage("capture-complete"); return }
            if (arguments.getString("captureUntil") == "prejoin") {
                val code = requireNotNull(lessonCode)
                scenario.onActivity { AppLinks.receive("thinkmeet://join/$code") }
                eventually("device check title") { visible(By.text("입장 전 장치 점검")) != null }
                capture("06-prejoin", By.text("입장 전 장치 점검"))
                revealAndClick("소리 테스트")
                eventually("test tone ended") { visible(By.text("재생 완료")) != null }
                reveal("네트워크")
                eventually("server latency") { visible(By.text(Pattern.compile("[0-9]+ ms"))) != null }
                capture("07-device-status", By.text("재생 완료"))
                if (arguments.getString("username")?.startsWith("student") == true) {
                    revealAndClick("수업 시작 대기")
                    eventually("waiting for teacher") { visible(By.text("곧 수업이 시작돼요")) != null }
                    capture("08-waiting", By.text("곧 수업이 시작돼요"))
                    revealAndClick("장치 다시 점검하기")
                    eventually("returned to device checks") { visible(By.text("입장 전 장치 점검")) != null }
                } else {
                    revealSelector(By.text("학생 대기 상태"))
                    capture("08-teacher-presence", By.text("학생 대기 상태"))
                }
                stage("capture-complete")
                return
            }
            val self = runBlocking { api.me() }.id

            stage("opening-history")
            revealAndClick("지난 수업")
            val firstPast = runBlocking { api.lessons() }
                .filter { it.status in listOf("ENDED", "CANCELLED") }.maxByOrNull { it.startsAt }
            if (firstPast != null) {
                // Locate a visible row, then verify its complete title after opening the detail.
                val title = By.textStartsWith(firstPast.title.take(10))
                revealSelector(title)
                capture("03-history", title)
                revealSelector(title).click()
                eventually("lesson detail") { visible(By.text("수업 상세")) != null }
                eventually("expected lesson detail") { visible(By.text(firstPast.title)) != null }
                capture("04-detail", By.text("수업 상세"))
                clickDescription("이전 화면으로 돌아가기")
                eventually("dashboard navigation") { visible(By.text("수업 상세")) == null && visible(By.text("내 수업")) != null }
            } else {
                capture("03-history", By.text("지난 수업"))
                stage("detail-not-captured-no-past-lessons")
            }

            stage("opening-booking-form")
            revealAndClick("수업 예약")
            eventually("booking form") { visible(By.text("수업 정보")) != null }
            capture("05-form", By.text("수업 정보"))
            if (arguments.getString("captureUntil") == "form") { stage("capture-complete"); return }
            // Only inspect the form; no reservation or existing lesson is changed.
            revealAndClick("내 수업")

            if (lessonCode != null && lessonId != null) {
                stage("opening-fixture-prejoin")
                require(lessonCode.matches(Regex("[A-Za-z0-9_-]{1,100}")))
                scenario.onActivity { AppLinks.receive("thinkmeet://join/$lessonCode") }
                eventually("fixture prejoin", 90_000) {
                    (visible(By.text("입장 준비")) != null || visible(By.text("입장 전 장치 점검")) != null) &&
                        (visible(By.desc("카메라 끄기")) != null || visible(By.text("카메라가 꺼져 있습니다")) != null)
                }
                visible(By.desc("카메라 끄기"))?.click()
                visible(By.desc("마이크 끄기"))?.click()
                eventually("neutral camera-off preview") { visible(By.text("카메라가 꺼져 있습니다")) != null }
                capture("06-prejoin", By.text("카메라가 꺼져 있습니다"))
                val join = reveal("화상미팅 입장", "수업 시작하기", "지금 참여하기", "수업 참여하기")
                capture("07-prejoin-ready", By.text(join.text ?: "수업 시작하기"))
                fixtureJoinAttempted = true
                join.click()
                eventually("connected native lesson", 90_000) {
                    val meeting = visible(By.desc("발표자 보기로 전환")) != null || visible(By.desc("바둑판 보기로 전환")) != null
                    meeting && runBlocking { api.snapshot(lessonId) }.participants.any { it.user.id == self && it.online }
                }
                if (visible(By.text("수업 시작")) != null) {
                    capture("08-meeting-preparing", By.text("수업 시작"))
                    reveal("수업 시작").click()
                    eventually("classroom mode") { visible(By.text("수업방 모드")) != null }
                }
                capture("08-meeting", By.desc("카메라 켜기"))
                clickDescription("채팅")
                capture("09-chat", By.text("수업 채팅"))
                clickDescription("패널 닫기")
                clickDescription("수업 자료")
                capture("10-materials", By.text("콘텐츠 공유"))
                clickDescription("패널 닫기")
            } else stage("prejoin-meeting-not-captured-no-fixture-arguments")
            stage("capture-complete")
        } catch (error: Throwable) {
            runCatching { screenshot("99-failure") }
            runCatching { device.dumpWindowHierarchy(File(output, "$label-99-window.xml")) }
            throw error
        } finally {
            // A teacher leaves personally; ending a class belongs to the external fixture owner.
            if (fixtureJoinAttempted && lessonId != null) runCatching { runBlocking { withTimeout(15_000) { api.leave(lessonId) } } }
            writePreference("devices.camera", originalCamera)
            writePreference("devices.microphone", originalMicrophone)
            client.close()
            scenario.close()
            automation.waitForIdleTimeout = previousIdleTimeout
        }
    }

    private fun visible(selector: BySelector): UiObject2? = runCatching {
        device.findObjects(selector).firstOrNull { !it.visibleBounds.isEmpty }
    }.getOrNull()

    private fun visibleEditors(): List<UiObject2> = device.findObjects(By.clazz("android.widget.EditText"))
        .filter { !it.visibleBounds.isEmpty }.sortedBy { it.visibleBounds.top }

    private fun clickDescription(description: String) {
        eventually("control $description") { visible(By.desc(description))?.let { it.click(); true } ?: false }
    }

    /** Scroll the page content, not toolbars; root navigation stays visible on both form factors. */
    private fun reveal(vararg texts: String): UiObject2 {
        repeat(12) {
            texts.firstNotNullOfOrNull { text -> visible(By.text(text)) }?.let { if (it.isEnabled) return it }
            device.swipe((device.displayWidth * .9f).toInt(), (device.displayHeight * .78f).toInt(),
                (device.displayWidth * .9f).toInt(), (device.displayHeight * .34f).toInt(), 30)
            SystemClock.sleep(200)
        }
        throw AssertionError("Cannot reveal ${texts.joinToString()}")
    }

    private fun revealAndClick(vararg texts: String) { reveal(*texts).click() }

    private fun revealSelector(selector: BySelector): UiObject2 {
        visible(selector)?.let { return it }
        // Restore the schedule position first; fast swipes can fling past the first row
        // on a busy emulator, and a recycled LazyColumn does not expose offscreen text.
        for (attempt in 0 until 12) {
            if (visible(By.text("수업 일정")) != null) break
            device.swipe((device.displayWidth * .9f).toInt(), (device.displayHeight * .35f).toInt(),
                (device.displayWidth * .9f).toInt(), (device.displayHeight * .7f).toInt(), 120)
            SystemClock.sleep(350)
        }
        repeat(32) {
            visible(selector)?.let { return it }
            device.swipe((device.displayWidth * .9f).toInt(), (device.displayHeight * .7f).toInt(),
                (device.displayWidth * .9f).toInt(), (device.displayHeight * .6f).toInt(), 120)
            SystemClock.sleep(350)
        }
        throw AssertionError("Cannot reveal lesson row")
    }

    private fun capture(name: String, anchor: BySelector) {
        stage("capturing-$name")
        // Bundled fonts load locally. Wait for the actual measured text bounds to settle.
        var last: Rect? = null
        var unchangedSince = SystemClock.uptimeMillis()
        eventually("stable native layout for $name", 15_000) {
            val bounds = visible(anchor)?.visibleBounds ?: return@eventually false
            if (bounds != last) { last = Rect(bounds); unchangedSince = SystemClock.uptimeMillis(); false }
            else SystemClock.uptimeMillis() - unchangedSince >= 600
        }
        instrumentation.waitForIdleSync()
        screenshot(name)
    }

    private fun eventually(description: String, timeout: Long = 30_000, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + timeout
        do {
            if (runCatching(condition).getOrDefault(false)) return
            SystemClock.sleep(200)
        } while (SystemClock.uptimeMillis() < until)
        throw AssertionError("Timed out waiting for $description")
    }

    private fun stage(value: String) = instrumentation.sendStatus(0, Bundle().apply { putString("stage", "$label:$value") })

    private fun screenshot(name: String) {
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot()) { "Cannot capture $name" }
        val file = File(output, "$label-$name.png")
        try { file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
        device.dumpWindowHierarchy(File(output, "$label-$name.xml"))
        instrumentation.sendStatus(0, Bundle().apply {
            putString("screenshot", file.absolutePath)
            putInt("densityDpi", instrumentation.targetContext.resources.configuration.densityDpi)
        })
    }
}
