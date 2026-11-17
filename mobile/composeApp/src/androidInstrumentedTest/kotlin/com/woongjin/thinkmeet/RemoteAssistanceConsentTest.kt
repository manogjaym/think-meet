package com.woongjin.thinkmeet

import android.graphics.Bitmap
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.woongjin.thinkmeet.data.AssistanceSession
import com.woongjin.thinkmeet.data.User
import com.woongjin.thinkmeet.design.ThinkMeetTheme
import com.woongjin.thinkmeet.design.generated.DesignContent
import com.woongjin.thinkmeet.design.generated.DesignTokens
import com.woongjin.thinkmeet.meeting.MeetingStageTheme
import com.woongjin.thinkmeet.meeting.RemoteAssistanceControls
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real consent UI with callback counters only: no media controller, server, account or capture. */
@RunWith(AndroidJUnit4::class)
class RemoteAssistanceConsentTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val student = User("consent-student", "consent-student", "학생", "student")
    private val pending = AssistanceSession("consent-session", "consent-teacher", student.id, "pending", null)
    private val session = mutableStateOf<AssistanceSession?>(pending)
    private val supported = mutableStateOf(true)
    private val busy = mutableStateOf(false)
    private var approvals = 0
    private var declines = 0
    private var stops = 0

    @Before
    fun renderConsent() {
        compose.activity.runOnUiThread {
            compose.activity.setContent {
                ThinkMeetTheme {
                    MeetingStageTheme {
                        Column(Modifier.fillMaxSize().background(DesignTokens.Colors.MeetingCanvas).safeDrawingPadding()
                            .padding(DesignTokens.Spacing.S12)) {
                            val request = session.value
                            if (request == null) Text("검증 화면 · 요청 없음", color = DesignTokens.Colors.MeetingText)
                            else RemoteAssistanceControls(request, student, supported.value, busy.value,
                                onApprove = {
                                    approvals++
                                    busy.value = true
                                    session.value = request.copy(status = "approved")
                                },
                                onDecline = { declines++; session.value = null },
                                onStop = { stops++; session.value = null })
                        }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    @Test
    fun sharingApprovalRequiresAnExplicitTapAndShowsPreparingOnce() {
        compose.onNodeWithText(DesignContent.RemoteAssistTitle).assertIsDisplayed()
        compose.onNodeWithText(DesignContent.RemoteAssistConsent).assertIsDisplayed()
        compose.onNodeWithText(DesignContent.RemoteAssistApprove).assertIsDisplayed().assertIsEnabled()
        compose.runOnIdle { assertEquals(0, approvals); assertEquals(0, declines); assertEquals(0, stops) }
        screenshot("student-consent")

        compose.onNodeWithText(DesignContent.RemoteAssistApprove).performClick()
        compose.onNodeWithText(DesignContent.RemoteAssistPreparing).assertIsDisplayed()
        compose.onNodeWithText(DesignContent.RemoteAssistApprove).assertDoesNotExist()
        compose.onNodeWithText(DesignContent.RemoteAssistStop).assertIsDisplayed().assertIsEnabled()
        compose.runOnIdle { assertEquals(1, approvals); assertEquals("approved", session.value?.status) }
        screenshot("student-preparing")
        // Recomposition and time alone cannot invoke the approval a second time.
        compose.mainClock.advanceTimeBy(1_600)
        compose.runOnIdle { assertEquals(1, approvals); assertEquals(0, declines); assertEquals(0, stops) }
    }

    @Test
    fun refusalAndUnsupportedDeviceNeverInvokeApproval() {
        compose.onNodeWithText(DesignContent.RemoteAssistDecline).performClick()
        compose.onNodeWithText(DesignContent.RemoteAssistTitle).assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, approvals); assertEquals(1, declines) }
        screenshot("student-refused")

        compose.runOnIdle { supported.value = false; session.value = pending }
        compose.onNodeWithText(DesignContent.RemoteAssistTitle).assertIsDisplayed()
        compose.onAllNodesWithText(DesignContent.RemoteAssistUnsupported).onFirst().assertExists()
        compose.onNodeWithText(DesignContent.RemoteAssistApprove).assertDoesNotExist()
        compose.onNodeWithText(DesignContent.RemoteAssistDecline).assertIsDisplayed().assertIsEnabled()
        screenshot("student-unsupported")
        compose.onNodeWithText(DesignContent.RemoteAssistDecline).performClick()
        compose.runOnIdle { assertEquals(0, approvals); assertEquals(2, declines) }
    }

    private fun screenshot(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val directory = File(arguments.getString("additionalTestOutputDir")
            ?: File(instrumentation.targetContext.getExternalFilesDir(null), "remote-assistance-consent").absolutePath).apply { mkdirs() }
        val output = File(directory, "$name.png")
        instrumentation.waitForIdleSync()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { output.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
        instrumentation.sendStatus(0, Bundle().apply {
            putString("screenshot", output.absolutePath)
            putString("scope", "Native consent UI and callbacks only; no account, transport, permissions or screen capture")
            putInt("densityDpi", instrumentation.targetContext.resources.configuration.densityDpi)
        })
    }
}
