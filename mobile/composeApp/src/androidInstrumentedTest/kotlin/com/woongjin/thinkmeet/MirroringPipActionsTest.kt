package com.woongjin.thinkmeet

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.platform.AndroidPictureInPictureController
import com.woongjin.thinkmeet.platform.PipAction
import com.woongjin.thinkmeet.platform.PipVideoTarget
import com.woongjin.thinkmeet.platform.frameJpeg
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import livekit.org.webrtc.JavaI420Buffer
import livekit.org.webrtc.VideoFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.util.Collections

/**
 * The real Android PiP menu with the controller's own parameters: one system expand button plus the
 * mirroring actions, the app's text button bar, and taps reaching the app. No account, server, LiveKit room or screen capture.
 */
@RunWith(AndroidJUnit4::class)
class MirroringPipActionsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)

    @Test
    fun mirroringMenuHasOneExpandButtonAndAppActions() {
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        lateinit var activity: MainActivity
        scenario.onActivity { activity = it }
        val received = Collections.synchronizedList(mutableListOf<PipAction>())
        val scope = CoroutineScope(Dispatchers.Main)
        lateinit var controller: AndroidPictureInPictureController
        try {
            instrumentation.runOnMainSync {
                controller = AndroidPictureInPictureController(activity, null)
                scope.launch { controller.actions.collect { received += it } }
                controller.update(true, PipVideoTarget("teacher"))
                controller.setActions(listOf(PipAction.CaptureScreen, PipAction.StopMirroring))
                activity.enterPictureInPictureMode(controller.parameters(automatic = false, source = null))
            }
            eventually("system PiP") { inPip(activity) }
            showMenu()
            screenshot("mirroring-pip-menu")
            device.dumpWindowHierarchy(File(outputDirectory(), "mirroring-pip-menu.xml"))
            assertEquals("Only the system expand button may restore the call", 1, device.findObjects(By.res("com.android.systemui", "expand_button")).count { !it.visibleBounds.isEmpty })
            assertEquals(0, device.findObjects(By.desc("전체 화면으로 돌아가기")).size)
            assertTrue(visible(By.desc(DesignContent.NotesCapture)) != null)
            click(By.desc(DesignContent.MirroringStop))
            eventually("action delivered to the app", 5_000) { received.contains(PipAction.StopMirroring) }
            assertEquals(listOf(PipAction.StopMirroring), received.toList())
        } finally {
            instrumentation.runOnMainSync { controller.close() }
            scope.cancel()
            scenario.close()
        }
    }

    @Test
    fun textBarSendsActionsAndStopReturnsFullScreen() {
        val previousOverlay = overlayMode()
        shell("appops set ${instrumentation.targetContext.packageName} SYSTEM_ALERT_WINDOW allow")
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        lateinit var activity: MainActivity
        scenario.onActivity { activity = it }
        val received = Collections.synchronizedList(mutableListOf<PipAction>())
        val scope = CoroutineScope(Dispatchers.Main)
        lateinit var controller: AndroidPictureInPictureController
        try {
            instrumentation.runOnMainSync {
                controller = AndroidPictureInPictureController(activity, null)
                // Same handling as MeetingScreen: stopping the share also restores the full-screen class.
                scope.launch { controller.actions.collect { received += it; if (it == PipAction.StopMirroring) controller.restore() } }
                controller.update(true, PipVideoTarget("teacher"))
                controller.setActions(listOf(PipAction.CaptureScreen, PipAction.StopMirroring))
                activity.enterPictureInPictureMode(controller.parameters(automatic = false, source = null))
            }
            eventually("system PiP") { inPip(activity) }
            eventually("text button bar", 10_000) { visible(By.text(DesignContent.NotesCapture)) != null && visible(By.text(DesignContent.MirroringStop)) != null }
            screenshot("mirroring-pip-text-bar")
            click(By.text(DesignContent.NotesCapture))
            eventually("capture action delivered", 5_000) { received.contains(PipAction.CaptureScreen) }
            assertTrue("Capture keeps PiP", inPip(activity))
            click(By.text(DesignContent.MirroringStop))
            eventually("stop action delivered", 5_000) { received.contains(PipAction.StopMirroring) }
            eventually("full-screen class restored", 10_000) { !inPip(activity) }
            eventually("text button bar removed", 5_000) { visible(By.text(DesignContent.MirroringStop)) == null }
            screenshot("mirroring-pip-stopped-fullscreen")
            assertEquals(listOf(PipAction.CaptureScreen, PipAction.StopMirroring), received.toList())
        } finally {
            instrumentation.runOnMainSync { controller.close() }
            scope.cancel()
            scenario.close()
            if (previousOverlay != "allow") shell("appops set ${instrumentation.targetContext.packageName} SYSTEM_ALERT_WINDOW ${previousOverlay ?: "default"}")
        }
    }

    @Test
    fun rotatedScreenFrameBecomesUprightJpeg() {
        // Plain direct buffers keep this conversion check independent of WebRTC's native library.
        fun plane(size: Int, value: Int) = ByteBuffer.allocateDirect(size).apply { repeat(size) { put(value.toByte()) }; rewind() }
        val buffer = JavaI420Buffer.wrap(64, 32, plane(64 * 32, 200), 64, plane(32 * 16, 128), 32, plane(32 * 16, 128), 32, null)
        val frame = VideoFrame(buffer, 90, 0)
        try {
            val jpeg = checkNotNull(frameJpeg(frame))
            val image = checkNotNull(BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size))
            assertEquals(32, image.width)
            assertEquals(64, image.height)
        } finally { frame.release() }
    }

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).let { fd -> android.os.ParcelFileDescriptor.AutoCloseInputStream(fd).use { it.readBytes().decodeToString() } }

    private fun overlayMode(): String? =
        Regex("SYSTEM_ALERT_WINDOW: (\\w+)").find(shell("appops get ${instrumentation.targetContext.packageName} SYSTEM_ALERT_WINDOW"))?.groupValues?.get(1)

    private fun inPip(activity: MainActivity): Boolean {
        var result = false
        instrumentation.runOnMainSync { result = !activity.isDestroyed && activity.isInPictureInPictureMode }
        return result
    }

    private fun showMenu() {
        val dismiss = By.res("com.android.systemui", "dismiss")
        eventually("AOSP PiP menu", 15_000) {
            if (visible(dismiss) != null) return@eventually true
            // The app's text button bar is another window of this package; tap the PiP window itself.
            val bar = visible(By.text(DesignContent.MirroringStop))?.visibleBounds
            val window = device.findObjects(By.pkg(instrumentation.targetContext.packageName)).map { it.visibleBounds }
                .firstOrNull { !it.isEmpty && it.width() < device.displayWidth * .8f && (bar == null || !android.graphics.Rect.intersects(it, bar)) }
            window?.let { device.click(it.centerX(), it.centerY()) }
            SystemClock.sleep(600)
            visible(dismiss) != null
        }
    }

    private fun visible(selector: BySelector): UiObject2? = runCatching { device.findObjects(selector).firstOrNull { !it.visibleBounds.isEmpty } }.getOrNull()
    private fun click(selector: BySelector) = eventually("PiP control $selector", 5_000) { visible(selector)?.let { it.click(); true } ?: false }

    private fun eventually(description: String, timeout: Long = 30_000, condition: () -> Boolean) {
        val until = SystemClock.uptimeMillis() + timeout
        do { if (condition()) return; SystemClock.sleep(200) } while (SystemClock.uptimeMillis() < until)
        throw AssertionError("Timed out waiting for $description")
    }

    private fun outputDirectory() = File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        ?: File(instrumentation.targetContext.getExternalFilesDir(null), "mirroring-pip").absolutePath).apply { mkdirs() }

    private fun screenshot(name: String) {
        val output = File(outputDirectory(), "$name.png")
        instrumentation.waitForIdleSync()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { output.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } } finally { bitmap.recycle() }
        instrumentation.sendStatus(0, Bundle().apply { putString("screenshot", output.absolutePath) })
    }
}
