package com.woongjin.thinkmeet

import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Rational
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.woongjin.thinkmeet.data.AssistanceGeometry
import com.woongjin.thinkmeet.data.AssistancePointer
import com.woongjin.thinkmeet.data.Point
import com.woongjin.thinkmeet.design.ThinkMeetTheme
import com.woongjin.thinkmeet.design.generated.DesignTokens
import com.woongjin.thinkmeet.platform.AndroidRemoteAssistanceController
import com.woongjin.thinkmeet.platform.RemoteAssistanceState
import com.woongjin.thinkmeet.platform.RemoteStroke
import com.woongjin.thinkmeet.platform.StudentAnnotationInput
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** Actual OS overlay/touch/PiP, with test-only geometry injection; no live lesson or capture claim. */
@RunWith(AndroidJUnit4::class)
class RemoteAssistanceOverlayTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val device by lazy { UiDevice.getInstance(instrumentation) }

    @Test
    fun continuousPacketsKeepOneOverlayAtTheRequestedPositionWithAnOffsetOrigin() = withOverlayPermission {
        val windows = context.getSystemService(WindowManager::class.java)
        // Exercise OEM-style window origins on the real compositor, independent of this AVD's insets.
        val shiftedWindows = object : WindowManager by windows {
            private fun shifted(params: ViewGroup.LayoutParams) = WindowManager.LayoutParams().apply {
                copyFrom(params as WindowManager.LayoutParams); x += 80; y += 96
            }
            override fun addView(view: View, params: ViewGroup.LayoutParams) = windows.addView(view, shifted(params))
            override fun updateViewLayout(view: View, params: ViewGroup.LayoutParams) = windows.updateViewLayout(view, shifted(params))
        }
        val shiftedContext = object : ContextWrapper(context) {
            override fun getSystemService(name: String): Any? =
                if (name == Context.WINDOW_SERVICE) shiftedWindows else super.getSystemService(name)
        }
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val controller = AndroidRemoteAssistanceController(shiftedContext, null)
        val x = device.displayWidth / 2; val y = device.displayHeight / 2
        val target = AtomicInteger(x)
        val handler = Handler(Looper.getMainLooper())
        val sender = object : Runnable {
            override fun run() {
                controller.showPointer(pointer(target.get(), y))
                handler.postDelayed(this, 250)
            }
        }
        try {
            renderFixture(scenario, "연속 포인터 위치 검증")
            assertTrue(device.wait(Until.hasObject(By.text("연속 포인터 위치 검증")), 15_000))
            setGeometry(controller)
            instrumentation.runOnMainSync { sender.run() }
            val field = controller.javaClass.getDeclaredField("overlay").apply { isAccessible = true }
            // The pointer is drawn inside one full-display window; check the composited pixels at the target.
            fun awaitPosition(targetX: Int): Boolean {
                val deadline = SystemClock.uptimeMillis() + 5_000
                do {
                    var attached = false
                    instrumentation.runOnMainSync { attached = (field.get(controller) as? View)?.isAttachedToWindow == true }
                    if (attached && isRedAt(targetX, y)) return true
                    SystemClock.sleep(25)
                } while (SystemClock.uptimeMillis() < deadline)
                return false
            }
            val positioned = awaitPosition(x)
            assertTrue("Initial position: ${controller.state.value}", positioned)
            val marker = field.get(controller)
            repeat(12) { index ->
                val targetX = x + if (index < 8) 0 else (index - 7) * 12
                target.set(targetX)
                show(controller, pointer(targetX, y))
                SystemClock.sleep(60)
                assertSame("Continuous updates must reuse the overlay", marker, field.get(controller))
                assertTrue("Packet $index must stay at the requested position", awaitPosition(targetX))
                SystemClock.sleep(140)
            }
            assertTrue("The continuously refreshed window must actually be drawn", isRedAt(x + 48, y))
            instrumentation.runOnMainSync { handler.removeCallbacks(sender) }
            SystemClock.sleep(1_600)
            instrumentation.runOnMainSync { assertNull("Packets stopped without strokes: the window must be removed", field.get(controller)) }
        } finally {
            instrumentation.runOnMainSync { handler.removeCallbacks(sender); controller.close() }
            scenario.close()
        }
    }

    @Test
    fun otherAppReceivesTouchesUnderPointerWhilePipRemainsVisibleThenPointerExpires() = withOverlayPermission {
        assumeTrue(context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val controller = AndroidRemoteAssistanceController(context, null)
        try {
            renderFixture(scenario, "원격 화면 안내 OS 검증")
            assertTrue(device.wait(Until.hasObject(By.text("원격 화면 안내 OS 검증")), 15_000))
            var entered = false
            scenario.onActivity { activity -> entered = activity.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
            assertTrue("The existing device must permit real system PiP", entered)
            val targetPackage = instrumentation.context.packageName
            assertTrue("Touch-through must be tested across different app UIDs",
                context.applicationInfo.uid != instrumentation.context.applicationInfo.uid)
            // SettingsHomepageActivity deliberately hides SAW windows. Use an ordinary separate app
            // without modifying that protection or any user's installed application's settings.
            context.startActivity(Intent().setComponent(ComponentName(targetPackage, "com.woongjin.thinkmeet.RemoteAssistanceTouchActivity"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val row = device.wait(Until.findObject(By.text("터치 확인 0")), 15_000)
                ?: error("Cannot open the separate-UID touch target fixture.")
            val target = row.visibleBounds
            val x = target.centerX(); val y = target.centerY()
            setGeometry(controller)
            // A teacher stroke crosses the same row, so the pointer and strokes overlap on the touched point.
            val strokeY = y + target.height() / 4
            val stroke = RemoteStroke("pen", "#4386d8", listOf(
                Point((target.left + 8).toDouble() / (device.displayWidth - 1), strokeY.toDouble() / (device.displayHeight - 1)),
                Point((target.right - 8).toDouble() / (device.displayWidth - 1), strokeY.toDouble() / (device.displayHeight - 1))))
            instrumentation.runOnMainSync { controller.showAnnotations(listOf(stroke)) }
            show(controller, pointer(x, y))
            assertTrue("A real application-overlay mark must appear over another app", awaitRedAt(x, y, expected = true))
            assertTrue("The teacher's stroke must be drawn over another app", isBlueAt(target.left + target.width() / 4, strokeY))
            screenshot("other-app-pointer-pip")
            show(controller, pointer(x, y))
            assertTrue(device.click(x, y))
            assertTrue("FLAG_NOT_TOUCHABLE must leave the other UID's app interactive", device.wait(Until.hasObject(By.text("터치 확인 1")), 10_000))
            SystemClock.sleep(1_600)
            assertFalse("The OS overlay expires without another pointer packet", isRedAt(x, y))
            assertTrue("Strokes stay after the pointer expires", isBlueAt(target.left + target.width() / 4, strokeY))
            assertTrue(device.click(x, strokeY))
            assertTrue("The stroke window must leave the other UID's app interactive", device.wait(Until.hasObject(By.text("터치 확인 2")), 10_000))
            screenshot("other-app-pointer-expired")
            instrumentation.runOnMainSync { controller.showAnnotations(emptyList()) }
            assertTrue("Clearing strokes removes them", (0 until 10).any { SystemClock.sleep(50); !isBlueAt(target.left + target.width() / 4, strokeY) })
        } catch (error: Throwable) {
            runCatching { screenshot("failure-other-app-pointer") }
            throw error
        } finally {
            instrumentation.runOnMainSync { controller.close() }
            device.pressBack()
            scenario.close()
        }
    }

    @Test
    fun allowedStudentDrawsOverAnotherAppAndReleasingThePenPassesTouches() = withOverlayPermission {
        assumeTrue(context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val controller = AndroidRemoteAssistanceController(context, null)
        val inputs = java.util.concurrent.CopyOnWriteArrayList<StudentAnnotationInput>()
        val collector = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default).launch { controller.studentInput.collect { inputs += it } }
        try {
            renderFixture(scenario, "학생 판서 OS 검증")
            assertTrue(device.wait(Until.hasObject(By.text("학생 판서 OS 검증")), 15_000))
            scenario.onActivity { activity ->
                controller.toolbarHost = activity
                activity.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
            }
            context.startActivity(Intent().setComponent(ComponentName(instrumentation.context.packageName, "com.woongjin.thinkmeet.RemoteAssistanceTouchActivity"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val target = (device.wait(Until.findObject(By.text("터치 확인 0")), 15_000) ?: error("Cannot open the touch target fixture.")).visibleBounds
            setGeometry(controller)
            instrumentation.runOnMainSync { controller.setStudentAnnotation(true) }
            assertTrue("The toolbar must appear over another app", device.wait(Until.hasObject(By.desc("펜")), 10_000))
            // The selected pen takes touches: a drag above the button becomes the student's stroke, not a tap.
            val y = target.top - target.height() * 2
            assertTrue(device.swipe(device.displayWidth / 5, y, device.displayWidth * 4 / 5, y, 20))
            val deadline = SystemClock.uptimeMillis() + 5_000
            while (inputs.none { it is StudentAnnotationInput.Stroke } && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(50)
            val stroke = inputs.filterIsInstance<StudentAnnotationInput.Stroke>().single()
            assertEquals("#4386d8", stroke.color)
            assertTrue("A drag must send several points", stroke.points.size > 3)
            assertEquals(y.toDouble() / (device.displayHeight - 1), stroke.points.first().y, .01)
            assertTrue(inputs.any { it is StudentAnnotationInput.Preview })
            // The session echoes the saved stroke back; it is drawn over the other app.
            instrumentation.runOnMainSync { controller.showAnnotations(listOf(RemoteStroke(stroke.tool, stroke.color, stroke.points))) }
            assertTrue(isBlueAt(device.displayWidth / 2, y))
            screenshot("student-annotation-toolbar")
            assertTrue(device.hasObject(By.text("터치 확인 0")))
            // Tapping the selected pen releases it, so the app underneath gets touches again.
            device.findObject(By.desc("펜")).click()
            SystemClock.sleep(300)
            assertTrue(device.click(target.centerX(), target.centerY()))
            assertTrue("Without a selected tool touches pass through", device.wait(Until.hasObject(By.text("터치 확인 1")), 10_000))
            device.findObject(By.desc("실행 취소")).click()
            assertTrue((0 until 40).any { SystemClock.sleep(50); inputs.any { it == StudentAnnotationInput.Undo } })
            // Only the teacher's permission change ends the mode; the toolbar has no close button.
            instrumentation.runOnMainSync { controller.setStudentAnnotation(false) }
            assertTrue("Revoking removes the toolbar", device.wait(Until.gone(By.desc("펜")), 5_000))
        } catch (error: Throwable) {
            runCatching { screenshot("failure-student-annotation") }
            throw error
        } finally {
            collector.cancel()
            instrumentation.runOnMainSync { controller.close() }
            device.pressBack()
            scenario.close()
        }
    }

    @Test
    fun staleGeometryAndCaptureStopCannotLeaveAnOverlay() = withOverlayPermission {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val controller = AndroidRemoteAssistanceController(context, null)
        try {
            renderFixture(scenario, "원격 화면 안내 정리 검증")
            assertTrue(device.wait(Until.hasObject(By.text("원격 화면 안내 정리 검증")), 15_000))
            setGeometry(controller)
            val x = device.displayWidth / 2; val y = device.displayHeight / 2
            show(controller, pointer(x, y).copy(geometryVersion = 99))
            SystemClock.sleep(100)
            assertFalse("A packet from another display geometry must be ignored", isRedAt(x, y))
            show(controller, pointer(x, y))
            SystemClock.sleep(200)
            assertTrue(isRedAt(x, y))
            runBlocking { controller.stopScreenShare() }
            instrumentation.waitForIdleSync()
            assertFalse(controller.state.value.capturing)
            assertTrue("Stopping must remove the overlay within 500ms, before its 1500ms TTL", awaitRedAt(x, y, expected = false))
            // Cleanup is idempotent and has no access to an unrelated screen-share controller.
            runBlocking { controller.stopScreenShare() }
            screenshot("capture-stopped")
        } catch (error: Throwable) {
            runCatching { screenshot("failure-capture-cleanup") }
            throw error
        } finally {
            instrumentation.runOnMainSync { controller.close() }
            scenario.close()
        }
    }

    private fun pointer(x: Int, y: Int) = AssistancePointer("fixture-lesson", "fixture-session", "fixture-share", 1,
        x.toDouble() / (device.displayWidth - 1), y.toDouble() / (device.displayHeight - 1), "fixture-teacher")

    private fun renderFixture(scenario: ActivityScenario<MainActivity>, label: String) {
        scenario.onActivity { activity -> activity.setContent {
            ThinkMeetTheme {
                // MainActivity draws edge-to-edge; a label at (0,0) is hidden under the status bar.
                Column(Modifier.fillMaxSize().safeDrawingPadding().padding(DesignTokens.Spacing.S24)) { Text(label) }
            }
        } }
    }

    private fun show(controller: AndroidRemoteAssistanceController, pointer: AssistancePointer) =
        instrumentation.runOnMainSync { controller.showPointer(pointer) }

    @Suppress("UNCHECKED_CAST")
    private fun setGeometry(controller: AndroidRemoteAssistanceController) {
        // No production setter or capability bypass is added for a synthetic capture session.
        instrumentation.runOnMainSync {
            val field = controller.javaClass.getDeclaredField("mutable").apply { isAccessible = true }
            (field.get(controller) as MutableStateFlow<RemoteAssistanceState>).value = RemoteAssistanceState(true, true, true,
                AssistanceGeometry(device.displayWidth, device.displayHeight, 0, 1))
            controller.javaClass.getDeclaredField("ownsCapture").apply { isAccessible = true }.setBoolean(controller, true)
        }
    }

    private fun isRedAt(x: Int, y: Int): Boolean {
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        return try {
            (-2..2).any { dx -> (-2..2).any { dy ->
                val color = image.getPixel((x + dx).coerceIn(0, image.width - 1), (y + dy).coerceIn(0, image.height - 1))
                Color.red(color) > Color.green(color) + 70 && Color.red(color) > Color.blue(color) + 70
            } }
        } finally { image.recycle() }
    }

    private fun isBlueAt(x: Int, y: Int): Boolean {
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        return try {
            (-3..3).any { dx -> (-3..3).any { dy ->
                val color = image.getPixel((x + dx).coerceIn(0, image.width - 1), (y + dy).coerceIn(0, image.height - 1))
                Color.blue(color) > Color.red(color) + 60 && Color.blue(color) > Color.green(color) + 20
            } }
        } finally { image.recycle() }
    }

    private fun awaitRedAt(x: Int, y: Int, expected: Boolean): Boolean {
        val deadline = SystemClock.uptimeMillis() + 500
        do {
            val matches = isRedAt(x, y) == expected
            if (matches) return SystemClock.uptimeMillis() <= deadline
            SystemClock.sleep(25)
        } while (SystemClock.uptimeMillis() < deadline)
        return false
    }

    private fun screenshot(name: String) {
        val arguments = InstrumentationRegistry.getArguments()
        val directory = File(arguments.getString("additionalTestOutputDir")
            ?: File(context.getExternalFilesDir(null), "remote-assistance-overlay").absolutePath).apply { mkdirs() }
        val output = File(directory, "$name.png")
        val image = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { output.outputStream().use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { image.recycle() }
        instrumentation.sendStatus(0, Bundle().apply {
            putString("screenshot", output.absolutePath)
            putString("scope", "Real Android overlay/touch/PiP; injected geometry, no lesson approval or screen capture")
            putInt("densityDpi", context.resources.configuration.densityDpi)
        })
    }

    private fun withOverlayPermission(block: () -> Unit) {
        val packageName = context.packageName
        require(packageName == "com.woongjin.thinkmeet")
        val original = shell("appops get $packageName SYSTEM_ALERT_WINDOW")
        val mode = Regex("(?m)^\\s*SYSTEM_ALERT_WINDOW: (allow|ignore|deny|default|foreground)").find(original)?.groupValues?.get(1) ?: "default"
        try {
            shell("appops set $packageName SYSTEM_ALERT_WINDOW allow")
            assertTrue("The test must receive the actual Android overlay grant", Settings.canDrawOverlays(context))
            block()
        } finally {
            shell("appops set $packageName SYSTEM_ALERT_WINDOW $mode")
            instrumentation.sendStatus(0, Bundle().apply { putString("restoredOverlayAppOp", mode) })
        }
    }

    private fun shell(command: String): String = android.os.ParcelFileDescriptor.AutoCloseInputStream(
        instrumentation.uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText() }
}
