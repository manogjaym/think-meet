package com.woongjin.thinkmeet.platform

import com.woongjin.thinkmeet.config.ServerConfig
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppLinksTest {
    @BeforeTest
    @AfterTest
    fun reset() = AppLinks.consume()

    @Test
    fun acceptsJoinLinkFromBuildConfiguredServer() {
        AppLinks.receive("${ServerConfig.ORIGIN}/join/lesson-code?source=invite")
        assertEquals("lesson-code", AppLinks.code.value)
    }

    @Test
    fun rejectsOtherOriginsAndNonJoinPaths() {
        for (url in listOf(
            "${ServerConfig.ORIGIN}.invalid/join/code",
            "${ServerConfig.ORIGIN.replace("https://", "http://")}/join/code",
            "${ServerConfig.ORIGIN}/api/v1/join/code",
            "https://attacker.invalid/join/code",
        )) {
            AppLinks.receive(url)
            assertNull(AppLinks.code.value, url)
        }
    }

    @Test
    fun nativeJoinSchemeStillWorks() {
        AppLinks.receive("thinkmeet://join/lesson-code")
        assertEquals("lesson-code", AppLinks.code.value)
    }
}
