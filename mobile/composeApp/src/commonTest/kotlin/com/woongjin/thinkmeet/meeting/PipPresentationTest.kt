package com.woongjin.thinkmeet.meeting

import com.woongjin.thinkmeet.platform.MediaParticipant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class PipPresentationTest {
    private val local = MediaParticipant("self", camera = true, screen = true, local = true)
    private val teacher = MediaParticipant("teacher", camera = true)
    private val speaker = MediaParticipant("speaker", camera = true, speaking = true)

    @Test
    fun authoritativeRemoteScreenWinsWithoutSelectingOwnScreen() {
        val first = MediaParticipant("first", screen = true)
        val shared = MediaParticipant("shared", screen = true, screenAspectRatio = 4f / 3f)
        val target = selectPipTarget(listOf(local, teacher, first, shared), "self", "teacher", sharedScreenOwner = "shared")!!
        assertEquals("shared", target.identity)
        assertEquals(true, target.screen)
        assertEquals(4f / 3f, target.aspectRatio)
        assertFalse(selectPipTarget(listOf(local), "self", "teacher")!!.screen)
    }

    @Test
    fun miniKeepsCameraVisibleWhileScreenIsShared() {
        val target = selectMiniVideoTarget(listOf(local, speaker, teacher.copy(screen = true)), "self", "teacher")!!
        assertEquals("teacher", target.identity)
        assertFalse(target.screen)
        assertEquals("speaker", selectPipTarget(listOf(local, teacher.copy(camera = false), speaker), "self", "teacher")!!.identity)
    }

    @Test
    fun participantRemovalAndCameraOffHaveStableFallbacks() {
        assertEquals("teacher", selectPipTarget(listOf(local, teacher.copy(camera = false)), "self", "teacher")!!.identity)
        assertEquals("self", selectPipTarget(listOf(local), "self", "teacher")!!.identity)
        assertNull(selectPipTarget(emptyList(), "self", "teacher"))
        assertEquals(16f / 9f, validVideoAspect(Float.NaN))
        assertEquals(16f / 9f, validVideoAspect(0f))
    }

    @Test
    fun dragAndViewportResizeKeepMiniInsideMargins() {
        assertEquals(MiniVideoOffset(8f, 8f), clampMiniVideoOffset(-100f, -100f, 400f, 800f, 160f, 120f, 8f))
        assertEquals(MiniVideoOffset(232f, 672f), clampMiniVideoOffset(900f, 900f, 400f, 800f, 160f, 120f, 8f))
        assertEquals(MiniVideoOffset(132f, 372f), clampMiniVideoOffset(232f, 672f, 300f, 500f, 160f, 120f, 8f))
    }

    @Test
    fun oversizedOrInvalidViewportDoesNotCrashDrag() {
        assertEquals(MiniVideoOffset(0f, 0f), clampMiniVideoOffset(20f, 20f, 80f, 80f, 160f, 120f, 8f))
        assertEquals(MiniVideoOffset(0f, 0f), clampMiniVideoOffset(Float.NaN, Float.POSITIVE_INFINITY, Float.NaN, -1f, 160f, 120f, 8f))
    }
}
