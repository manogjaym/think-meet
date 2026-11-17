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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real OS windows run on the application's normal frame clock, without a Compose test rule. */
@RunWith(AndroidJUnit4::class)
class PictureInPictureSmokeTest {
    @get:Rule
    val permissions: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val device by lazy { UiDevice.getInstance(instrumentation) }
    private val packageName get() = instrumentation.targetContext.packageName
    private lateinit var activity: MainActivity
    private val output by lazy {
        File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?: File(instrumentation.targetContext.getExternalFilesDir(null), "pip").absolutePath).apply { mkdirs() }
    }

    @Test
    fun nativePipRetainsRoomAndDismissesOnlySelf() {
        val args = InstrumentationRegistry.getArguments()
        val code = requireNotNull(args.getString("lessonCode"))
        val id = requireNotNull(args.getString("lessonId"))
        val automation = Configurator.getInstance()
        val previousIdleTimeout = automation.waitForIdleTimeout
        automation.waitForIdleTimeout = 100
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity = it }
        val client = createHttpClient()
        val api = ThinkMeetApi(client, ServerConfig.ORIGIN)
        try {
            eventually("login screen or dashboard", 90_000) {
                visible(By.text("오늘도 함께 배우는 시간")) != null || device.findObjects(By.clazz("android.widget.EditText")).size >= 2
            }
            if (visible(By.text("오늘도 함께 배우는 시간")) == null) {
                val fields = device.findObjects(By.clazz("android.widget.EditText"))
                fields[0].text = args.getString("username") ?: "teacher1"
                fields[1].text = args.getString("password") ?: "test123"
                clickPageText("로그인")
            }
            eventually("authenticated dashboard", 90_000) { visible(By.text("오늘도 함께 배우는 시간")) != null }
            scenario.onActivity { AppLinks.receive("thinkmeet://join/$code") }
            eventually("lesson prejoin", 90_000) { visible(By.text("입장 전 준비해 볼까요?")) != null }
            clickPageText("수업 시작하기", "수업 참여하기")
            eventually("native room and companion video", 90_000) {
                visible(By.text("실시간 수업")) != null && visible(By.text("김민준")) != null
            }
            instrumentation.sendStatus(0, Bundle().apply { putString("stage", "joined-real-room") })
            val self = runBlocking { api.me() }.id
            val admission = runBlocking { api.lesson(id) }.attendance.filter { it.userId == self }
            assertTrue("A real admission must exist", admission.isNotEmpty())

            screenshot("01-native-meeting")

            // Accessibility ACTION_SET_TEXT updates the actual editor without a keyboard/test clock.
            clickDescription("채팅")
            eventually("chat editor") { visible(By.clazz("android.widget.EditText")) != null }
            checkNotNull(visible(By.clazz("android.widget.EditText"))).text = "PiP 복귀 후 유지할 초안"
            clickDescription("패널 닫기")
            // Start through the platform controller to keep OS lifecycle checks independent of toolbar scrolling.
            runBlocking(Dispatchers.Main) { checkNotNull(activity.pictureInPictureController).enter() }
            awaitCompactPip()
            screenshot("02-system-pip")
            assertEquals("PiP must not issue another admission", admission, runBlocking { api.lesson(id) }.attendance.filter { it.userId == self })

            clickSystemControl("expand_button")
            eventually("return from PiP") { !inPip() }
            eventually("restored meeting controls", 90_000) { visible(By.text("실시간 수업")) != null && visible(By.desc("수업에서 나가기")) != null }
            clickDescription("채팅")
            eventually("retained chat draft") { visible(By.text("PiP 복귀 후 유지할 초안")) != null }
            screenshot("03-restored-with-draft")

            // Home must work while a separate modal-sheet window is open as well.
            device.pressHome()
            awaitCompactPip()
            screenshot("04-home-auto-pip")
            assertEquals(admission, runBlocking { api.lesson(id) }.attendance.filter { it.userId == self })
            clickSystemControl("dismiss")
            eventually("system PiP dismissed") { !inPip() }
            eventually("owner personally disconnected", 90_000) {
                runBlocking { api.snapshot(id) }.participants.none { it.user.id == self && it.online }
            }
            assertEquals("Closing teacher PiP must not end the lesson", "LIVE", runBlocking { api.lesson(id) }.status)
            screenshot("05-dismissed-owner-only")
        } catch (error: Throwable) {
            runCatching { screenshot("99-pip-failure") }
            runCatching { device.dumpWindowHierarchy(File(output, "99-window.xml")) }
            throw error
        } finally {
            automation.waitForIdleTimeout = previousIdleTimeout
            client.close()
            scenario.close()
        }
    }

    private fun visible(selector: BySelector): UiObject2? = runCatching {
        device.findObjects(selector).firstOrNull { !it.visibleBounds.isEmpty }
    }.getOrNull()

    private fun clickDescription(description: String) {
        eventually("control $description") {
            visible(By.desc(description))?.let { it.click(); true } ?: false
        }
    }

    private fun clickPageText(vararg labels: String) {
        repeat(8) {
            val control = labels.firstNotNullOfOrNull { visible(By.text(it)) }
            if (control != null && control.isEnabled) { control.click(); return }
            device.swipe((device.displayWidth * .85f).toInt(), (device.displayHeight * .8f).toInt(),
                (device.displayWidth * .85f).toInt(), (device.displayHeight * .3f).toInt(), 25)
            SystemClock.sleep(150)
        }
        throw AssertionError("Cannot find page action ${labels.joinToString()}")
    }

    private fun inPip(): Boolean {
        var result = false
        instrumentation.runOnMainSync { result = !activity.isDestroyed && activity.isInPictureInPictureMode }
        return result
    }

    private fun pipBounds(): Rect {
        val accessible = visible(By.pkg(packageName))?.visibleBounds
        if (accessible != null && accessible.width() < device.displayWidth * .8f && accessible.height() < device.displayHeight * .8f) return accessible
        val bounds = Rect()
        instrumentation.runOnMainSync {
            if (!activity.isDestroyed) {
                val view = activity.window.decorView
                val origin = IntArray(2)
                view.getLocationOnScreen(origin)
                bounds.set(origin[0], origin[1], origin[0] + view.width, origin[1] + view.height)
            }
        }
        return bounds
    }

    private fun awaitCompactPip() {
        eventually("system PiP with compact native video") {
            if (!inPip()) return@eventually false
            val bounds = pipBounds()
            if (bounds.isEmpty || bounds.width() >= device.displayWidth * .8f || bounds.height() >= device.displayHeight * .8f) return@eventually false
            // Hidden retained Compose nodes may still exist; only visible OS accessibility bounds count.
            device.findObjects(By.desc("수업에서 나가기")).none { node ->
                val header = node.visibleBounds
                !header.isEmpty && Rect.intersects(header, bounds)
            }
        }
    }

    private fun clickSystemControl(id: String) {
        eventually("AOSP PiP control $id") {
            val button = visible(By.res("com.android.systemui", id))
            if (button != null) { button.click(); true }
            else {
                val bounds = pipBounds()
                if (!bounds.isEmpty) device.click(bounds.centerX(), bounds.centerY())
                false
            }
        }
    }

    private fun eventually(description: String, timeout: Long = 30_000, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + timeout
        do {
            if (condition()) return
            SystemClock.sleep(200)
        } while (SystemClock.uptimeMillis() < until)
        throw AssertionError("Timed out waiting for $description")
    }

    private fun screenshot(name: String) {
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val file = File(output, "$name.png")
        try { file.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
        instrumentation.sendStatus(0, Bundle().apply { putString("screenshot", file.absolutePath) })
    }
}
